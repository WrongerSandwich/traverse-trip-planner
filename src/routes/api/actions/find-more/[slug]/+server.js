// Ambient Background: find-more candidates.
//
// Discriminator-in-workflow convention (see src/lib/server/jobs.js header):
//   workflow = 'find-more:stop' | 'find-more:lodging', slug = the trip slug.
// TripJobBadge's filterJobsForSlug does exact slug match, so this surfaces
// every concurrent find-more job for a trip without prefix-handling.

import { json } from '@sveltejs/kit';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { parse as yamlParse } from 'yaml';
import {
  DATA_DIR,
  readHomeMd,
  parseFrontmatter,
  invalidateEnrichCache,
  rejectInvalidSlug,
} from '$lib/server/data.js';
import {
  addCandidateStop,
  addCandidateLodging,
  readCandidates,
  geocodeCandidate,
  getDestinationRefCoords,
  STOP_CATEGORIES,
  LODGING_PRICE_TIERS,
} from '$lib/server/candidates.js';
import { chat } from '$lib/server/ai.js';
import { search, searchToolDefinition } from '$lib/server/search.js';
import { getEffectiveConfig, getFeatureAvailability } from '$lib/server/config.js';
import { assertNotRunning, startJob, completeJob, failJob, cancelJob } from '$lib/server/jobs.js';
import { rateLimitResponse } from '$lib/server/rate-limit.js';
import { HAND_DEFAULTS, MAX_TOKENS } from '$lib/server/promises.js';
import { TraverseError } from '$lib/server/errors.js';
import { isAbort } from '$lib/utils/abort.js';
import { usageToTokens } from '$lib/utils/formatTokens.js';

export const _promise = HAND_DEFAULTS['find-more'];

const ADDITIONS_RE = /<additions>([\s\S]*?)<\/additions>/;

function normalize(name) {
  return String(name).toLowerCase().trim().replace(/\s+/g, ' ');
}

function findPlanningOverview(slug) {
  const p = join(DATA_DIR, 'planning', slug, 'overview.md');
  return existsSync(p) ? p : null;
}

function readSectionFile(slug, name) {
  const p = join(DATA_DIR, 'planning', slug, `${name}.md`);
  if (!existsSync(p)) return '';
  try { return readFileSync(p, 'utf8'); } catch { return ''; }
}

export async function POST(event) {
  if (!getFeatureAvailability().homeMdReady) {
    return json({ code: 'home_not_configured' }, { status: 412 });
  }
  const invalid = rejectInvalidSlug(event.params.slug);
  if (invalid) return invalid;
  const { slug } = event.params;

  let body = {};
  try { body = await event.request.json(); } catch { /* empty */ }
  const type = body?.type === 'lodging' ? 'lodging' : 'stop';
  const steering = typeof body?.steering === 'string' ? body.steering.trim().slice(0, 300) : '';
  let count = Number(body?.count);
  if (!Number.isFinite(count)) count = 5;
  count = Math.min(10, Math.max(3, Math.floor(count)));

  const limited = rateLimitResponse({ event, endpoint: 'find-more', slugKey: `${slug}:${type}` });
  if (limited) return limited;

  const overviewPath = findPlanningOverview(slug);
  if (!overviewPath) return json({ code: 'trip_not_found' }, { status: 404 });

  const overviewRaw = readFileSync(overviewPath, 'utf8');
  const overviewFm = parseFrontmatter(overviewRaw) || {};
  if (overviewFm.status !== 'planning') {
    return json({ code: 'wrong_stage', message: 'This trip is not in the planning stage.' }, { status: 412 });
  }

  const workflow = `find-more:${type}`;
  try {
    assertNotRunning(workflow, slug);
  } catch (err) {
    if (err instanceof TraverseError && err.code === 'already_running') {
      return json({ code: 'already_running', message: err.message }, { status: 409 });
    }
    throw err;
  }

  const job = startJob(workflow, slug, { est_seconds: _promise.time_seconds });

  (async () => {
    try {
      const overviewRaw = readFileSync(overviewPath, 'utf8');
      const overviewFm = parseFrontmatter(overviewRaw) || {};
      const destination = overviewFm.destination ?? '';
      const vibe = overviewFm.vibe ?? '';
      const homeMd = readHomeMd();
      const cands = readCandidates(slug) ?? { stops: [], lodging: [] };
      const pool = type === 'stop' ? cands.stops : cands.lodging;
      const existingNames = pool.map((c) => `- ${c.name}`).join('\n') || '(none yet)';

      const routeMd = readSectionFile(slug, 'route');
      const logisticsMd = readSectionFile(slug, 'logistics');

      const steeringClause = steering
        ? `The user is steering this batch: "${steering}". Honor that direction.`
        : (type === 'stop'
            ? 'Focus on under-represented categories in the current pool — if outdoors and historic dominate, surface food / cultural / quirky.'
            : 'Vary tiers and locations not yet covered.');

      const fields = type === 'stop'
        ? `  - name: "<Place name>"
    category: <one of: ${STOP_CATEGORIES.join(' | ')}>
    description: <1 sentence; general if uncertain>
    why_recommended: <1 sentence linking to home preferences>
    source_url: <best URL found via search; blank if uncertain>`
        : `  - name: "<Lodging name>"
    description: <1 sentence>
    price_tier: <budget | mid | splurge>
    nights: <integer, optional>
    booking_url: <best URL found via search; blank if uncertain>`;

      const system = `You find ${count} additional ${type} candidates for a road trip planning pool.

Trip:
- destination: ${destination}
- vibe: ${vibe}

Traveler's personal context:
${homeMd}

Route notes:
${routeMd || '(none yet)'}

Logistics:
${logisticsMd || '(none yet)'}

Existing ${type} candidates in the pool — DO NOT re-suggest any of these:
${existingNames}

${steeringClause}

USE web_search to ground specific places, hours, and prices. If still uncertain about specifics, keep description general — do not invent operating hours, prices, or trivia.

Respond with exactly this envelope, nothing else:

<additions>
${type === 'stop' ? 'stops:' : 'lodging:'}
${fields}
  (repeat for up to ${count} entries)
</additions>`;

      const { text, usage } = await chat({
        ...getEffectiveConfig().features['find-more'],
        label: 'find-more',
        maxTokens: MAX_TOKENS['find-more'],
        system,
        messages: [{ role: 'user', content: `Find ${count} more ${type} candidates.` }],
        tools: [searchToolDefinition()],
        onToolCall: async ({ name: toolName, input }) => {
          if (toolName === 'web_search') return search({ query: input.query });
          return null;
        },
        signal: job.controller.signal,
      });

      const m = ADDITIONS_RE.exec(text);
      if (!m) throw new TraverseError('empty_model_output', 'No <additions> block returned.');
      let parsed;
      try { parsed = yamlParse(m[1]) || {}; }
      catch (e) {
        throw new TraverseError('model_returned_invalid_yaml', `find-more YAML parse failed: ${e.message}`);
      }

      const additions = Array.isArray(parsed[type === 'stop' ? 'stops' : 'lodging'])
        ? parsed[type === 'stop' ? 'stops' : 'lodging']
        : [];

      // Server-side dedupe against existing names (defense for when the model
      // ignores the "don't re-suggest" instruction).
      const existingNorm = new Set(pool.map((c) => normalize(c.name)));
      const survivors = additions.filter((a) => a && a.name && !existingNorm.has(normalize(a.name)));

      const refCoords = await getDestinationRefCoords(destination);
      let added = 0;
      for (const a of survivors) {
        const coords = await geocodeCandidate(a.name, destination, refCoords);
        if (type === 'stop') {
          addCandidateStop(slug, {
            name: a.name,
            category: STOP_CATEGORIES.includes(a.category) ? a.category : 'misc',
            description: a.description || '',
            why_recommended: a.why_recommended || '',
            source_url: a.source_url || '',
            coords: coords ? { lat: coords[0], lng: coords[1] } : undefined,
          });
        } else {
          addCandidateLodging(slug, {
            name: a.name,
            description: a.description || '',
            price_tier: LODGING_PRICE_TIERS.includes(a.price_tier) ? a.price_tier : 'mid',
            nights: typeof a.nights === 'number' ? a.nights : undefined,
            booking_url: a.booking_url || '',
            coords: coords ? { lat: coords[0], lng: coords[1] } : undefined,
          });
        }
        added++;
      }
      invalidateEnrichCache();
      console.log(`[find-more] ${slug} (${type}): added ${added} of ${additions.length} candidates`);
      completeJob(workflow, slug, { tokens: usageToTokens(usage) });
    } catch (err) {
      if (isAbort(err)) return;
      const code = err instanceof TraverseError ? err.code : 'unknown';
      console.error(`[find-more] ${slug} (${type}) failed (${code}):`, err?.message ?? err);
      const publicMessage = err instanceof TraverseError ? err.message : 'Find more failed — try again.';
      try { failJob(workflow, slug, { code, message: publicMessage }); }
      catch (e) { console.error(`[find-more] ${slug}: failJob threw after failure:`, e?.message ?? e); }
    }
  })();

  return new Response(null, { status: 202 });
}

export async function DELETE(event) {
  const invalid = rejectInvalidSlug(event.params.slug);
  if (invalid) return invalid;
  const url = new URL(event.request.url);
  const type = url.searchParams.get('type') === 'lodging' ? 'lodging' : 'stop';
  cancelJob(`find-more:${type}`, event.params.slug);
  return new Response(null, { status: 200 });
}

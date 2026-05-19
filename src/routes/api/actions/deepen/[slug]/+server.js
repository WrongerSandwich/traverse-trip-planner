// Ambient Background workflow: Deepen (research an idea into planning stage).
//
// Contract (docs/ai-workflow-ux.md §2.3, §6):
// - assertNotRunning('deepen', slug) → 409 Conflict if already in flight.
// - startJob('deepen', slug, { est_seconds }) registers the job and writes
//   `running: 'deepen'` to the idea's frontmatter (standard per-trip badge
//   picks this up automatically). Replaces the old ad-hoc `researching: true`
//   flag.
// - POST returns 202 Accepted immediately. The user is free to navigate away.
// - The background worker forwards the AbortController signal from the job
//   handle into chat() so /api/jobs/cancel can interrupt the model call.
//   On AbortError: swallow — cancelJob() already wrote the failure event.
// - On success: completeJob('deepen', slug, { tokens }).
// - On failure: failJob('deepen', slug, { code, message }).
//
// DELETE handler: thin shim that calls cancelJob('deepen', slug).
// The old per-slug cancelRegistry Map and the ad-hoc `researching` flag
// writes are fully removed — jobs.js now owns both concerns.

import { json } from '@sveltejs/kit';
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import {
  ROOT,
  readHomeMd,
  parseFrontmatter,
  parseFrontmatterFields,
  invalidateEnrichCache,
  rejectInvalidSlug,
} from '$lib/server/data.js';
import { chat, formatUsage } from '$lib/server/ai.js';
import { search, searchToolDefinition } from '$lib/server/search.js';
import { getEffectiveConfig, getFeatureAvailability } from '$lib/server/config.js';
import { assertNotRunning, startJob, completeJob, failJob, cancelJob } from '$lib/server/jobs.js';
import { TraverseError } from '$lib/server/errors.js';
import { rateLimitResponse } from '$lib/server/rate-limit.js';
import { HAND_DEFAULTS } from '$lib/server/promises.js';

export const _promise = HAND_DEFAULTS.deepen;

function findIdeaFile(slug) {
  const p = join(ROOT, 'ideas', `${slug}.md`);
  return existsSync(p) ? p : null;
}

function parseSection(text, tag) {
  const m = text.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
  return m?.[1]?.trim() ?? null;
}

function isAbort(err) {
  if (!err) return false;
  return err.name === 'AbortError' || err.code === 'ABORT_ERR';
}

function tokensFromUsage(usage) {
  if (!usage) return 0;
  const input = usage.input_tokens ?? usage.input ?? 0;
  const output = usage.output_tokens ?? usage.output ?? 0;
  return input + output;
}

async function doResearch(slug, ideaPath, signal) {
  const ideaContent = readFileSync(ideaPath, 'utf8');
  const homeMd = readHomeMd();
  const homeFm = parseFrontmatter(homeMd) || {};
  const today = new Date().toISOString().slice(0, 10);
  const fm = parseFrontmatter(ideaContent) || {};

  const system = `You are a meticulous travel researcher. Your job is to produce detailed, accurate, useful research for a specific trip idea using web search to find current information.

The trip to research:
${ideaContent}

The travelers' personal context (home base, preferences, constraints):
${homeMd}

Today's date: ${today}

Search the web for current information: museum hours, admission prices, lodging options and rates, restaurant details, road conditions, seasonal events. Verify facts before including them.

Produce four research sections inside XML tags. Be concrete and specific — name actual places, hours, prices. Note anything that requires on-site verification.

<overview_prose>
2–4 paragraphs of prose (no headers inside). What makes this trip worth doing, the actual experience, what's distinctive vs nearby alternatives.
</overview_prose>

<frontmatter>
Plain "key: value" lines (one per line):
region:
home_distance_mi:
driving_hours:
duration_days:
weekend_viable:
best_seasons:
avoid_months:
ev_friendly:
tags:
vibe:
cost_tier:
waypoints: [key cities along the driving route, e.g. Home City ST, Midpoint City ST, Destination City ST.]
</frontmatter>

<route_md>
Full markdown for route.md. ## headers per segment. Specific road numbers, mileage, timing.
</route_md>

<stops_md>
Full markdown for stops.md. ## headers per location. Key sights, food, lodging matching their taste profile (independent, characterful). Current hours, admission, booking info.
</stops_md>

<logistics_md>
Full markdown for logistics.md. Reservations checklist (table), seasonal notes, pet sitter reminder for overnights, cell coverage, gotchas. Flag anything that needs re-verification before the trip.
</logistics_md>`;

  const { text, usage } = await chat({
    ...getEffectiveConfig().features.deepen,
    label: 'deepen',
    maxTokens: 8000,
    system,
    messages: [{ role: 'user', content: 'Research this trip thoroughly using web search.' }],
    tools: [searchToolDefinition()],
    signal,
    onToolCall: async ({ name, input }) => {
      if (name === 'web_search') return search({ query: input.query });
      return null;
    },
  });

  const prose = parseSection(text, 'overview_prose');
  const fmRaw = parseSection(text, 'frontmatter');
  const routeMd = parseSection(text, 'route_md');
  const stopsMd = parseSection(text, 'stops_md');
  const logisticsMd = parseSection(text, 'logistics_md');

  if (!prose) {
    // Some models (notably reasoning/preview ones) occasionally drop or
    // truncate the XML tags. Log the raw response so the failure is
    // debuggable without re-running the call.
    const preview = text.slice(0, 200) + (text.length > 200 ? '… [truncated]' : '');
    console.warn(
      `[deepen] ${slug}: no <overview_prose> tag in model response (${text.length} chars). Preview:\n${preview}`
    );
    throw new Error('No overview prose returned — try again.');
  }

  const existingFm = parseFrontmatter(ideaContent) || {};
  const researchFm = fmRaw ? parseFrontmatterFields(fmRaw) : {};
  const merged = {
    ...existingFm,
    ...researchFm,
    status: 'planning',
    travelers: homeFm.travelers ?? '[you]',
    pet_sitter_needed: String(homeFm.pets_need_sitter ?? 'false'),
  };

  const fmLines = Object.entries(merged)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? `[${v.join(', ')}]` : v}`)
    .join('\n');
  const overviewContent = `---\n${fmLines}\n---\n\n${prose}\n`;

  const dir = join(ROOT, 'planning', slug);
  mkdirSync(dir, { recursive: true });

  writeFileSync(join(dir, 'overview.md'), overviewContent);
  if (routeMd)     writeFileSync(join(dir, 'route.md'),     routeMd     + '\n');
  if (stopsMd)     writeFileSync(join(dir, 'stops.md'),     stopsMd     + '\n');
  if (logisticsMd) writeFileSync(join(dir, 'logistics.md'), logisticsMd + '\n');

  unlinkSync(ideaPath);
  invalidateEnrichCache();

  console.log(`[deepen] ${fm.title || slug}: research complete. ${formatUsage(usage)}`);

  return { usage };
}

export function GET({ params }) {
  const invalid = rejectInvalidSlug(params.slug);
  if (invalid) return invalid;
  const file = findIdeaFile(params.slug);
  if (!file) return json({ code: 'trip_not_found', error: 'Not found' }, { status: 404 });
  return json({ ok: true });
}

export async function POST(event) {
  const { params } = event;
  if (!getFeatureAvailability().homeMdReady) {
    return json({ code: 'home_not_configured' }, { status: 412 });
  }
  const invalid = rejectInvalidSlug(params.slug);
  if (invalid) return invalid;
  const { slug } = params;
  const ideaPath = findIdeaFile(slug);
  if (!ideaPath) return new Response('Not found', { status: 404 });

  const limited = rateLimitResponse({ event, endpoint: 'deepen', slugKey: slug });
  if (limited) return limited;

  // Already running? Return 409 so the trigger UI can react.
  try {
    assertNotRunning('deepen', slug);
  } catch (err) {
    if (err instanceof TraverseError && err.code === 'already_running') {
      return json({ code: 'already_running', message: err.message }, { status: 409 });
    }
    throw err;
  }

  // Register the in-flight job. startJob writes `running: 'deepen'` to
  // frontmatter (standard per-trip badge reads this). The AbortController
  // signal flows into chat() so /api/jobs/cancel can interrupt mid-run.
  const job = startJob('deepen', slug, { est_seconds: _promise.time_seconds });

  // Fire-and-forget. Errors that aren't AbortError are recorded via failJob.
  // An AbortError means cancelJob() already wrote the failure event — do not
  // call failJob a second time.
  doResearch(slug, ideaPath, job.controller.signal)
    .then((result) => {
      completeJob('deepen', slug, { tokens: tokensFromUsage(result?.usage) });
    })
    .catch((err) => {
      if (isAbort(err)) return; // cancelJob() owns the failure event
      const code = err instanceof TraverseError ? err.code : 'unknown';
      // Log the raw error server-side; send only a safe public message to the client.
      console.error(`[deepen] ${slug}: research failed (${code}):`, err?.message ?? err);
      const publicMessage = err instanceof TraverseError ? err.message : 'Research failed — try again.';
      failJob('deepen', slug, { code, message: publicMessage });
    });

  return new Response(null, { status: 202 });
}

export async function DELETE({ params }) {
  const invalid = rejectInvalidSlug(params.slug);
  if (invalid) return invalid;
  const { slug } = params;
  // Delegate entirely to jobs.js — it aborts the in-flight controller and
  // clears the `running:` flag. No need to touch cancelRegistry (removed) or
  // the `researching:` flag (replaced by `running:`).
  cancelJob('deepen', slug);
  return new Response(null, { status: 200 });
}

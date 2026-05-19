// Ambient Background workflow: Deepen-section.
//
// Contract (docs/ai-workflow-ux.md §2.3, §6):
// - assertNotRunning('deepen-section:{section}', slug) → 409 Conflict when a
//   job is already in flight for the same trip + section. Using the section as
//   part of the workflow key lets route and stops (for example) run concurrently
//   for the same trip.
// - startJob registers the in-flight entry and writes `running: 'deepen-section:{section}'`
//   to the trip's overview.md frontmatter (per-trip badge picks it up).
// - POST returns 202 Accepted immediately. The user can navigate away.
// - The background worker threads the registry's AbortController.signal into
//   chat() so /api/jobs/cancel can abort the model call. On AbortError we
//   don't call failJob — cancelJob already recorded the failure event.
// - On success: write <section>.md to disk, then completeJob with token count.
// - On failure: failJob with the TraverseError code (or 'unknown').

import { json } from '@sveltejs/kit';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, readHomeMd, parseFrontmatter, invalidateEnrichCache, rejectInvalidSlug } from '$lib/server/data.js';
import { chat } from '$lib/server/ai.js';
import { search, searchToolDefinition } from '$lib/server/search.js';
import { getEffectiveConfig, getFeatureAvailability } from '$lib/server/config.js';
import { TraverseError } from '$lib/server/errors.js';
import { rateLimitResponse } from '$lib/server/rate-limit.js';
import { assertNotRunning, startJob, completeJob, failJob } from '$lib/server/jobs.js';
import { HAND_DEFAULTS } from '$lib/server/promises.js';

export const _promise = HAND_DEFAULTS['deepen-section'];

const VALID_SECTIONS = ['route', 'stops', 'logistics'];

const SECTION_PROMPTS = {
  route: {
    tag: 'route_md',
    instruction: 'the driving route for this trip',
    guidance: 'Full markdown for route.md. ## headers per segment. Specific road numbers, mileage, timing, notable scenery or detours.',
  },
  stops: {
    tag: 'stops_md',
    instruction: 'stops, attractions, dining, and lodging for this trip',
    guidance: 'Full markdown for stops.md. ## headers per location. Key sights, food, lodging matching their taste profile (independent, characterful). Current hours, admission, booking info.',
  },
  logistics: {
    tag: 'logistics_md',
    instruction: 'logistics, reservations checklist, and practical notes for this trip',
    guidance: 'Full markdown for logistics.md. Reservations checklist (table), seasonal notes, pet sitter reminder for overnights, cell coverage, gotchas. Flag anything that needs re-verification before the trip.',
  },
};

function findTripDir(slug) {
  const dir = join(ROOT, 'planning', slug);
  return existsSync(dir) ? dir : null;
}

function isAbort(err) {
  if (!err) return false;
  return err.name === 'AbortError' || err.code === 'ABORT_ERR';
}

function tokensFromUsage(usage) {
  if (!usage) return 0;
  return (usage.input_tokens ?? usage.input ?? 0)
       + (usage.output_tokens ?? usage.output ?? 0);
}

export async function POST(event) {
  const { params } = event;
  if (!getFeatureAvailability().homeMdReady) {
    return json({ code: 'home_not_configured' }, { status: 412 });
  }
  const invalid = rejectInvalidSlug(params.slug);
  if (invalid) return invalid;
  const { slug, section } = params;

  if (!VALID_SECTIONS.includes(section)) {
    return json(
      { code: 'invalid_input', error: `Invalid section "${section}". Valid: ${VALID_SECTIONS.join(', ')}` },
      { status: 400 },
    );
  }

  const tripDir = findTripDir(slug);
  if (!tripDir) {
    return json({ code: 'trip_not_found', message: `Trip "${slug}" not found` }, { status: 404 });
  }

  const limited = rateLimitResponse({ event, endpoint: 'deepen-section', slugKey: `${slug}:${section}` });
  if (limited) return limited;

  // Per-section workflow key so route + stops can run concurrently for one trip.
  const workflow = `deepen-section:${section}`;

  try {
    assertNotRunning(workflow, slug);
  } catch (err) {
    if (err instanceof TraverseError && err.code === 'already_running') {
      return json({ code: 'already_running', message: err.message }, { status: 409 });
    }
    throw err;
  }

  const job = startJob(workflow, slug, { est_seconds: _promise.time_seconds, section });

  // Fire-and-forget: do the research in the background.
  runResearch({ slug, section, tripDir, signal: job.controller.signal })
    .then((result) => {
      completeJob(workflow, slug, { tokens: tokensFromUsage(result?.usage) });
    })
    .catch((err) => {
      if (isAbort(err)) return; // cancelJob() owns the failure event
      const code = err instanceof TraverseError ? err.code : 'unknown';
      failJob(workflow, slug, { code, message: err?.message ?? 'Unknown error' });
    });

  return json({ ok: true, workflow, slug }, { status: 202 });
}

async function runResearch({ slug, section, tripDir, signal }) {
  const sectionPath = join(tripDir, `${section}.md`);
  if (existsSync(sectionPath)) {
    throw new TraverseError('file_conflict', `${section}.md already exists — use the field guide chat to update it`);
  }

  const overviewPath = join(tripDir, 'overview.md');
  if (!existsSync(overviewPath)) {
    throw new TraverseError('missing_overview', `No overview.md found for "${slug}"`);
  }

  const overviewContent = readFileSync(overviewPath, 'utf8');
  const homeMd = readHomeMd();
  const today = new Date().toISOString().slice(0, 10);
  const fm = parseFrontmatter(overviewContent) || {};
  const { tag, instruction, guidance } = SECTION_PROMPTS[section];

  const system = `You are a meticulous travel researcher. Your job is to produce detailed, accurate research for one specific section of a trip, using web search to find current information.

The trip:
${overviewContent}

The travelers' personal context (home base, preferences, constraints):
${homeMd}

Today's date: ${today}

Search the web for current information about ${instruction}. Verify facts before including them. Be concrete — name actual places, road numbers, hours, prices.

Produce the research inside exactly these XML tags:

<${tag}>
${guidance}
</${tag}>`;

  const { text, usage } = await chat({
    ...getEffectiveConfig().features.deepen,
    label: 'deepen-section',
    maxTokens: 4000,
    system,
    messages: [{ role: 'user', content: `Research the ${section} section for this trip using web search.` }],
    tools: [searchToolDefinition()],
    signal,
    onActivity: ({ type, name, input }) => {
      // Activity callbacks are no-ops in the ambient background pattern —
      // progress is surfaced by the global jobs indicator, not an SSE log.
      void type; void name; void input;
    },
    onToolCall: async ({ name, input }) => {
      if (name === 'web_search') return search({ query: input.query, signal });
      return null;
    },
  });

  const m = text.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
  const content = m?.[1]?.trim() ?? null;
  if (!content) throw new TraverseError('no_section_content', `No ${section} content returned — try again.`);

  writeFileSync(sectionPath, content + '\n');
  invalidateEnrichCache();

  return { usage };
}

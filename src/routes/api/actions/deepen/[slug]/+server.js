// Ambient Background workflow: Deepen (research an idea into planning stage).
//
// Contract (docs/ai-workflow-ux.md §2.3, §6):
// - assertNotRunning('deepen', slug) → 409 Conflict if already in flight.
// - startJob('deepen', slug, { est_seconds }) registers the job in the
//   in-memory map and persists it to the central volatile registry at
//   .cache/.jobs.json (see docs/jobs-source-of-truth.md).
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
//
// Pipeline (issue #380): one chat() round-trip produces a flat XML envelope
// with six top-level tags — <overview_prose>, <frontmatter>, <route_md>,
// <logistics_md>, <plan>YAML</plan>, <candidates>YAML</candidates>. All five
// output files (overview.md, route.md, logistics.md, plan.yaml,
// candidates.yaml) are written via a single staged-rename pass so a mid-flow
// failure leaves no half-written planning folder. realizePlan() then merges
// with prior user-added candidates, geocodes, and persists the rename notice.

import { json } from '@sveltejs/kit';
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, renameSync, statSync } from 'fs';
import { join } from 'path';
import { parse as yamlParse } from 'yaml';
import {
  ROOT,
  readHomeMd,
  parseFrontmatter,
  parseFrontmatterFields,
  invalidateEnrichCache,
  rejectInvalidSlug,
} from '$lib/server/data.js';
import { chat, formatUsage } from '$lib/server/ai.js';
import { cleanupLLMMarkdown } from '$lib/server/markdown-cleanup.js';
import { search, searchToolDefinition } from '$lib/server/search.js';
import { getEffectiveConfig, getFeatureAvailability } from '$lib/server/config.js';
import { assertNotRunning, startJob, completeJob, failJob, cancelJob } from '$lib/server/jobs.js';
import { realizePlan } from '$lib/server/realize-plan.js';
import { readPlan } from '$lib/server/plan.js';
import { TraverseError } from '$lib/server/errors.js';
import { rateLimitResponse } from '$lib/server/rate-limit.js';
import { HAND_DEFAULTS, MAX_TOKENS } from '$lib/server/promises.js';
import { isAbort } from '$lib/utils/abort.js';
import { usageToTokens } from '$lib/utils/formatTokens.js';
import { isValidWaypoints } from '$lib/utils/waypoints.js';

export const _promise = HAND_DEFAULTS.deepen;

function findIdeaFile(slug) {
  const p = join(ROOT, 'ideas', `${slug}.md`);
  return existsSync(p) ? p : null;
}

function findPlanningOverview(slug) {
  const p = join(ROOT, 'planning', slug, 'overview.md');
  return existsSync(p) ? p : null;
}

function parseSection(text, tag) {
  const m = text.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
  return m?.[1]?.trim() ?? null;
}

/**
 * Validates that a `waypoints` value from trip frontmatter is a non-empty
 * array of at least 2 non-empty strings. YAML coercion can produce booleans,
 * numbers, or nulls for bare values inside flow sequences — those are rejected.
 *
 * @param {unknown} v
 * @returns {boolean}
 */
export function _isValidWaypoints(v) {
  if (!Array.isArray(v) || v.length < 2) return false;
  return v.every((s) => typeof s === 'string' && s.trim().length > 0);
}

/**
 * Returns the list of prose section names that have been edited since the last
 * successful research run. Covers two orthogonal signals:
 *
 *   1. plan.field_guide_notes / plan.gotchas — user-curated prose in plan.md
 *      that re-research would overwrite.
 *   2. Section files (overview, route, logistics) whose mtime is newer than
 *      `last_run_success_at` in the overview frontmatter — edited since the
 *      last research run via the per-section Edit button.
 *
 * Returns an empty array when nothing is dirty (safe to re-research).
 *
 * Accepts an optional `stat` injector so tests can provide synthetic mtimes
 * without touching the filesystem.
 *
 * @param {string} slug
 * @param {{ stat?: (p: string) => { mtimeMs: number } | null }} [opts]
 * @returns {string[]}
 */
export function _collectDirtySections(slug, { stat } = {}) {
  const safeStat = stat ?? ((p) => { try { return statSync(p); } catch { return null; } });
  const dir = join(ROOT, 'planning', slug);
  const dirty = [];

  // 1. plan.md prose fields (field_guide_notes / gotchas).
  const plan = readPlan(slug);
  if (plan && (plan.field_guide_notes || plan.gotchas)) {
    dirty.push('plan');
  }

  // 2. Section files edited after last_run_success_at.
  // Read last_run_success_at from the overview frontmatter.
  const overviewPath = join(dir, 'overview.md');
  const overviewContent = (() => {
    try { return readFileSync(overviewPath, 'utf8'); } catch { return null; }
  })();
  if (!overviewContent) return dirty; // no overview — can't check mtimes

  const fm = parseFrontmatter(overviewContent);
  const lastRunRaw = fm?.last_run_success_at;
  const lastRunMs = lastRunRaw ? new Date(lastRunRaw).getTime() : null;

  if (lastRunMs && !isNaN(lastRunMs)) {
    for (const section of ['overview', 'route', 'logistics']) {
      const p = join(dir, `${section}.md`);
      const s = safeStat(p);
      if (s && s.mtimeMs > lastRunMs) {
        dirty.push(section);
      }
    }
  }

  return dirty;
}

async function doResearch(slug, ideaPath, signal, { unlinkIdea = true } = {}) {
  const ideaContent = readFileSync(ideaPath, 'utf8');
  const homeMd = readHomeMd();
  const homeFm = parseFrontmatter(homeMd) || {};
  const today = new Date().toISOString().slice(0, 10);
  const fm = parseFrontmatter(ideaContent) || {};

  const system = `You are a meticulous travel researcher. Your job is to produce detailed, accurate, useful research for a specific trip idea using web search to find current information, AND to derive a structured plan + candidate pool from that research in the same pass.

The trip to research:
${ideaContent}

The travelers' personal context (home base, preferences, constraints):
${homeMd}

Today's date: ${today}

Search the web for current information: museum hours, admission prices, lodging options and rates, restaurant details, road conditions, seasonal events. Verify facts before including them.

Produce SIX top-level XML tags, in this order, with nothing outside them. Be concrete and specific — name actual places, hours, prices. Note anything that requires on-site verification.

<overview_prose>
Keep this concise — about 3 sentences (max ~500 characters). What makes this trip worth doing, the actual experience, what's distinctive vs nearby alternatives. Save the detailed write-up for route_md / logistics_md; this is the hook, not the encyclopedia entry.

Optionally open with a one-sentence italicized lede on its own line, followed by a blank line, then the prose. Use markdown italics:
*Three days threading the Loess Hills along a forgotten scenic byway.*
The lede should read like the opening line of a magazine feature — not a label. No "TL;DR:" prefix, no "Summary:" header. If a lede doesn't feel natural for this trip, just write the prose directly.

No headers inside.
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
cost_tier: <budget | mid | splurge — these exact tokens, no other words>
waypoints: [key cities along the driving route, e.g. Home City ST, Midpoint City ST, Destination City ST.]
</frontmatter>

<route_md>
Brief editorial drive notes — ≤2 sentences, ~200 characters max. Scenic-only: what to slow down for, when to detour, the character of the drive. NO turn-by-turn directions, NO mileage tables, NO road numbers as the primary content — GPS handles all of that. For purely utilitarian drives (interstate slog to a city), write a single short sentence acknowledging the journey. No headers inside.
</route_md>

<logistics_md>
Full markdown for logistics.md. Reservations checklist (table), seasonal notes, pet sitter reminder for overnights, cell coverage, gotchas. Flag anything that needs re-verification before the trip.
</logistics_md>

<plan>
YAML for the trip's planning scaffold. Days are left empty — the user assembles them in the UI by promoting candidates from the pool below.

cover_query: <2-4 concrete visual nouns for a Pexels hero photo — reward specific landmarks/terrain over atmospheric words, e.g. "Cincinnati Italianate architecture neon" or "Glacier alpine lake mountains">
field_guide_notes:
  - <One trip-wide note worth surfacing on the printable brochure>
  - <Another note, if any>
gotchas:
  - <One closure, permit, cell-dead zone, or seasonal restriction>
  - <Another gotcha, if any>
</plan>

<candidates>
YAML for the candidate pool. Aim for 8–15 stop candidates spanning categories (do NOT only pick outdoors). Aim for 2–5 lodging candidates at varying price tiers. Pull every concrete place worth visiting that you uncovered during research. Skip restaurants unless the trip is food-themed. Skip "id" and "coords" — those are added later.

stops:
  - name: <Place name>
    category: <one of: historic | food | outdoors | view | entertainment | cultural | quirky | shopping | misc>
    description: <1 sentence>
    why_recommended: <1 sentence linking to trip vibe / home preferences>
    source_url: <best source if any>
lodging:
  - name: <Lodging name>
    description: <1 sentence>
    price_tier: <budget | mid | splurge>
    nights: <typical recommended nights, integer, optional>
    booking_url: <best source if any>
</candidates>

Formatting rules for the markdown content inside route_md / logistics_md (these matter — the content is written directly to .md files):
- Standard markdown only. ## and ### for headings. Use - for bullets (not * or +). Use **bold** and *italic* for emphasis.
- Do NOT wrap any of the markdown sections in a triple-backtick fence. Inline code fences (\`\`\`lang ... \`\`\`) are fine only for actual code or terminal commands.
- Blank line between paragraphs, blank line before every heading, blank line after every heading. Never 3+ consecutive blank lines.
- Tables use the standard pipe-and-dash syntax with a separator row. Don't use HTML <table>.
- Plain quotes (" '), em-dashes (—), and ellipses (…) are fine. Don't escape with HTML entities (&amp;, &quot;).
- No leading or trailing whitespace inside any of the section tags. No content outside the six tags.`;

  const { text, usage } = await chat({
    ...getEffectiveConfig().features.deepen,
    label: 'deepen',
    maxTokens: MAX_TOKENS.deepen,
    system,
    messages: [{ role: 'user', content: 'Research this trip thoroughly using web search, then emit all six required tags.' }],
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
  const logisticsMd = parseSection(text, 'logistics_md');
  const planRaw = parseSection(text, 'plan');
  const candidatesRaw = parseSection(text, 'candidates');

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

  if (!planRaw || !candidatesRaw) {
    const preview = text.slice(0, 200) + (text.length > 200 ? '… [truncated]' : '');
    console.warn(
      `[deepen] ${slug}: missing <plan> or <candidates> tag in model response (${text.length} chars). Preview:\n${preview}`
    );
    throw new TraverseError('model_returned_invalid_yaml', 'Research did not produce a structured plan — try again.');
  }

  let planData;
  let candidatesData;
  try {
    planData = yamlParse(planRaw) || {};
    candidatesData = yamlParse(candidatesRaw) || {};
  } catch (err) {
    throw new TraverseError('model_returned_invalid_yaml', `deepen YAML parse failed: ${err.message}`);
  }

  const existingFm = parseFrontmatter(ideaContent) || {};
  const researchFm = fmRaw ? parseFrontmatterFields(fmRaw) : {};

  // Validate waypoints before merging. If the model emitted a malformed value
  // (not an array, fewer than 2 entries, or entries that aren't non-empty strings)
  // omit waypoints entirely and record route_status so the UI can surface a badge.
  let waypointOverrides = {};
  if ('waypoints' in researchFm) {
    if (isValidWaypoints(researchFm.waypoints)) {
      // Valid — keep as-is; no route_status needed.
    } else {
      console.warn(`[deepen] ${slug}: invalid waypoints value from model (${JSON.stringify(researchFm.waypoints)}); omitting and setting route_status: invalid_waypoints`);
      waypointOverrides = { route_status: 'invalid_waypoints' };
      delete researchFm.waypoints;
    }
  }

  const merged = {
    ...existingFm,
    ...researchFm,
    ...waypointOverrides,
    status: 'planning',
    travelers: homeFm.travelers ?? '[you]',
    pet_sitter_needed: String(homeFm.pets_need_sitter ?? 'false'),
  };

  const fmLines = Object.entries(merged)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? `[${v.join(', ')}]` : v}`)
    .join('\n');

  const dir = join(ROOT, 'planning', slug);
  mkdirSync(dir, { recursive: true });

  // Deterministic post-processing — strips outer code fences, normalizes
  // bullets, collapses blank-line runs. The overview body uses the same
  // pass; the frontmatter block is left untouched (already plain YAML).
  const cleanProse      = cleanupLLMMarkdown(prose);
  const cleanRoute      = routeMd     ? cleanupLLMMarkdown(routeMd)     : null;
  const cleanLogistics  = logisticsMd ? cleanupLLMMarkdown(logisticsMd) : null;
  const overviewContentClean = `---\n${fmLines}\n---\n\n${cleanProse}\n`;

  // Stage all prose files to .tmp first. Combined with realizePlan's own
  // .tmp+rename pass for plan.yaml + candidates.yaml below, this gives us
  // atomic five-file all-or-nothing semantics: a crash before realizePlan()
  // returns leaves prose .tmp files but no renamed prose files and no
  // plan.yaml/candidates.yaml — the idea file is still intact. On success
  // we rename the prose .tmp files into place and unlink the idea last so
  // the idea → planning stage transition is the final visible step.
  const proseFilesToWrite = [
    [join(dir, 'overview.md'), overviewContentClean],
    ...(cleanRoute     ? [[join(dir, 'route.md'),     cleanRoute     + '\n']] : []),
    ...(cleanLogistics ? [[join(dir, 'logistics.md'), cleanLogistics + '\n']] : []),
  ];

  // Phase 1: stage all prose files to .tmp. On any write failure, clean up
  // .tmp files and let the error propagate (idea file stays intact).
  const proseTmpPaths = proseFilesToWrite.map(([p]) => `${p}.tmp`);
  try {
    for (const [path, content] of proseFilesToWrite) {
      writeFileSync(`${path}.tmp`, content);
    }
  } catch (stageErr) {
    for (const tmp of proseTmpPaths) {
      try { unlinkSync(tmp); } catch (_) { /* best-effort cleanup */ }
    }
    throw stageErr;
  }

  // Phase 2: realizePlan() processes the parsed plan + candidates blocks,
  // merges with any existing user-added candidates, geocodes, and
  // stages+renames plan.yaml + candidates.yaml itself. realizePlan needs to
  // read the overview from disk to recover `destination` for geocoding
  // disambiguation, so we rename the overview .tmp into place first.
  //
  // Trade-off: on a realizePlan failure the overview is on disk but other
  // prose files aren't. That's acceptable because (a) the idea file is
  // still present (we haven't unlinked yet) so the trip stays recoverable,
  // and (b) a partial planning folder without plan.yaml is reachable via
  // re-running deepen, which overwrites it cleanly. Without this overview-
  // first rename, realizePlan can't read the destination and every
  // candidate falls through to bare-name geocoding with no sanity check.
  let realizeResult;
  let overviewRenamed = false;
  try {
    renameSync(`${proseFilesToWrite[0][0]}.tmp`, proseFilesToWrite[0][0]);
    overviewRenamed = true;

    realizeResult = await realizePlan(slug, { plan: planData, candidates: candidatesData }, { signal });

    // realizePlan returned cleanly. Rename the remaining prose .tmp files.
    for (let i = 1; i < proseFilesToWrite.length; i++) {
      renameSync(`${proseFilesToWrite[i][0]}.tmp`, proseFilesToWrite[i][0]);
    }
  } catch (err) {
    // Clean up any prose tmps that didn't get renamed.
    for (let i = overviewRenamed ? 1 : 0; i < proseFilesToWrite.length; i++) {
      try { unlinkSync(`${proseFilesToWrite[i][0]}.tmp`); } catch (_) { /* best-effort */ }
    }
    throw err;
  }

  // Unlink the idea file last — only after all renames succeed. This is the
  // real stage-transition moment.
  if (unlinkIdea) {
    try { unlinkSync(ideaPath); } catch (e) {
      console.warn(`[deepen] ${slug}: idea unlink after research failed:`, e?.message ?? e);
    }
  }
  invalidateEnrichCache();

  console.log(`[deepen] ${fm.title || slug}: research+realize complete. ${formatUsage(usage)}`);

  return { usage, renames: realizeResult?.renames ?? [] };
}

export function GET({ params }) {
  const invalid = rejectInvalidSlug(params.slug);
  if (invalid) return invalid;
  const file = findIdeaFile(params.slug);
  if (!file) return json({ code: 'trip_not_found', error: 'Not found' }, { status: 404 });
  return json({ ok: true });
}

export async function POST(event) {
  const { params, url } = event;
  if (!getFeatureAvailability().homeMdReady) {
    return json({ code: 'home_not_configured' }, { status: 412 });
  }
  const invalid = rejectInvalidSlug(params.slug);
  if (invalid) return invalid;
  const { slug } = params;

  // Two-mode dispatch (issue #380 collapsed the old three modes):
  //   - idea-stage (ideaPath set): full deepen, promotes idea → planning,
  //     unlinks the idea file atomically with the promotion.
  //   - planning-stage (overviewPath set): full re-research, gated by the
  //     `plan_prose_present` dirty-section guard.
  // The old extract-only recovery branch is gone — the unified envelope
  // means there's no mid-pipeline "Leg 1 succeeded, Leg 2 failed" state to
  // recover from.
  const ideaPath     = findIdeaFile(slug);
  const overviewPath = !ideaPath ? findPlanningOverview(slug) : null;

  if (!ideaPath && !overviewPath) return new Response('Not found', { status: 404 });

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

  // Re-research prose-overwrite guard: only fires on the planning-stage
  // path (overviewPath set). Detects two categories of dirty prose:
  //   1. plan.field_guide_notes / plan.gotchas — user-curated plan prose.
  //   2. Section files (overview, route, logistics) whose mtime is newer
  //      than last_run_success_at — edited since last research.
  // Returns 409 with the full list of dirty sections so the UI can name them.
  if (overviewPath) {
    const force = url.searchParams.get('force') === 'true';
    if (!force) {
      const dirtySections = _collectDirtySections(slug);
      if (dirtySections.length > 0) {
        const list = dirtySections.join(', ');
        return json({
          code: 'plan_prose_present',
          dirty_sections: dirtySections,
          message: `Re-research will overwrite your edits to: ${list}. Pass ?force=true to continue.`,
        }, { status: 409 });
      }
    }
  }

  // Register the in-flight job. startJob persists the entry to the central
  // volatile registry at .cache/.jobs.json (not a cache — see
  // docs/jobs-source-of-truth.md). The AbortController signal flows into chat()
  // so /api/jobs/cancel can interrupt mid-run.
  const job = startJob('deepen', slug, { est_seconds: _promise.time_seconds });

  // Fire-and-forget. doResearch() runs the full unified pipeline (chat →
  // parse → 5-file atomic write via realizePlan) in a single call.
  (async () => {
    try {
      const sourcePath = ideaPath ?? overviewPath;
      const result = await doResearch(slug, sourcePath, job.controller.signal, {
        unlinkIdea: Boolean(ideaPath),
      });

      invalidateEnrichCache();
      const totalTokens = usageToTokens(result?.usage);
      try {
        completeJob('deepen', slug, { tokens: totalTokens });
      } catch (e) {
        console.error(`[deepen] ${slug}: completeJob threw after success:`, e?.message ?? e);
      }
    } catch (err) {
      if (isAbort(err)) return; // cancelJob() owns the failure event
      const code = err instanceof TraverseError ? err.code : 'unknown';
      // Log the raw error server-side; send only a safe public message to the client.
      console.error(`[deepen] ${slug}: research failed (${code}):`, err?.message ?? err);
      const publicMessage = err instanceof TraverseError ? err.message : 'Research failed — try again.';
      try {
        failJob('deepen', slug, { code, message: publicMessage });
      } catch (e) {
        console.error(`[deepen] ${slug}: failJob threw after failure:`, e?.message ?? e);
      }
    }
  })();

  return new Response(null, { status: 202 });
}

export async function DELETE({ params }) {
  const invalid = rejectInvalidSlug(params.slug);
  if (invalid) return invalid;
  const { slug } = params;
  // Delegate entirely to jobs.js — it aborts the in-flight controller and
  // removes the entry from the central .cache/.jobs.json registry. No need to
  // touch cancelRegistry (removed) or the `researching:` flag (replaced by
  // the central registry — see docs/jobs-source-of-truth.md).
  cancelJob('deepen', slug);
  return new Response(null, { status: 200 });
}

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
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, readHomeMd, parseFrontmatter, invalidateEnrichCache, rejectInvalidSlug, atomicWrite, findTripLocation } from '$lib/server/data.js';
import { chat } from '$lib/server/ai.js';
import { cleanupLLMMarkdown } from '$lib/server/markdown-cleanup.js';
import { search, searchToolDefinition } from '$lib/server/search.js';
import { getEffectiveConfig, getFeatureAvailability } from '$lib/server/config.js';
import { TraverseError } from '$lib/server/errors.js';
import { rateLimitResponse } from '$lib/server/rate-limit.js';
import { assertNotRunning, startJob, completeJob, failJob } from '$lib/server/jobs.js';
import { HAND_DEFAULTS, MAX_TOKENS } from '$lib/server/promises.js';
import { isAbort } from '$lib/utils/abort.js';
import { usageToTokens } from '$lib/utils/formatTokens.js';

export const _promise = HAND_DEFAULTS['deepen-section'];

const VALID_SECTIONS = ['route', 'stops', 'logistics'];

const SECTION_PROMPTS = {
  route: {
    tag: 'route_md',
    instruction: 'the scenic character of the drive for this trip (not turn-by-turn — GPS handles that)',
    guidance: 'Brief editorial drive notes — ≤2 sentences, ~200 characters max. Scenic-only: what to slow down for, when to detour, the character of the drive. NO turn-by-turn directions, NO mileage tables, NO road numbers as the primary content — GPS handles all of that. For purely utilitarian drives (interstate slog to a city), write a single short sentence acknowledging the journey. No headers inside.',
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
  const loc = findTripLocation(slug);
  return loc?.kind === 'dir' ? loc.path : null;
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

  // Fire-and-forget: do the research in the background. Use the two-callback
  // form of .then() so that a throw inside completeJob (e.g. disk I/O failure
  // in clearRunningFlag/atomicWrite) routes to the rejection handler rather than
  // producing an unhandled rejection that would kill the server under Node 15+.
  runResearch({ slug, section, tripDir, signal: job.controller.signal })
    .then(
      (result) => {
        try {
          completeJob(workflow, slug, { tokens: usageToTokens(result?.usage) });
        } catch (e) {
          console.error(`[deepen-section] ${workflow}:${slug}: completeJob threw after success:`, e?.message ?? e);
        }
      },
      (err) => {
        if (isAbort(err)) return; // cancelJob() owns the failure event
        const code = err instanceof TraverseError ? err.code : 'unknown';
        try {
          failJob(workflow, slug, { code, message: err?.message ?? 'Unknown error' });
        } catch (e) {
          console.error(`[deepen-section] ${workflow}:${slug}: failJob threw after failure:`, e?.message ?? e);
        }
      },
    );

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
</${tag}>

Formatting rules for the content inside the XML tags (these matter — the content is written directly to a .md file):
- Standard markdown only. ## and ### for headings. Use - for bullets (not * or +). Use **bold** and *italic* for emphasis.
- Do NOT wrap the entire output in a triple-backtick fence. Inline code fences (\`\`\`lang ... \`\`\`) are fine only for actual code or terminal commands.
- Blank line between paragraphs, blank line before every heading, blank line after every heading. Never 3+ consecutive blank lines.
- Tables use the standard pipe-and-dash syntax with a separator row. Don't use HTML <table>.
- Plain quotes (" '), em-dashes (—), and ellipses (…) are fine. Don't escape with HTML entities (&amp;, &quot;).
- No leading or trailing whitespace inside the tags. No content outside the tags.`;

  const { text, usage } = await chat({
    ...getEffectiveConfig().features.deepen,
    label: 'deepen-section',
    maxTokens: MAX_TOKENS['deepen-section'],
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

  // Prefer the well-formed <tag>...</tag> body. If the model produced an
  // opening tag but never closed it (Anthropic's native web_search burns
  // server-side reasoning tokens that count against max_tokens — see #log
  // diagnostics in this handler), fall back to everything after the opening
  // tag so a near-complete section isn't thrown away. Anything before the
  // opening tag (model preamble like "I'll research…") is dropped either way.
  const tagged = text.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
  let content = tagged?.[1]?.trim() ?? null;
  let truncated = false;
  if (!content) {
    const openIdx = text.indexOf(`<${tag}>`);
    if (openIdx !== -1) {
      const after = text.slice(openIdx + `<${tag}>`.length).trim();
      // Require some real content (a few hundred chars) before we accept a
      // truncated response — short of that, it's not worth saving a stub.
      if (after.length >= 300) {
        content = after;
        truncated = true;
        console.warn(
          `[deepen-section] ${slug}/${section}: saving truncated response (no </${tag}> tag).`
        );
      }
    }
  }
  if (!content) {
    const head = text.slice(0, 600);
    const tail = text.length > 1200 ? text.slice(-600) : '';
    const sawOpening = text.includes(`<${tag}>`);
    const sawClosing = text.includes(`</${tag}>`);
    console.error(
      `[deepen-section] ${slug}/${section}: regex miss for <${tag}>...</${tag}>\n` +
      `  usage input=${usage?.input ?? '?'} output=${usage?.output ?? '?'} turns=${usage?.turns ?? '?'} maxTokens=${MAX_TOKENS['deepen-section']}\n` +
      `  text length=${text.length}, sawOpening=${sawOpening}, sawClosing=${sawClosing}\n` +
      `  ── head ──\n${head}\n` +
      (tail ? `  ── tail ──\n${tail}\n` : '') +
      `  ── end ──`
    );
    throw new TraverseError('no_section_content', `No ${section} content returned — try again.`);
  }

  if (truncated) {
    content += '\n\n<!-- traverse: model output was truncated; review and complete this section. -->';
  }

  // Deterministic post-processing — strips outer code fences, normalizes
  // bullets, collapses blank-line runs, etc. Cheaper and more reliable
  // than asking the model to "review its output."
  content = cleanupLLMMarkdown(content);

  atomicWrite(sectionPath, content + '\n');
  invalidateEnrichCache();

  return { usage };
}

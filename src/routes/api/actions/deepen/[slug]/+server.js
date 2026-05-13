import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import {
  ROOT,
  readHomeMd,
  parseFrontmatter,
  parseFrontmatterFields,
  setFrontmatterField,
  removeFrontmatterField,
  invalidateEnrichCache,
} from '$lib/server/data.js';
import { chat, formatUsage } from '$lib/server/ai.js';
import { search, searchToolDefinition } from '$lib/server/search.js';
import { getEffectiveConfig } from '$lib/server/config.js';

// Maps slug → AbortController for in-flight doResearch() calls.
const cancelRegistry = new Map();

function findIdeaFile(slug) {
  const p = join(ROOT, 'ideas', `${slug}.md`);
  return existsSync(p) ? p : null;
}

function parseSection(text, tag) {
  const m = text.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
  return m?.[1]?.trim() ?? null;
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

  if (!prose) throw new Error('No overview prose returned — try again.');

  const existingFm = parseFrontmatter(ideaContent) || {};
  const researchFm = fmRaw ? parseFrontmatterFields(fmRaw) : {};
  const merged = {
    ...existingFm,
    ...researchFm,
    status: 'exploring',
    travelers: homeFm.travelers ?? '[you]',
    pet_sitter_needed: String(homeFm.pets_need_sitter ?? 'false'),
  };
  // Drop the temporary in-progress flag from the promoted overview.
  delete merged.researching;

  const fmLines = Object.entries(merged)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? `[${v.join(', ')}]` : v}`)
    .join('\n');
  const overviewContent = `---\n${fmLines}\n---\n\n${prose}\n`;

  const dir = join(ROOT, 'exploring', slug);
  mkdirSync(dir, { recursive: true });

  writeFileSync(join(dir, 'overview.md'), overviewContent);
  if (routeMd)    writeFileSync(join(dir, 'route.md'),     routeMd     + '\n');
  if (stopsMd)    writeFileSync(join(dir, 'stops.md'),     stopsMd     + '\n');
  if (logisticsMd) writeFileSync(join(dir, 'logistics.md'), logisticsMd + '\n');

  unlinkSync(ideaPath);
  invalidateEnrichCache();

  console.log(`[deepen] ${fm.title || slug}: research complete. ${formatUsage(usage)}`);
}

export function GET({ params }) {
  const file = findIdeaFile(params.slug);
  if (!file) return new Response('Not found', { status: 404 });
  return new Response('ok');
}

export async function POST({ params }) {
  const { slug } = params;
  const ideaPath = findIdeaFile(slug);
  if (!ideaPath) return new Response('Not found', { status: 404 });

  const content = readFileSync(ideaPath, 'utf8');
  const fm = parseFrontmatter(content);

  // Best-effort concurrent-click guard. Two POSTs arriving before either
  // writes the flag can both pass — acceptable for a single-user app.
  if (fm?.researching === 'true' || fm?.researching === true) {
    return new Response(JSON.stringify({ error: 'Already researching' }), {
      status: 409,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  writeFileSync(ideaPath, setFrontmatterField(content, 'researching', 'true'));
  invalidateEnrichCache();

  // Fire and forget — intentionally not awaited. The research runs to
  // completion on the server even if the client closes the tab.
  const controller = new AbortController();
  cancelRegistry.set(slug, controller);
  doResearch(slug, ideaPath, controller.signal)
    .catch(err => {
      console.error(`[deepen] ${slug} failed:`, err);
      try {
        if (existsSync(ideaPath)) {
          const c = readFileSync(ideaPath, 'utf8');
          writeFileSync(ideaPath, removeFrontmatterField(c, 'researching'));
          invalidateEnrichCache();
        }
      } catch { /* ignore */ }
    })
    .finally(() => cancelRegistry.delete(slug));

  return new Response(null, { status: 202 });
}

export async function DELETE({ params }) {
  const { slug } = params;

  const controller = cancelRegistry.get(slug);
  if (controller) controller.abort();

  // Defensively clear the researching flag regardless of whether a run was
  // registered — handles stale flags left by crashes or missed cleanups.
  const ideaPath = findIdeaFile(slug);
  if (ideaPath) {
    try {
      const c = readFileSync(ideaPath, 'utf8');
      writeFileSync(ideaPath, removeFrontmatterField(c, 'researching'));
      invalidateEnrichCache();
    } catch { /* ignore */ }
  }

  return new Response(null, { status: 200 });
}

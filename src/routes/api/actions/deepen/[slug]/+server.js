import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { ROOT, readHomeMd, parseFrontmatter, parseFrontmatterFields } from '$lib/server/data.js';
import { sseStream } from '$lib/server/sse.js';
import { chat, formatUsage } from '$lib/server/ai.js';
import { search, searchToolDefinition } from '$lib/server/search.js';
import { config } from '$lib/server/config.js';

function findIdeaFile(slug) {
  const p = join(ROOT, 'ideas', `${slug}.md`);
  return existsSync(p) ? p : null;
}

function parseSection(text, tag) {
  const m = text.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
  return m?.[1]?.trim() ?? null;
}

export function GET({ params }) {
  const file = findIdeaFile(params.slug);
  if (!file) return new Response('Not found', { status: 404 });
  return new Response('ok');
}

export function POST({ params, request }) {
  const { slug } = params;
  const signal = request.signal;

  return sseStream(async (send) => {
    const ideaPath = findIdeaFile(slug);
    if (!ideaPath) throw new Error(`No idea file found for slug: ${slug}`);

    send('Reading trip idea and home preferences…');
    const ideaContent = readFileSync(ideaPath, 'utf8');
    const homeMd = readHomeMd();
    const homeFm = parseFrontmatter(homeMd) || {};
    const today = new Date().toISOString().slice(0, 10);

    const fm = parseFrontmatter(ideaContent) || {};

    send(`Researching ${fm.title || slug} with live web search…`);

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
waypoints: [key cities along the driving route, e.g. Home City ST, Midpoint City ST, Destination City ST. For fly-in: driving segment from arrival airport to destination.]
</frontmatter>

<route_md>
Full markdown for route.md. ## headers per segment. Specific road numbers, mileage, timing. For fly-in: both flight overview and driving within destination.
</route_md>

<stops_md>
Full markdown for stops.md. ## headers per location. Key sights, food, lodging matching their taste profile (independent, characterful). Current hours, admission, booking info.
</stops_md>

<logistics_md>
Full markdown for logistics.md. Reservations checklist (table), seasonal notes, pet sitter reminder for overnights, cell coverage, gotchas. Flag anything that needs re-verification before the trip.
</logistics_md>`;

    const { text, usage } = await chat({
      ...config.features.deepen,
      label: 'deepen',
      maxTokens: 8000,
      system,
      messages: [{ role: 'user', content: 'Research this trip thoroughly using web search.' }],
      tools: [searchToolDefinition()],
      signal,
      onActivity: ({ type, name, input }) => {
        if (type === 'tool_call' && name === 'web_search' && input?.query) {
          send(`Searching: "${input.query}"`);
        }
      },
      onToolCall: async ({ name, input }) => {
        if (name === 'web_search') return search({ query: input.query, signal });
        return null;
      },
    });

    send('Parsing research output…');

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
    const fmLines = Object.entries(merged)
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? `[${v.join(', ')}]` : v}`)
      .join('\n');
    const overviewContent = `---\n${fmLines}\n---\n\n${prose}\n`;

    send('Writing exploring folder…');
    const dir = join(ROOT, 'exploring', slug);
    mkdirSync(dir, { recursive: true });

    writeFileSync(join(dir, 'overview.md'), overviewContent);
    send('  ✓ overview.md');
    if (routeMd)    { writeFileSync(join(dir, 'route.md'),    routeMd    + '\n'); send('  ✓ route.md'); }
    if (stopsMd)    { writeFileSync(join(dir, 'stops.md'),    stopsMd    + '\n'); send('  ✓ stops.md'); }
    if (logisticsMd){ writeFileSync(join(dir, 'logistics.md'), logisticsMd + '\n'); send('  ✓ logistics.md'); }

    unlinkSync(ideaPath);
    send('  ✓ removed from ideas/');

    send(formatUsage(usage));
    send(`Done — ${fm.title || slug} is now in exploring. Reload to see it.`, true);
  });
}

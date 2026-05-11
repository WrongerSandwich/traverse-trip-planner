import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { ROOT, readHomeMd, parseFrontmatter, invalidateEnrichCache } from '$lib/server/data.js';
import { sseStream } from '$lib/server/sse.js';
import { chat, formatUsage } from '$lib/server/ai.js';
import { search, searchToolDefinition } from '$lib/server/search.js';
import { config } from '$lib/server/config.js';

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
  for (const stage of ['exploring', 'planning']) {
    const dir = join(ROOT, stage, slug);
    if (existsSync(dir)) return dir;
  }
  return null;
}

export function POST({ params, request }) {
  const { slug, section } = params;
  const signal = request.signal;

  if (!VALID_SECTIONS.includes(section)) {
    return new Response(`Invalid section "${section}". Valid: ${VALID_SECTIONS.join(', ')}`, { status: 400 });
  }

  return sseStream(async (send) => {
    const tripDir = findTripDir(slug);
    if (!tripDir) throw new Error(`Trip "${slug}" not found in exploring or planning`);

    const sectionPath = join(tripDir, `${section}.md`);
    if (existsSync(sectionPath)) {
      throw new Error(`${section}.md already exists — use the field guide chat to update it`);
    }

    const overviewPath = join(tripDir, 'overview.md');
    if (!existsSync(overviewPath)) throw new Error(`No overview.md found for "${slug}"`);

    send('Reading trip context…');
    const overviewContent = readFileSync(overviewPath, 'utf8');
    const homeMd = readHomeMd();
    const today = new Date().toISOString().slice(0, 10);
    const fm = parseFrontmatter(overviewContent) || {};
    const { tag, instruction, guidance } = SECTION_PROMPTS[section];

    send(`Researching ${section} for ${fm.title || slug}…`);

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
      ...config.features.deepen,
      label: 'deepen-section',
      maxTokens: 4000,
      system,
      messages: [{ role: 'user', content: `Research the ${section} section for this trip using web search.` }],
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

    send('Parsing output…');
    const m = text.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
    const content = m?.[1]?.trim() ?? null;
    if (!content) throw new Error(`No ${section} content returned — try again.`);

    writeFileSync(sectionPath, content + '\n');
    send(`  ✓ ${section}.md written`);

    invalidateEnrichCache();
    send(formatUsage(usage));
    send(`Done — ${section} section is ready.`, true);
  });
}

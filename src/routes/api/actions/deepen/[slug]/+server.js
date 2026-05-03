import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { ROOT, readHomeMd, parseFrontmatter } from '$lib/server/data.js';

function sse(controller, encoder, msg, done = false) {
  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ msg, done })}\n\n`));
}

function findIdeaFile(slug) {
  const p = join(ROOT, 'ideas', `${slug}.md`);
  return existsSync(p) ? p : null;
}

function parseSection(text, tag) {
  const m = text.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
  return m?.[1]?.trim() ?? null;
}

/**
 * Run a research agent loop with web search.
 * Calls the API repeatedly until stop_reason is "end_turn",
 * passing back tool_results for each web_search call so Anthropic
 * can incorporate the search results.
 */
async function runResearchAgent(client, system, userMsg, onSearch) {
  const tools = [{ type: 'web_search_20250305', name: 'web_search' }];
  let messages = [{ role: 'user', content: userMsg }];
  const MAX_TURNS = 20; // safety ceiling

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await client.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 8000,
      system,
      tools,
      messages,
    });

    const textBlocks = response.content.filter(b => b.type === 'text');
    const text = textBlocks.map(b => b.text).join('\n');

    if (response.stop_reason === 'end_turn') {
      return text;
    }

    if (response.stop_reason === 'tool_use') {
      // Add assistant's full response to the conversation
      messages = [...messages, { role: 'assistant', content: response.content }];

      // Acknowledge each web_search call so Anthropic can provide results
      const toolResults = [];
      for (const block of response.content) {
        if (block.type === 'tool_use' && block.name === 'web_search') {
          const query = block.input?.query ?? '';
          if (query) onSearch?.(`Searching: "${query}"`);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: '', // Anthropic fills in results server-side
          });
        }
      }

      if (toolResults.length > 0) {
        messages = [...messages, { role: 'user', content: toolResults }];
      } else if (text) {
        // tool_use with no web_search blocks — return whatever text we have
        return text;
      }
      continue;
    }

    // max_tokens or other stop — return what we have
    if (text) return text;
    throw new Error(`Unexpected stop_reason: ${response.stop_reason}`);
  }

  throw new Error(`Research agent hit the ${MAX_TURNS}-turn safety limit.`);
}

export function GET({ params }) {
  const file = findIdeaFile(params.slug);
  if (!file) return new Response('Not found', { status: 404 });
  return new Response('ok');
}

export function POST({ params }) {
  const { slug } = params;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (msg, done = false) => sse(controller, encoder, msg, done);

      try {
        const ideaPath = findIdeaFile(slug);
        if (!ideaPath) throw new Error(`No idea file found for slug: ${slug}`);

        send('Reading trip idea and home preferences…');
        const ideaContent = readFileSync(ideaPath, 'utf8');
        const homeMd = readHomeMd();
        const homeFm = parseFrontmatter(homeMd) || {};
        const today = new Date().toISOString().slice(0, 10);

        const fm = {};
        for (const line of ideaContent.split('\n')) {
          if (line === '---') continue;
          const c = line.indexOf(':');
          if (c > 0) fm[line.slice(0, c).trim()] = line.slice(c + 1).trim();
        }

        send(`Researching ${fm.title || slug} with live web search…`);

        const client = new Anthropic();

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

        const text = await runResearchAgent(
          client,
          system,
          'Research this trip thoroughly using web search.',
          (msg) => send(msg),
        );

        send('Parsing research output…');

        const prose = parseSection(text, 'overview_prose');
        const fmRaw = parseSection(text, 'frontmatter');
        const routeMd = parseSection(text, 'route_md');
        const stopsMd = parseSection(text, 'stops_md');
        const logisticsMd = parseSection(text, 'logistics_md');

        if (!prose) throw new Error('No overview prose returned — try again.');

        // Merge existing frontmatter with research fields
        const existingFm = {};
        const fmMatch = ideaContent.match(/^---\n([\s\S]*?)\n---/);
        if (fmMatch) {
          for (const line of fmMatch[1].split('\n')) {
            const c = line.indexOf(':');
            if (c > 0) existingFm[line.slice(0, c).trim()] = line.slice(c + 1).trim();
          }
        }
        const researchFm = {};
        if (fmRaw) {
          for (const line of fmRaw.split('\n')) {
            const c = line.indexOf(':');
            if (c > 0) researchFm[line.slice(0, c).trim()] = line.slice(c + 1).trim();
          }
        }
        const merged = {
          ...existingFm,
          ...researchFm,
          status: 'exploring',
          travelers: homeFm.travelers || '[you]',
          pet_sitter_needed: String(homeFm.pets_need_sitter ?? 'false'),
        };
        const fmLines = Object.entries(merged).map(([k, v]) => `${k}: ${v}`).join('\n');
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

        send(`Done — ${fm.title || slug} is now in exploring. Reload to see it.`, true);

      } catch (err) {
        send(`Error: ${err.message}`, true);
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

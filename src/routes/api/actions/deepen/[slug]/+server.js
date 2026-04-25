import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();

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

export function GET({ params }) {
  // Allow checking if a slug is deepenable
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

        send('Reading trip idea and home preferences...');
        const ideaContent = readFileSync(ideaPath, 'utf8');
        const homeMd = readFileSync(join(ROOT, 'home.md'), 'utf8');
        const today = new Date().toISOString().slice(0, 10);

        // Parse key fields from frontmatter
        const fm = {};
        for (const line of ideaContent.split('\n')) {
          const c = line.indexOf(':');
          if (c > 0 && line.startsWith('---') === false) {
            fm[line.slice(0, c).trim()] = line.slice(c + 1).trim();
          }
        }

        send(`Researching ${fm.title || slug}...`);

        const client = new Anthropic();

        const isFlyIn = fm.fly_in === 'true';

        const system = `You are a meticulous travel researcher. Your job is to produce detailed, accurate, useful research for a specific trip idea.

The trip to research:
${ideaContent}

The travelers' personal context (Overland Park, KS home base, preferences, constraints):
${homeMd}

Today's date: ${today}

Produce four research sections. Each section must be inside its own XML tag. Omit the tags for sections you cannot produce confidently. Be concrete and specific — name actual places, hours, prices where known. Flag anything that requires on-site verification.

<overview_prose>
2–4 paragraphs of prose (no headers inside) covering: what makes this trip worth doing, the actual experience, what's distinctive vs. nearby alternatives. This becomes the body of overview.md.
</overview_prose>

<frontmatter>
Provide these fields as plain "key: value" lines (one per line, no YAML dashes):
region: [e.g. Colorado Plateau, UT]
home_distance_mi: [approximate miles from Overland Park]
driving_hours: [one-way drive time in hours, or SLC-to-destination for fly-in]
duration_days: [e.g. [2,3] for uncertain, or 4 for fixed]
weekend_viable: [true or false]
best_seasons: [e.g. [spring, fall]]
avoid_months: [e.g. [jun, jul, aug]]
ev_friendly: [true or false — note charger availability]
tags: [inline array like [scenic-drive, small-town, historic]]
vibe: [short phrase]
cost_tier: [budget, mid, or splurge]
waypoints: [inline array of key cities along the driving route, e.g. [Overland Park KS, Leavenworth KS, Atchison KS]. For fly-in, use the driving segment from arrival airport to destination.]
</frontmatter>

<route_md>
Full markdown content for route.md. Use ## headers for named segments. Include specific road numbers, mileage, and timing. For fly-in trips include both the flight overview and the driving route within the destination area.
</route_md>

<stops_md>
Full markdown content for stops.md. Use ## headers per location. Cover: key sights, food, lodging that fits their taste profile (independent, characterful, not chains). Include hours, admission prices, booking info where known.
</stops_md>

<logistics_md>
Full markdown content for logistics.md. Cover: reservations checklist (table format), seasonal notes, pet sitter reminder if overnight, cell coverage, gotchas. Add a note that hours and prices should be verified before visiting.
</logistics_md>`;

        const response = await client.messages.create({
          model: 'claude-opus-4-7',
          max_tokens: 8000,
          system,
          messages: [{ role: 'user', content: `Research this trip thoroughly.` }],
        });

        const text = response.content.find(b => b.type === 'text')?.text ?? '';

        send('Parsing research output...');

        const prose = parseSection(text, 'overview_prose');
        const fmRaw = parseSection(text, 'frontmatter');
        const routeMd = parseSection(text, 'route_md');
        const stopsMd = parseSection(text, 'stops_md');
        const logisticsMd = parseSection(text, 'logistics_md');

        if (!prose) throw new Error('Claude did not return overview prose — try again.');

        // Build updated frontmatter
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

        const mergedFm = {
          ...existingFm,
          ...researchFm,
          status: 'exploring',
          travelers: '[evan, erika]',
          pet_sitter_needed: 'true',
        };

        const fmLines = Object.entries(mergedFm)
          .map(([k, v]) => `${k}: ${v}`)
          .join('\n');

        const overviewContent = `---\n${fmLines}\n---\n\n${prose}\n`;

        // Write exploring folder
        send('Writing exploring folder...');
        const dir = join(ROOT, 'exploring', slug);
        mkdirSync(dir, { recursive: true });

        writeFileSync(join(dir, 'overview.md'), overviewContent);
        send('  ✓ overview.md');

        if (routeMd) { writeFileSync(join(dir, 'route.md'), routeMd + '\n'); send('  ✓ route.md'); }
        if (stopsMd) { writeFileSync(join(dir, 'stops.md'), stopsMd + '\n'); send('  ✓ stops.md'); }
        if (logisticsMd) { writeFileSync(join(dir, 'logistics.md'), logisticsMd + '\n'); send('  ✓ logistics.md'); }

        // Remove idea file
        unlinkSync(ideaPath);
        send('  ✓ removed from ideas/');

        send(`Done — ${fm.title || slug} is now in exploring. Reload to see the updated card.`, true);

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

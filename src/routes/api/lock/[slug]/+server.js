import Anthropic from '@anthropic-ai/sdk';
import { json } from '@sveltejs/kit';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { setLocked, ROOT } from '$lib/server/data.js';
const SECTIONS = ['overview', 'route', 'stops', 'logistics'];

function readSections(slug) {
  const dir = join(ROOT, 'planning', slug);
  if (!existsSync(dir)) return null;
  const out = { dir, sections: {} };
  for (const name of SECTIONS) {
    const fp = join(dir, `${name}.md`);
    if (!existsSync(fp)) continue;
    let content = readFileSync(fp, 'utf8');
    if (name === 'overview') content = content.replace(/^---\n[\s\S]*?\n---\n*/, '').trimStart();
    if (content.trim()) out.sections[name] = content;
  }
  return out;
}

export async function POST({ params }) {
  const { slug } = params;
  const trip = readSections(slug);
  if (!trip) return new Response('Trip not in planning stage', { status: 404 });

  const sectionDump = SECTIONS
    .filter(s => trip.sections[s])
    .map(s => `<section name="${s}">\n${trip.sections[s]}\n</section>`)
    .join('\n\n');

  const client = new Anthropic();
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4000,
    system: `You are Atlas, a travel itinerary formatter. Given the planning sections for a road trip, synthesize them into a clean day-by-day itinerary in markdown.

Format rules:
- Use ## for each day heading: "## Day 1 — [Day of Week], [Month Day, Year]" (derive the date from the overview if a specific date is mentioned; otherwise use just the day name or omit the date)
- Under each day heading, add a bold one-line theme on its own line: **[theme]**
- Use ### Morning / ### Afternoon / ### Evening for time-of-day groupings (only include sections that have content)
- Use bullet points with approximate times: "- 9:00 AM — [activity, place name, brief note]"
- Be specific: pull place names, addresses, durations, and drive times from the source material
- Keep it scannable — this will be printed and carried on the trip
- Do not add introductory prose, a title header, or any closing text — start directly with ## Day 1
- If the trip is a single day, output one ## Day block`,
    messages: [
      {
        role: 'user',
        content: `Here are the planning sections for this trip:\n\n${sectionDump}\n\nGenerate the day-by-day itinerary now.`,
      },
    ],
  });

  const itinerary = response.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n')
    .trim();

  writeFileSync(join(trip.dir, 'itinerary.md'), `${itinerary}\n`);

  const lockResult = setLocked(slug, true);
  if (!lockResult) return new Response('Failed to update frontmatter', { status: 500 });

  return json({ ok: true });
}

export async function DELETE({ params }) {
  const { slug } = params;
  const result = setLocked(slug, false);
  if (!result) return new Response('Trip not found', { status: 404 });
  return json({ ok: true });
}

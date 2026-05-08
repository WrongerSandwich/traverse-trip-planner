import { json } from '@sveltejs/kit';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { setLocked, readPlanningTrip, PLANNING_SECTIONS } from '$lib/server/data.js';
import { chat, formatUsage } from '$lib/server/ai.js';
import { config } from '$lib/server/config.js';
import { sseStream } from '$lib/server/sse.js';

export function POST({ params, request }) {
  const { slug } = params;
  const signal = request.signal;
  const trip = readPlanningTrip(slug);
  if (!trip) return new Response('Trip not in planning stage', { status: 404 });

  const sectionDump = PLANNING_SECTIONS
    .filter(s => trip.sections[s]?.trim())
    .map(s => `<section name="${s}">\n${trip.sections[s]}\n</section>`)
    .join('\n\n');

  return sseStream(async (send) => {
    send('Generating itinerary…');

    let itinerary = '';
    let usage;
    try {
      const result = await chat({
        ...config.features.lock,
        label: 'lock',
        maxTokens: 4000,
        signal,
        onText: (chunk) => {
          itinerary += chunk;
          send(`itinerary:${chunk}`);
        },
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
      // If the streaming path didn't accumulate (e.g. an adapter without
      // onText support), fall back to the returned text.
      if (!itinerary && result?.text) itinerary = result.text;
      usage = result?.usage;
    } catch (err) {
      throw new Error(`Itinerary generation failed: ${err.message}`);
    }

    itinerary = itinerary.trim();
    try {
      writeFileSync(join(trip.dir, 'itinerary.md'), `${itinerary}\n`);
    } catch (err) {
      throw new Error(`Failed to write itinerary: ${err.message}`);
    }

    const lockResult = setLocked(slug, true);
    if (!lockResult) throw new Error('Failed to update frontmatter');

    if (usage) send(formatUsage(usage));
    send('Done — trip locked. Reload to see the itinerary.', true);
  });
}

export async function DELETE({ params }) {
  const { slug } = params;
  const result = setLocked(slug, false);
  if (!result) return new Response('Trip not found', { status: 404 });
  return json({ ok: true });
}

import { writeFileSync } from 'fs';
import { join } from 'path';
import { readPlanningTrip, PLANNING_SECTIONS, invalidateEnrichCache } from '$lib/server/data.js';
import { chat, formatUsage } from '$lib/server/ai.js';
import { usageToTokens } from '$lib/utils/formatTokens.js';
import { getEffectiveConfig } from '$lib/server/config.js';
import { sseStream } from '$lib/server/sse.js';
import { TraverseError } from '$lib/server/errors.js';
import { HAND_DEFAULTS } from '$lib/server/promises.js';

export const _promise = HAND_DEFAULTS.itinerary;

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
    send('Plotting the itinerary…');

    let itinerary = '';
    let usage;
    try {
      const result = await chat({
        ...getEffectiveConfig().features.itinerary,
        label: 'itinerary',
        maxTokens: 4000,
        signal,
        onText: (chunk) => {
          itinerary += chunk;
          send(`itinerary:${chunk}`);
        },
        system: `You are Traverse, a travel itinerary formatter. Given the planning sections for a road trip, synthesize them into a clean day-by-day itinerary in markdown.

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
      // Re-throw abort signals so sseStream's cancel() path handles them silently.
      if (err.name === 'AbortError' || err.code === 'ABORT_ERR') throw err;
      throw new Error(`Itinerary generation failed: ${err.message}`);
    }

    itinerary = itinerary.trim();
    if (!itinerary) throw new TraverseError('empty_model_output', "The model didn't return itinerary content — try again.");
    try {
      writeFileSync(join(trip.dir, 'itinerary.md'), `${itinerary}\n`);
    } catch (err) {
      throw new Error(`Failed to write itinerary: ${err.message}`);
    }
    invalidateEnrichCache();

    if (usage) send(formatUsage(usage));
    send('Done — itinerary is ready.', true, usageToTokens(usage));
  });
}

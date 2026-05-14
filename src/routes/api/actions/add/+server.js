import { writeFileSync } from 'fs';
import { join } from 'path';
import { ROOT, readHomeMd, invalidateEnrichCache } from '$lib/server/data.js';
import { collectExistingDestinations } from '$lib/server/destinations.js';
import { sseStream, withHeartbeat } from '$lib/server/sse.js';
import { chat, formatUsage } from '$lib/server/ai.js';
import { getEffectiveConfig } from '$lib/server/config.js';

// TODO: consolidate trip-lookup helpers (findTripFile/findTrip/findIdeaFile) into data.js
// TODO: extract readSections() shared by lock/+server.js and trip/[slug]/chat/+server.js

export async function POST({ request }) {
  const NAME = getEffectiveConfig().assistantName;
  let destination = '';
  try {
    const body = await request.json();
    destination = (body?.destination || '').trim().slice(0, 100);
  } catch { /* no body */ }

  return sseStream(async (send) => {
    if (!destination) {
      send('No destination given. Add a place name and try again.', true);
      return;
    }

    send(`Checking the cabinet for ${destination}…`);
    const existing = collectExistingDestinations();
    const destLower = destination.toLowerCase();
    const duplicate = existing.find(d => d.toLowerCase() === destLower);
    if (duplicate) {
      send(`"${duplicate}" is already on the list. Skipping.`, true);
      return;
    }

    const homeMd = readHomeMd();
    const today = new Date().toISOString().slice(0, 10);

    send(`Sketching an idea for ${destination}…`);

    const system = `You are a travel planning assistant. Here is the traveler's full personal context:
${homeMd}

The traveler already has trips for these destinations:
${existing.length > 0 ? existing.map(d => `- ${d}`).join('\n') : '(none yet)'}

The user wants to add a specific destination. Before generating, check whether the requested destination is already covered — meaning it is the same place, a suburb/neighborhood within the same metro area, or so geographically close that a separate trip idea would be redundant (e.g. user requests "Overland Park, KS" when "Kansas City, MO" is already on the list).

If it IS a near-duplicate, respond with ONLY this tag (no other text):
<duplicate>the matching existing destination</duplicate>

If it is NOT a near-duplicate, create exactly one trip idea. Rules:
- Traverse is road-trip only. If the requested destination cannot realistically be reached by driving from the traveler's home base, respond with ONLY this tag (no other text):
  <not-drivable>brief reason</not-drivable>
- Use the traveler's taste profile to write a concrete, specific pitch — name the actual draw, not generic adjectives.
- Do not invent facts about the destination. If you are unsure whether a specific detail is true (a venue still operating, an event still running, a route still open), keep the pitch at a higher level and let /deepen verify the specifics later.
- Do NOT second-guess or filter the destination; the user already decided to go.
- For trips involving an NPS unit add: national_park: true

Output the trip as a single file block in this exact format, with nothing outside the tags:

<file name="ideas/[kebab-case-slug].md">
---
title: [Human-readable title]
status: idea
destination: [Town, State]
pitch: [2–3 sentences naming the specific draw. Concrete, not generic.]
created: ${today}
vibe: [short phrase like "quirky mountain town" or "prairie scenic drive"]
---
</file>`;

    const { text, usage } = await withHeartbeat(
      () => chat({
        ...getEffectiveConfig().features.add,
        label: 'add',
        system,
        maxTokens: 600,
        messages: [{ role: 'user', content: `Add a trip idea for: ${destination}` }],
      }),
      send,
      ['Still thinking…']
    );


    const dupMatch = text.match(/<duplicate>([\s\S]*?)<\/duplicate>/);
    if (dupMatch) {
      send(`Too close to "${dupMatch[1].trim()}", which is already on the list.`, true);
      return;
    }

    const flyMatch = text.match(/<not-drivable>([\s\S]*?)<\/not-drivable>/);
    if (flyMatch) {
      send(`Not a road trip — ${flyMatch[1].trim()}`, true);
      return;
    }

    const fileRegex = /<file name="([^"]+)">([\s\S]*?)<\/file>/g;
    const files = [];
    let m;
    while ((m = fileRegex.exec(text)) !== null) {
      files.push({ name: m[1].trim(), content: m[2].trim() });
    }

    if (files.length === 0) throw new Error(`${NAME} returned no file blocks — try again.`);

    const file = files[0];
    const path = join(ROOT, file.name);
    writeFileSync(path, file.content + '\n');
    const title = file.content.match(/^title: (.+)$/m)?.[1] ?? file.name;
    send(`  ✓ ${title}`);
    invalidateEnrichCache();
    send(formatUsage(usage));
    send('Done — added to the list.', true);
  });
}

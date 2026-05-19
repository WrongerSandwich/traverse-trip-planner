import { writeFileSync } from 'fs';
import { join } from 'path';
import { ROOT, readHomeMd, invalidateEnrichCache, assertSafeIdeaPath } from '$lib/server/data.js';
import { collectExistingDestinations } from '$lib/server/destinations.js';
import { sseStream, withHeartbeat } from '$lib/server/sse.js';
import { chat, formatUsage } from '$lib/server/ai.js';
import { usageToTokens } from '$lib/utils/formatTokens.js';
import { getEffectiveConfig, getFeatureAvailability } from '$lib/server/config.js';
import { HAND_DEFAULTS } from '$lib/server/promises.js';
import { json } from '@sveltejs/kit';

export const _promise = HAND_DEFAULTS.seed;

export async function POST({ request }) {
  if (!getFeatureAvailability().homeMdReady) {
    return json({ code: 'home_not_configured' }, { status: 412 });
  }
  const NAME = getEffectiveConfig().assistantName;
  // Optional user-supplied steering prompt. Body is JSON; absence is fine.
  let userPrompt = '';
  try {
    const body = await request.json();
    userPrompt = (body?.prompt || '').trim().slice(0, 500);
  } catch { /* no body, no prompt — fine */ }

  return sseStream(async (send) => {
    send('Looking over home.md and what\'s already on the list…');
    const homeMd = readHomeMd();
    const existing = collectExistingDestinations();
    const today = new Date().toISOString().slice(0, 10);

    send(
      userPrompt
        ? `Sketching five ideas around "${userPrompt}" (steering clear of ${existing.length} you've already seen)…`
        : `Sketching five new ideas (steering clear of ${existing.length} you've already seen)…`
    );

    const system = `You are a travel planning assistant. Here is the traveler's full personal context:
${homeMd}

Generate exactly 5 new road trip ideas. Rules:
- Traverse is road-trip only. Every idea must be drivable from the traveler's home base — do not propose destinations that would require flying.
- Diverse across region, vibe, and distance. Do not cluster.
- Each must pass a "would they actually go?" test against the taste profile above.
- Do NOT propose any of these existing destinations: ${existing.join(', ')}.
- Be concrete — name the specific draw, not generic adjectives.
- Do not invent facts about destinations. If you are unsure whether a specific detail is true (a venue still operating, an event still running, a route still open), keep the pitch at a higher level and let /deepen verify the specifics later.

Output each trip as a file block in this exact format, with nothing outside the tags:

<file name="ideas/[kebab-case-slug].md">
---
title: [Human-readable title]
status: idea
destination: [Town, State]
pitch: [2–3 sentences naming the specific draw. Concrete, not generic.]
created: ${today}
vibe: [short phrase like "quirky mountain town" or "prairie scenic drive"]
image_query: [2–4 concrete words for a Pexels stock-photo search. Name the place + one visual scene noun: "Chicago skyline downtown", "Glacier National Park mountains", "Asheville Blue Ridge". Avoid abstract terms like "intellectual", "historic", "vibes" — they don't match photos. The card uses this image, so picture what should be on it.]
</file>

For trips involving an NPS unit (national park, preserve, scenic riverway) add:
national_park: true`;

    const userMessage = userPrompt
      ? `Generate 5 new trip ideas. The user has asked specifically for: ${userPrompt}\n\nStill obey the diversity and "would they actually go?" rules — interpret their request through the taste profile, don't override it.`
      : 'Generate 5 new trip ideas.';

    const { text, usage } = await withHeartbeat(
      () => chat({
        ...getEffectiveConfig().features.seed,
        label: 'seed',
        system,
        maxTokens: 3000,
        messages: [{ role: 'user', content: userMessage }],
      }),
      send,
      ['Still drafting…', 'Almost there…']
    );

    const fileRegex = /<file name="([^"]+)">([\s\S]*?)<\/file>/g;
    const files = [];
    let m;
    while ((m = fileRegex.exec(text)) !== null) {
      files.push({ name: m[1].trim(), content: m[2].trim() });
    }

    if (files.length === 0) throw new Error(`${NAME} returned no file blocks — try again.`);

    // Reject the whole batch if the model emits an unsafe path. Partial writes
    // would leave the idea list inconsistent with what the user saw stream.
    for (const file of files) assertSafeIdeaPath(file.name);

    send(`Saving ${files.length} idea${files.length === 1 ? '' : 's'} to disk…`);
    for (const file of files) {
      const path = join(ROOT, file.name);
      writeFileSync(path, file.content + '\n');
      const title = file.content.match(/^title: (.+)$/m)?.[1] ?? file.name;
      send(`  ✓ ${title}`);
    }

    invalidateEnrichCache();
    send(formatUsage(usage));
    send(`Done — ${files.length} new trip${files.length === 1 ? '' : 's'} on the list.`, true, usageToTokens(usage));
  });
}

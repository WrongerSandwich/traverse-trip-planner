import Anthropic from '@anthropic-ai/sdk';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { ROOT, readHomeMd } from '$lib/server/data.js';
import { collectExistingDestinations } from '$lib/server/destinations.js';
import { sseStream } from '$lib/server/sse.js';

export async function POST({ request }) {
  // Optional user-supplied steering prompt. Body is JSON; absence is fine.
  let userPrompt = '';
  try {
    const body = await request.json();
    userPrompt = (body?.prompt || '').trim().slice(0, 500);
  } catch { /* no body, no prompt — fine */ }

  return sseStream(async (send) => {
    send('Reading home.md and existing trips...');
    const homeMd = readHomeMd();
    const existing = collectExistingDestinations();
    const today = new Date().toISOString().slice(0, 10);

    send(
      userPrompt
        ? `Asking Claude for 5 ideas matching "${userPrompt}" (avoiding ${existing.length} existing)...`
        : `Asking Claude for 5 new ideas (avoiding ${existing.length} existing destinations)...`
    );

    const client = new Anthropic();

    const system = `You are a travel planning assistant. Here is the traveler's full personal context:
${homeMd}

Generate exactly 5 new trip ideas. Rules:
- Diverse across region, vibe, and distance. Do not cluster.
- Each must pass a "would they actually go?" test against the taste profile above.
- Do NOT propose any of these existing destinations: ${existing.join(', ')}.
- Include a mix of road trips and fly-in destinations where appropriate.
- Be concrete — name the specific draw, not generic adjectives.

Output each trip as a file block in this exact format, with nothing outside the tags:

<file name="ideas/[kebab-case-slug].md">
---
title: [Human-readable title]
status: idea
destination: [Town, State]
pitch: [2–3 sentences naming the specific draw. Concrete, not generic.]
created: ${today}
vibe: [short phrase like "quirky mountain town" or "prairie scenic drive"]
</file>

For fly-in trips add these two lines inside the frontmatter:
fly_in: true
vehicle: rental

For trips involving an NPS unit (national park, preserve, scenic riverway) add:
national_park: true`;

    const userMessage = userPrompt
      ? `Generate 5 new trip ideas. The user has asked specifically for: ${userPrompt}\n\nStill obey the diversity and "would they actually go?" rules — interpret their request through the taste profile, don't override it.`
      : 'Generate 5 new trip ideas.';

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 3000,
      system,
      messages: [{ role: 'user', content: userMessage }],
    });

    const text = response.content.find(b => b.type === 'text')?.text ?? '';
    const fileRegex = /<file name="([^"]+)">([\s\S]*?)<\/file>/g;
    const files = [];
    let m;
    while ((m = fileRegex.exec(text)) !== null) {
      files.push({ name: m[1].trim(), content: m[2].trim() });
    }

    if (files.length === 0) throw new Error('Claude returned no file blocks — try again.');

    send(`Writing ${files.length} idea files...`);
    for (const file of files) {
      const path = join(ROOT, file.name);
      writeFileSync(path, file.content + '\n');
      const title = file.content.match(/^title: (.+)$/m)?.[1] ?? file.name;
      send(`  ✓ ${title}`);
    }

    send(`Done — ${files.length} new trips added. Reload to see them.`, true);
  });
}

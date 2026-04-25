import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();

function sse(controller, encoder, msg, done = false) {
  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ msg, done })}\n\n`));
}

function collectExistingDestinations() {
  const destinations = [];
  for (const stage of ['ideas', 'exploring', 'planning', 'completed']) {
    const dir = join(ROOT, stage);
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      let file;
      if (entry.isFile() && entry.name.endsWith('.md')) {
        file = join(dir, entry.name);
      } else if (entry.isDirectory()) {
        const ov = join(dir, entry.name, 'overview.md');
        if (existsSync(ov)) file = ov;
      }
      if (!file) continue;
      const dest = readFileSync(file, 'utf8').match(/^destination: (.+)$/m)?.[1]?.trim();
      if (dest) destinations.push(dest);
    }
  }
  return destinations;
}

export function POST() {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (msg, done = false) => sse(controller, encoder, msg, done);

      try {
        send('Reading home.md and existing trips...');
        const homeMd = readFileSync(join(ROOT, 'home.md'), 'utf8');
        const existing = collectExistingDestinations();
        const today = new Date().toISOString().slice(0, 10);

        send(`Asking Claude for 5 new ideas (avoiding ${existing.length} existing destinations)...`);

        const client = new Anthropic();

        const system = `You are a travel planning assistant for Evan and Erika, based in Overland Park, KS.

Here is their full personal context:
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

        const response = await client.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 3000,
          system,
          messages: [{ role: 'user', content: 'Generate 5 new trip ideas.' }],
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

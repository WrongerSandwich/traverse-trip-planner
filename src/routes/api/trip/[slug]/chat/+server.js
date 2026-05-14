import { json } from '@sveltejs/kit';
import { readHomeMd, readPlanningTrip, writePlanningSection, PLANNING_SECTIONS } from '$lib/server/data.js';
import { chat } from '$lib/server/ai.js';
import { getEffectiveConfig } from '$lib/server/config.js';

export const promise = {
  verb: 'Ask Field Guide',
  produces: 'A conversational reply and any updated planning sections written directly to disk.',
  time_seconds: 20,
  tokens_range: [2000, 6000],
};

function parseUpdates(text) {
  const updates = {};
  const re = /<update\s+section="([^"]+)">([\s\S]*?)<\/update>/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const section = m[1].trim();
    if (!PLANNING_SECTIONS.includes(section)) continue;
    updates[section] = m[2].trim();
  }
  return updates;
}

function parseReply(text) {
  const m = text.match(/<reply>([\s\S]*?)<\/reply>/);
  if (m) return m[1].trim();
  // Strip any update blocks and return whatever text remains
  return text.replace(/<update[\s\S]*?<\/update>/g, '').trim();
}

export async function POST({ params, request }) {
  const { slug } = params;
  const trip = readPlanningTrip(slug);
  if (!trip) return new Response('Trip not in planning stage', { status: 404 });

  const body = await request.json().catch(() => ({}));
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  if (messages.length === 0) return new Response('No messages', { status: 400 });

  const homeMd = readHomeMd();

  const sectionDump = PLANNING_SECTIONS
    .filter(s => trip.sections[s] !== undefined)
    .map(s => `<current section="${s}">\n${trip.sections[s]}\n</current>`)
    .join('\n\n');

  const system = `You are Traverse, a hands-on travel planning assistant helping refine an active trip plan. The trip is in the "planning" stage and the user is iterating on the section files (overview.md, route.md, stops.md, logistics.md).

Trip frontmatter (do not modify):
${trip.frontmatter || '(none)'}

Current section content:

${sectionDump}

Traveler context (home base, preferences, constraints):
${homeMd}

Today's date: ${new Date().toISOString().slice(0, 10)}

When the user asks for changes:
- If you can directly improve a section, output the FULL replacement markdown for that section inside <update section="overview|route|stops|logistics">...</update>. Only emit an <update> when you actually want to overwrite the file — partial diffs aren't supported. Preserve the section's existing structure and tone unless the user asks otherwise.
- Always include a brief, conversational <reply>...</reply> message explaining what you changed and why, or asking a clarifying question if you didn't make changes.
- Don't include frontmatter inside <update> blocks. Section files don't have frontmatter except overview.md, and you should never write its frontmatter — only the prose body.
- Be concrete. Name actual places, road numbers, hours, prices when you have them. If you're unsure about a fact, say so in <reply> rather than inventing.

Your output format:
<reply>Short conversational message to the user.</reply>

<update section="route">
... full replacement markdown ...
</update>

(zero or more <update> blocks; omit them if no edit is needed)`;

  const apiMessages = messages.map(m => ({
    role: m.role === 'user' ? 'user' : 'assistant',
    content: String(m.content || ''),
  }));

  const { text, usage } = await chat({
    ...getEffectiveConfig().features.chat,
    label: 'chat',
    maxTokens: 6000,
    system,
    messages: apiMessages,
  });

  const reply = parseReply(text);
  const updates = parseUpdates(text);

  for (const [section, content] of Object.entries(updates)) {
    writePlanningSection(trip.dir, section, trip.frontmatter, content);
  }

  return json({ reply, updates, usage });
}

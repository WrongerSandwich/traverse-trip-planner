import { json } from '@sveltejs/kit';
import { existsSync, statSync } from 'fs';
import { join } from 'path';
import { readHomeMd, readPlanningTrip, writePlanningSection, PLANNING_SECTIONS, rejectInvalidSlug } from '$lib/server/data.js';
import { chat } from '$lib/server/ai.js';
import { usageToTokens } from '$lib/utils/formatTokens.js';
import { getEffectiveConfig, getFeatureAvailability } from '$lib/server/config.js';
import { TraverseError, AdapterError } from '$lib/server/errors.js';
import { rateLimitResponse } from '$lib/server/rate-limit.js';
import { HAND_DEFAULTS, MAX_TOKENS } from '$lib/server/promises.js';
import { isAbort } from '$lib/utils/abort.js';

// Cap on conversation length passed to the model — prevents a chatty client
// from saturating the context window (and the bill) with a 1000-message thread.
const MAX_CHAT_MESSAGES = 50;

export const _promise = HAND_DEFAULTS.chat;

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

export async function POST(event) {
  const { params, request } = event;
  if (!getFeatureAvailability().homeMdReady) {
    return json({ code: 'home_not_configured' }, { status: 412 });
  }
  const invalid = rejectInvalidSlug(params.slug);
  if (invalid) return invalid;
  const { slug } = params;
  const trip = readPlanningTrip(slug);
  if (!trip) return new Response('Trip not in planning stage', { status: 404 });

  const limited = rateLimitResponse({ event, endpoint: 'chat', slugKey: slug });
  if (limited) return limited;

  // Snapshot section mtimes at read so we can detect a concurrent deepen-section
  // (or any other writer) that lands between the read and our writes. Without
  // this guard the chat handler would silently overwrite the deepen result
  // with the model's update based on the stale pre-deepen content. (#277)
  const mtimeSnapshot = {};
  for (const name of PLANNING_SECTIONS) {
    const fp = join(trip.dir, `${name}.md`);
    if (existsSync(fp)) mtimeSnapshot[name] = statSync(fp).mtimeMs;
  }

  const body = await request.json().catch(() => ({}));
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  if (messages.length === 0) return new Response('No messages', { status: 400 });
  if (messages.length > MAX_CHAT_MESSAGES) {
    return json(
      { code: 'invalid_input', error: `Conversation is too long (max ${MAX_CHAT_MESSAGES} messages). Start a new thread.` },
      { status: 400 }
    );
  }

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

  try {
    const { text, usage } = await chat({
      ...getEffectiveConfig().features.chat,
      label: 'chat',
      maxTokens: MAX_TOKENS.chat,
      system,
      messages: apiMessages,
      // Thread the client's abort signal so the Cancel affordance in the UI
      // actually aborts the model call — without this, clicking Cancel only
      // hides the spinner while the server happily writes the section file.
      signal: event.request.signal,
    });

    // The client disconnected before the model finished. No write happens
    // because the mtime guard below is unreached; return a quiet 499-style
    // payload (the client won't render anything from it).
    if (event.request.signal?.aborted) {
      return json({ error: 'cancelled' }, { status: 499 });
    }

    if (!text || !text.trim()) {
      return json({ error: 'empty_model_output' }, { status: 502 });
    }

    const reply = parseReply(text);
    const updates = parseUpdates(text);

    // Optimistic-concurrency: re-stat each section before applying its update.
    // If any section's mtime moved during the chat round-trip, a concurrent
    // deepen-section (or another mutator) wrote it. Bail with 409 + a typed
    // ERROR_REGISTRY code so the UI prompts the user to re-run; their
    // <reply> is discarded but no other agent's work is lost. (#277)
    for (const section of Object.keys(updates)) {
      const fp = join(trip.dir, `${section}.md`);
      if (existsSync(fp)) {
        const current = statSync(fp).mtimeMs;
        // Two-sided check:
        //   - file existed at snapshot AND mtime changed → another writer touched it
        //   - file did NOT exist at snapshot but exists now → another writer (deepen-section
        //     creating a previously-empty file) raced us. Without this branch, chat would
        //     happily overwrite the fresh research because mtimeSnapshot[section] === undefined.
        const appeared = mtimeSnapshot[section] === undefined;
        const mutated  = mtimeSnapshot[section] !== undefined && current !== mtimeSnapshot[section];
        if (appeared || mutated) {
          return json(
            { error: 'section_changed_during_chat', context: { section } },
            { status: 409 },
          );
        }
      }
    }

    for (const [section, content] of Object.entries(updates)) {
      writePlanningSection(trip.dir, section, trip.frontmatter, content);
    }

    return json({ reply, updates, usage, tokens: usageToTokens(usage) });
  } catch (err) {
    if (isAbort(err)) {
      return json({ error: 'cancelled' }, { status: 499 });
    }
    if (err instanceof TraverseError) {
      return json({ error: err.code }, { status: 502 });
    }
    if (err instanceof AdapterError) {
      return json(
        { error: 'provider_error', context: { provider: err.provider, summary: err.message } },
        { status: 502 },
      );
    }
    console.error('[chat]', err);
    return json({ error: 'network_error' }, { status: 502 });
  }
}

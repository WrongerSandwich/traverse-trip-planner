import { json } from '@sveltejs/kit';
import { writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { ROOT, readHomeMd, getTripFiles, invalidateEnrichCache } from '$lib/server/data.js';
import { chat } from '$lib/server/ai.js';
import { usageToTokens } from '$lib/utils/formatTokens.js';
import { getEffectiveConfig, getFeatureAvailability } from '$lib/server/config.js';
import { HAND_DEFAULTS } from '$lib/server/promises.js';

export const _promise = HAND_DEFAULTS['retro-questions'];

function loadCompletedTrip(slug) {
  const dir = join(ROOT, 'completed', slug);
  if (!existsSync(dir)) return null;
  const files = getTripFiles(slug);
  if (!files || files.stage !== 'completed') return null;
  return { dir, files: files.files };
}

function tripContextDump(files) {
  const parts = [];
  for (const name of ['overview', 'itinerary', 'stops', 'route', 'logistics']) {
    const body = files[name];
    if (body && body.trim()) parts.push(`<section name="${name}">\n${body.trim()}\n</section>`);
  }
  return parts.join('\n\n');
}

// POST — generate trip-specific retro questions.
export async function POST({ params }) {
  if (!getFeatureAvailability().homeMdReady) {
    return json({ code: 'home_not_configured' }, { status: 412 });
  }
  const { slug } = params;
  const trip = loadCompletedTrip(slug);
  if (!trip) return new Response('Trip not in completed stage', { status: 404 });
  if (existsSync(join(trip.dir, 'notes.md'))) {
    return new Response('Retro already written — delete notes.md to redo', { status: 409 });
  }

  const homeMd = readHomeMd();
  const context = tripContextDump(trip.files);

  const system = `You are Traverse, helping a traveler reflect on a trip they just finished. Your task: produce exactly 5 retrospective questions tailored to this specific trip.

Rules:
- The first question MUST reference a specific stop, place, or planned activity from the trip context so the user feels recognized.
- The remaining 4 should cover: a surprise (good or bad), something they might skip, how reality compared to their plan, and a forward-looking thought ("would you go back?", "what would you do differently?").
- Keep each question to one sentence. Conversational, not survey-formal.
- Output ONLY a JSON array of 5 strings, nothing else. No markdown fences, no preamble.

Traveler context (for tone, taste, voice):
${homeMd}

Trip the user just finished:
${context || '(no planning sections available)'}`;

  const { text, usage } = await chat({
    ...getEffectiveConfig().features.retro,
    label: 'retro-questions',
    maxTokens: 600,
    system,
    messages: [{ role: 'user', content: 'Generate the 5 questions now.' }],
  });

  let questions;
  try {
    const cleaned = text.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    questions = JSON.parse(cleaned);
    if (!Array.isArray(questions) || questions.length === 0) throw new Error('not an array');
    questions = questions.slice(0, 5).map(q => String(q).trim()).filter(Boolean);
    if (questions.length < 3) throw new Error('too few questions');
  } catch {
    return new Response('Field guide returned malformed questions — try again', { status: 502 });
  }

  return json({ questions, usage, tokens: usageToTokens(usage) });
}

function yamlEscape(str) {
  if (str == null) return '';
  const s = String(str);
  if (/[:#\n"']/.test(s)) return JSON.stringify(s);
  return s;
}

function buildNotesMd({ rating, wouldRepeat, highlights, body, dateCompleted }) {
  const fmLines = ['---'];
  fmLines.push(`date_completed: ${dateCompleted}`);
  if (Number.isFinite(rating)) fmLines.push(`rating: ${rating}`);
  fmLines.push(`would_repeat: ${wouldRepeat ? 'true' : 'false'}`);
  if (Array.isArray(highlights) && highlights.length > 0) {
    fmLines.push('highlights:');
    for (const h of highlights) fmLines.push(`  - ${yamlEscape(h)}`);
  }
  fmLines.push('---');
  return `${fmLines.join('\n')}\n\n${body.trim()}\n`;
}

// PUT — write notes.md from user answers + structured fields.
export async function PUT({ params, request }) {
  const { slug } = params;
  const trip = loadCompletedTrip(slug);
  if (!trip) return new Response('Trip not in completed stage', { status: 404 });
  if (existsSync(join(trip.dir, 'notes.md'))) {
    return new Response('Retro already written', { status: 409 });
  }

  const body = await request.json().catch(() => ({}));
  const questions = Array.isArray(body?.questions) ? body.questions.map(String) : [];
  const answers   = Array.isArray(body?.answers)   ? body.answers.map(String)   : [];
  const rating = Number.isFinite(body?.rating) ? Math.max(1, Math.min(5, Math.round(body.rating))) : null;
  const wouldRepeat = Boolean(body?.would_repeat);

  if (questions.length === 0 || answers.length === 0) {
    return new Response('Missing questions or answers', { status: 400 });
  }
  if (questions.length !== answers.length) {
    return new Response('Questions and answers must align', { status: 400 });
  }

  const qaDump = questions
    .map((q, i) => `Q: ${q}\nA: ${answers[i]?.trim() || '(no answer)'}`)
    .join('\n\n');

  const context = tripContextDump(trip.files);

  const system = `You are Traverse, writing up a trip retrospective from the traveler's answers. Output ONLY the prose body of notes.md — no frontmatter, no JSON, no preamble, no "Here's your retro:" lead-in.

Structure:
- Open with a 1-2 sentence summary paragraph that captures the overall feeling of the trip.
- Then use 2-4 ## headings to group the user's reflections (you choose the headings based on what they said — common choices: "What worked", "What I'd skip", "Surprises", "Would I go back?"). Pull quotes and specifics directly from their answers.
- Then a "## Highlights" section listing 2-4 highlights as a markdown bullet list. These will be parsed and lifted into the frontmatter, so each bullet must be a single concrete moment or experience (e.g. "Watching the sunset from Lover's Leap" — not "great views"). DO NOT include this section if the answers don't surface anything concrete.
- Keep it personal and specific. Pull names, places, and details from both the trip context and the user's answers.
- No bullet lists outside Highlights. No tables.

Length target: 200-400 words of prose plus the highlights bullets.`;

  const userMsg = `Trip context (planning sections + itinerary):
${context || '(no planning sections available)'}

User's retrospective answers:
${qaDump}

Structured fields they selected:
- Rating: ${rating ?? '(none)'} / 5
- Would do it again: ${wouldRepeat ? 'yes' : 'no'}

Write the notes.md body now.`;

  const { text, usage } = await chat({
    ...getEffectiveConfig().features.retro,
    label: 'retro-save',
    maxTokens: 2000,
    system,
    messages: [{ role: 'user', content: userMsg }],
  });

  let prose = text.trim();
  // Strip an accidental frontmatter block if the model added one despite the instruction.
  prose = prose.replace(/^---\n[\s\S]*?\n---\n*/, '').trim();

  // Extract highlights from the "## Highlights" section if present, lift into frontmatter.
  const highlights = [];
  const hlMatch = prose.match(/^##\s+Highlights\s*\n([\s\S]*?)(?=\n##\s|$)/im);
  if (hlMatch) {
    const bulletRe = /^\s*[-*]\s+(.+?)\s*$/gm;
    let m;
    while ((m = bulletRe.exec(hlMatch[1])) !== null) {
      highlights.push(m[1].replace(/^[*_]+|[*_]+$/g, '').trim());
    }
  }

  const noteContent = buildNotesMd({
    rating,
    wouldRepeat,
    highlights,
    body: prose,
    dateCompleted: new Date().toISOString().slice(0, 10),
  });

  try {
    writeFileSync(join(trip.dir, 'notes.md'), noteContent);
  } catch (err) {
    return new Response(`Failed to write notes.md: ${err.message}`, { status: 500 });
  }

  invalidateEnrichCache();
  return json({ ok: true, usage, tokens: usageToTokens(usage) });
}

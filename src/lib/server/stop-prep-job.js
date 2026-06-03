// Stop-prep background job (#406).
//
// For each visible candidate stop that hasn't been prepped (no tips), makes
// one chat() call (NO web search) to generate:
//   - tips: string[]        read-only in-trip pointers (capped at 5)
//   - todos: {id, text, done: false}[]   pre-trip to-dos (capped at 4)
//
// Mirrors enrichCandidatesJob's contract:
//   - reads candidates from disk on each iteration (concurrent edits survive)
//   - skips stops with tips already set, unless opts.force is true
//   - skips stops with hidden: true
//   - writes candidates.yaml after each successful prep
//   - respects an AbortController.signal (checked at the top of each iteration)
//   - reads tripContext ONCE up front and passes it to every per-stop call
//
// On total failure (every attempted stop fails), throws a TraverseError with
// code 'stop_prep_all_failed' so the route handler can route it through failJob.
// Partial failures complete normally with a result summary.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'path';
import { parse as yamlParse } from 'yaml';
import { findTripFile, findTripLocation, parseFrontmatter } from './data.js';
import { readCandidates, writeCandidates, makeCandidateId } from './candidates.js';
import { readPlan } from './plan.js';
import { chat } from './ai.js';
import { getEffectiveConfig } from './config.js';
import { TraverseError } from './errors.js';
import { MAX_TOKENS } from './promises.js';

const MAX_TIPS = 5;
const MAX_TODOS = 4;

/**
 * Read the destination string from the trip's overview.md frontmatter.
 */
function readDestination(slug) {
  const path = findTripFile(slug);
  if (!path || !existsSync(path)) return '';
  const raw = readFileSync(path, 'utf8');
  const fm = parseFrontmatter(raw) || {};
  return fm.destination ?? '';
}

/**
 * Build a combined trip context string from logistics.md body and plan
 * gotchas / field_guide_notes. Read once and reused across all per-stop calls.
 */
function readTripContext(slug) {
  const parts = [];
  const loc = findTripLocation(slug);
  if (loc) {
    const logisticsPath = join(loc.path, 'logistics.md');
    if (existsSync(logisticsPath)) {
      const body = readFileSync(logisticsPath, 'utf8').trim();
      if (body) parts.push(body);
    }
  }
  const plan = readPlan(slug);
  if (plan) {
    const gotchas = Array.isArray(plan.gotchas)
      ? plan.gotchas.map((g) => String(g).trim()).filter(Boolean)
      : [];
    if (gotchas.length) parts.push('Gotchas:\n' + gotchas.map((g) => `- ${g}`).join('\n'));
    const notes = Array.isArray(plan.field_guide_notes)
      ? plan.field_guide_notes.map((n) => String(n).trim()).filter(Boolean)
      : [];
    if (notes.length) parts.push('Field guide:\n' + notes.map((n) => `- ${n}`).join('\n'));
  }
  return parts.join('\n\n');
}

const SYSTEM = `You help a road-tripper prepare for a single stop on their trip.
Given the stop and trip context, produce:
- tips: 2 to 5 short read-only in-trip pointers (best entrance, where to park, what to bring, light timing). Each a terse phrase, no leading bullet.
- todos: 0 to 4 concrete pre-trip to-dos the traveler should check off before leaving (book tickets, reserve parking, confirm seasonal hours, download offline maps). Plain strings, actionable, no leading bullet.
Only include items that are genuinely useful for THIS stop. Omit filler.
Respond with a single YAML block wrapped in <prep></prep> tags, with keys "tips" and "todos", each a list of strings.`;

function buildUserMessage(stop, destination, tripContext) {
  const lines = [`Trip: ${destination}`];
  if (tripContext) lines.push(`Trip context:\n${tripContext}`);
  lines.push(`Stop: ${stop.name}${stop.category ? ` (${stop.category})` : ''}`);
  if (stop.description) lines.push(`Description: ${stop.description}`);
  if (stop.address) lines.push(`Address: ${stop.address}`);
  if (stop.hours) lines.push(`Hours: ${stop.hours}`);
  return lines.join('\n');
}

/**
 * Extract the <prep>…</prep> block from the model's text response and parse
 * the YAML inside. Returns { tips, todoTexts } or null on any failure.
 * Caps tips at MAX_TIPS and todoTexts at MAX_TODOS.
 */
function extractPrep(text) {
  if (typeof text !== 'string') return null;
  const m = text.match(/<prep>([\s\S]*?)<\/prep>/);
  if (!m) return null;
  let data;
  try {
    data = yamlParse(m[1]);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const tips = Array.isArray(data.tips)
    ? data.tips.map((t) => String(t).trim()).filter(Boolean).slice(0, MAX_TIPS)
    : [];
  const todoTexts = Array.isArray(data.todos)
    ? data.todos.map((t) => String(t).trim()).filter(Boolean).slice(0, MAX_TODOS)
    : [];
  return { tips, todoTexts };
}

/**
 * Generate tips and pre-trip todos for each visible, un-prepped candidate stop.
 *
 * @param {string} slug
 * @param {object} [opts]
 * @param {AbortSignal} [opts.signal]
 * @param {boolean} [opts.force] — when true, re-prep stops that already have tips
 * @returns {Promise<{ attempted: number, prepped: number, failed: number, skipped: number, tokens: number }>}
 */
export async function stopPrepJob(slug, opts = {}) {
  const signal = opts.signal;
  const force = opts.force === true;

  // No candidates file => nothing to do. Bail out quietly.
  const initial = readCandidates(slug);
  if (!initial) return { attempted: 0, prepped: 0, failed: 0, skipped: 0, tokens: 0 };

  // Read trip context ONCE — passed to every per-stop chat() call.
  const destination = readDestination(slug);
  const tripContext = readTripContext(slug);

  let attempted = 0;
  let prepped = 0;
  let failed = 0;
  let skipped = 0;
  let tokens = 0;

  // Build the work list from the initial read. We re-read candidates inside
  // the loop on each iteration so concurrent UI edits survive — the write-back
  // uses freshly-read state, not a stale snapshot.
  const work = [];
  for (const s of initial.stops ?? []) {
    if (s.hidden) { skipped++; continue; }
    if (!force && Array.isArray(s.tips) && s.tips.length > 0) { skipped++; continue; }
    if (!s.id || !s.name) continue;
    work.push({ id: s.id, name: s.name });
  }

  const featureCfg = getEffectiveConfig().features['stop-prep'] ?? {};

  for (const item of work) {
    // Top-of-iteration abort check — mirrors enrich-job's contract.
    if (signal?.aborted) break;

    let response = null;
    try {
      // Re-read fresh so concurrent UI edits are visible.
      const fresh = readCandidates(slug);
      if (!fresh) break;
      const target = fresh.stops.find((s) => s.id === item.id);
      if (!target) { continue; }
      if (target.hidden) { skipped++; continue; }

      attempted++;

      response = await chat({
        ...featureCfg,
        system: SYSTEM,
        messages: [
          {
            role: 'user',
            content: buildUserMessage(target, destination, tripContext),
          },
        ],
        maxTokens: MAX_TOKENS['stop-prep'],
        label: 'stop-prep',
        signal,
      });
    } catch (e) {
      if (e?.name === 'AbortError' || signal?.aborted) break;
      console.warn(`[stop-prep] ${slug}: failed stop "${item.name}":`, e?.message ?? e);
      failed++;
      continue;
    }

    // Accumulate token usage (defensive: check both field name variants).
    if (response?.usage) {
      tokens += (response.usage.input ?? response.usage.input_tokens ?? 0)
              + (response.usage.output ?? response.usage.output_tokens ?? 0);
    }

    // Parse the <prep> block.
    const parsed = extractPrep(response?.text ?? '');
    // Both empty (no tips AND no todos) counts as a per-stop failure.
    if (!parsed || (parsed.tips.length === 0 && parsed.todoTexts.length === 0)) {
      failed++;
      continue;
    }

    // Re-read right before write so concurrent edits aren't stomped.
    const fresh2 = readCandidates(slug);
    if (!fresh2) { continue; }
    const writeTarget = fresh2.stops.find((s) => s.id === item.id);
    if (!writeTarget) { continue; }

    // Wrap todo strings into {id, text, done: false} objects.
    // Track generated ids via an array so makeCandidateId can de-dupe.
    const seenIds = [];
    writeTarget.tips = parsed.tips;
    writeTarget.todos = parsed.todoTexts.map((text) => {
      const id = makeCandidateId(text, seenIds);
      seenIds.push(id);
      return { id, text, done: false };
    });
    writeCandidates(slug, fresh2);
    prepped++;
  }

  // Total failure guard: if we attempted at least one stop, none succeeded,
  // AND at least one genuinely failed, throw so the route handler can mark
  // the job failed.
  if (attempted > 0 && prepped === 0 && failed > 0) {
    throw new TraverseError(
      'stop_prep_all_failed',
      `stop-prep: every attempted stop failed (${failed} of ${attempted})`,
    );
  }

  return { attempted, prepped, failed, skipped, tokens };
}

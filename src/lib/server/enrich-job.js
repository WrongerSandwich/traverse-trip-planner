// Enrich-candidates follow-on background job (#403).
//
// Runs after geocode-candidates completes. For each visible stop candidate
// that's missing hours/website/phone, makes one chat() call with web_search
// to fill the gaps. Mirrors geocode-job's contract:
//   - reads candidates from disk on each iteration (concurrent edits survive)
//   - skips entries with all three fields set, unless opts.force is true
//   - skips entries with hidden: true
//   - writes candidates.yaml after each successful enrichment
//   - respects an AbortController.signal (checked at the top of each iteration)
//
// On total failure (every attempted stop fails), throws a TraverseError with
// code 'enrich_all_failed' so the route handler can route it through failJob.
// Partial failures complete normally with a result summary.

import { existsSync, readFileSync } from 'node:fs';
import { parse as yamlParse } from 'yaml';
import { findTripFile, parseFrontmatter } from './data.js';
import { readCandidates, writeCandidates } from './candidates.js';
import { chat } from './ai.js';
import { search, searchToolDefinition } from './search.js';
import { getEffectiveConfig } from './config.js';
import { TraverseError } from './errors.js';
import { MAX_TOKENS } from './promises.js';

const URL_RE = /^https?:\/\//i;

/**
 * Validate a parsed field value for hours/website/phone.
 * Returns the trimmed string on success, null on failure (log-and-drop the field).
 */
function validateField(name, value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (name === 'website' && !URL_RE.test(trimmed)) return null;
  if (name === 'phone' && !/\d/.test(trimmed)) return null;
  return trimmed;
}

/**
 * Extract the <enrich>…</enrich> block from the model's text response and
 * parse its YAML. Returns the parsed object, or null on any failure.
 */
function extractEnrichBlock(text) {
  if (typeof text !== 'string') return null;
  const m = text.match(/<enrich>([\s\S]*?)<\/enrich>/);
  if (!m) return null;
  try {
    return yamlParse(m[1]);
  } catch {
    return null;
  }
}

/**
 * Read the destination string from the trip's overview.md frontmatter.
 * Used to build the `in <destination>` context suffix when no address is known.
 */
function readDestination(slug) {
  const path = findTripFile(slug);
  if (!path || !existsSync(path)) return '';
  const raw = readFileSync(path, 'utf8');
  const fm = parseFrontmatter(raw) || {};
  return fm.destination ?? '';
}

/**
 * Build the user message for a single stop enrichment call.
 *
 * Location context priority:
 *   1. `address` — most specific (from geocode-candidates' reverse lookup)
 *   2. `destination` — trip-level fallback
 *   3. (empty) — no location context
 */
function buildUserMessage({ stopName, address, destination }) {
  const where = address
    ? `(at ${address})`
    : destination
      ? `in ${destination}`
      : '';

  const whereStr = where ? ` ${where}` : '';

  return [
    `Find current operating hours, official website URL, and phone number for "${stopName}"${whereStr}.`,
    '',
    'Use the web_search tool to verify. If you cannot find a field with reasonable confidence, omit it. Do not invent.',
    '',
    'Respond with exactly one <enrich>...</enrich> block containing YAML. Example:',
    '',
    '<enrich>',
    'hours: "Mon-Sat 9am-5pm; closed Sundays"',
    'website: "https://example.com"',
    'phone: "(555) 123-4567"',
    '</enrich>',
  ].join('\n');
}

/**
 * Enrich each visible stop candidate with hours/website/phone.
 *
 * @param {string} slug
 * @param {object} [opts]
 * @param {AbortSignal} [opts.signal]
 * @param {boolean} [opts.force] — when true, ignore the "all three set" skip
 * @returns {Promise<{ attempted: number, enriched: number, failed: number, skipped: number, tokens: number }>}
 */
export async function enrichCandidatesJob(slug, opts = {}) {
  const signal = opts.signal;
  const force = opts.force === true;

  // No candidates file => nothing to do. Bail out quietly.
  const initial = readCandidates(slug);
  if (!initial) return { attempted: 0, enriched: 0, failed: 0, skipped: 0, tokens: 0 };

  const destination = readDestination(slug);
  let attempted = 0;
  let enriched = 0;
  let failed = 0;
  let skipped = 0;
  let tokens = 0;

  // Build the work list from the initial read. We re-read candidates inside
  // the loop on each iteration so concurrent UI edits (un-hide, add, etc.)
  // survive — the write-back uses the freshly-read state, not a stale snapshot.
  const work = [];
  for (const s of initial.stops ?? []) {
    if (s.hidden) { skipped++; continue; }
    const hasAll = !!(s.hours && s.website && s.phone);
    if (hasAll && !force) { skipped++; continue; }
    if (!s.id || !s.name) continue;
    work.push({ id: s.id, name: s.name });
  }

  for (const item of work) {
    // Top-of-iteration abort check — mirrors geocode-job's contract.
    if (signal?.aborted) break;

    let response = null;
    try {
      // Re-read fresh so concurrent UI edits are visible.
      const fresh = readCandidates(slug);
      if (!fresh) break;
      const target = fresh.stops.find((c) => c.id === item.id);
      if (!target) { continue; }
      if (target.hidden) { skipped++; continue; }

      attempted++;

      const featureCfg = getEffectiveConfig().features['enrich-candidates'] ?? {};
      response = await chat({
        ...featureCfg,
        system: 'You are a research assistant. Return one YAML block in <enrich> tags. Use the web_search tool if you are unsure. Never invent data.',
        messages: [
          {
            role: 'user',
            content: buildUserMessage({
              stopName: target.name,
              address: target.address,
              destination,
            }),
          },
        ],
        maxTokens: MAX_TOKENS['enrich-candidates'],
        tools: [searchToolDefinition()],
        onToolCall: async (toolUse) => {
          if (toolUse.name === 'web_search') {
            return await search(toolUse.input);
          }
          return null;
        },
        label: 'enrich-candidates',
        signal,
      });
    } catch (e) {
      if (e?.name === 'AbortError' || signal?.aborted) break;
      console.warn(`[enrich-candidates] ${slug}: failed stop "${item.name}":`, e?.message ?? e);
      failed++;
      continue;
    }

    // Accumulate token usage.
    if (response?.usage) {
      tokens += (response.usage.input ?? response.usage.input_tokens ?? 0)
              + (response.usage.output ?? response.usage.output_tokens ?? 0);
    }

    // Parse the <enrich> block.
    const parsed = extractEnrichBlock(response?.text ?? '');
    if (!parsed) { failed++; continue; }

    // Validate each field — log-and-drop on failure, not the whole stop.
    const hours = validateField('hours', parsed.hours);
    const website = validateField('website', parsed.website);
    const phone = validateField('phone', parsed.phone);
    if (!hours && !website && !phone) { failed++; continue; }

    // Re-read right before write so concurrent edits aren't stomped.
    const fresh2 = readCandidates(slug);
    if (!fresh2) { failed++; continue; }
    const target2 = fresh2.stops.find((c) => c.id === item.id);
    if (!target2) { failed++; continue; }
    if (target2.hidden) {
      // Hidden during the in-flight chat() — silently skip; undo the attempted
      // count so telemetry reflects only genuinely attempted stops.
      attempted--;
      skipped++;
      continue;
    }

    // Apply fields: only overwrite existing values when force is set.
    if (force || !target2.hours) { if (hours) target2.hours = hours; }
    if (force || !target2.website) { if (website) target2.website = website; }
    if (force || !target2.phone) { if (phone) target2.phone = phone; }

    writeCandidates(slug, fresh2);
    enriched++;
  }

  // Total failure guard: if we attempted at least one stop and none succeeded,
  // throw so the route handler can mark the job as failed rather than complete.
  if (attempted > 0 && enriched === 0) {
    throw new TraverseError(
      'enrich_all_failed',
      `enrich-candidates: every attempted stop failed (${failed} of ${attempted})`,
    );
  }

  return { attempted, enriched, failed, skipped, tokens };
}

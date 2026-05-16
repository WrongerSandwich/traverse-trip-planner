// Telemetry-driven calibration for the `_promise` time/token estimates
// surfaced by `PromiseTooltip` / `PromiseBody`.
//
// See docs/ai-workflow-ux.md §3.
//
// One ring buffer per `chat()` label. `recordInvocation()` is called from
// `src/lib/server/ai.js` at the same place we log token usage; the route
// handlers don't need to opt in. `getStats(label)` returns rolling
// p10/p50/p90 once we have at least N=10 samples. With fewer samples,
// or when the telemetry p50 deviates >DRIFT_RATIO from the supplied
// hand-tuned default (a signal that something else broke), `getStats`
// returns null and the caller falls back to its hand default.
//
// Disk-backed at `.workflow-stats.json` so the rolling window survives
// restart, following the same pattern as the existing caches in
// `src/lib/server/data.js`.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// ─── Configuration ───────────────────────────────────────────────────────────

const ROOT = process.cwd();
const STATS_PATH = join(ROOT, '.workflow-stats.json');

/** Maximum samples retained per label. Older samples are evicted FIFO. */
export const MAX_SAMPLES_PER_LABEL = 50;

/** Stale-sample retention window. Samples older than this are dropped at
 *  every read so the rolling window doesn't include ancient data after a
 *  long quiet period. */
export const STALE_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

/** Minimum samples required before `getStats` returns telemetry. Below this
 *  threshold the caller falls back to its hand-tuned default. */
export const MIN_SAMPLES = 10;

/** When telemetry p50 deviates by more than this factor from the hand
 *  default, treat the telemetry as suspect and return null (callers fall
 *  back to defaults, and a warning is logged). */
export const DRIFT_RATIO = 2;

/** Debounce window for disk writes — we batch invocations recorded within
 *  this window into a single flush. */
const FLUSH_DEBOUNCE_MS = 1000;

// ─── In-memory state ─────────────────────────────────────────────────────────

/** @type {Map<string, Array<{ ts: number, durationMs: number, tokensIn: number, tokensOut: number }>>} */
const samplesByLabel = new Map();

let loaded = false;
/** @type {NodeJS.Timeout | null} */
let flushTimer = null;
let dirty = false;

function loadFromDisk() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = readFileSync(STATS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && parsed.samples && typeof parsed.samples === 'object') {
      for (const [label, arr] of Object.entries(parsed.samples)) {
        if (!Array.isArray(arr)) continue;
        const cleaned = arr.filter(isValidSample);
        if (cleaned.length > 0) samplesByLabel.set(label, cleaned);
      }
    }
  } catch {
    // Missing or corrupt file is fine — start fresh.
  }
}

function isValidSample(s) {
  return (
    s &&
    typeof s.ts === 'number' &&
    typeof s.durationMs === 'number' &&
    typeof s.tokensIn === 'number' &&
    typeof s.tokensOut === 'number'
  );
}

function scheduleFlush() {
  dirty = true;
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    if (!dirty) return;
    dirty = false;
    flushToDisk();
  }, FLUSH_DEBOUNCE_MS);
  // Don't keep the event loop alive just for the flush.
  if (typeof flushTimer.unref === 'function') flushTimer.unref();
}

function flushToDisk() {
  const payload = { samples: {} };
  for (const [label, arr] of samplesByLabel.entries()) {
    if (arr.length > 0) payload.samples[label] = arr;
  }
  try {
    writeFileSync(STATS_PATH, JSON.stringify(payload));
  } catch (e) {
    console.warn(`[workflow-stats] failed to flush ${STATS_PATH}: ${e.message}`);
  }
}

// ─── Aggregation helpers ─────────────────────────────────────────────────────

function trimStale(arr, nowMs) {
  const cutoff = nowMs - STALE_WINDOW_MS;
  // Filter out stale entries and cap at MAX_SAMPLES_PER_LABEL (most recent).
  let fresh = arr.filter((s) => s.ts >= cutoff);
  if (fresh.length > MAX_SAMPLES_PER_LABEL) {
    fresh = fresh.slice(fresh.length - MAX_SAMPLES_PER_LABEL);
  }
  return fresh;
}

function percentile(sortedNumbers, p) {
  if (sortedNumbers.length === 0) return 0;
  if (sortedNumbers.length === 1) return sortedNumbers[0];
  // Simple nearest-rank percentile. Good enough for N≤50; no interpolation needed.
  const idx = Math.min(
    sortedNumbers.length - 1,
    Math.max(0, Math.ceil((p / 100) * sortedNumbers.length) - 1),
  );
  return sortedNumbers[idx];
}

function aggregate(samples) {
  if (samples.length === 0) return null;
  const durations = samples.map((s) => s.durationMs / 1000).sort((a, b) => a - b);
  const tokens = samples.map((s) => s.tokensIn + s.tokensOut).sort((a, b) => a - b);
  return {
    sample_count: samples.length,
    window_start: samples[0].ts,
    window_end: samples[samples.length - 1].ts,
    p10_seconds: Math.round(percentile(durations, 10)),
    p50_seconds: Math.round(percentile(durations, 50)),
    p90_seconds: Math.round(percentile(durations, 90)),
    p10_tokens: Math.round(percentile(tokens, 10)),
    p50_tokens: Math.round(percentile(tokens, 50)),
    p90_tokens: Math.round(percentile(tokens, 90)),
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Record one AI invocation. Called from `chat()` after the call returns
 * (success or error — both contribute to honest timing). Failures should
 * pass `tokensIn`/`tokensOut` as 0 if usage is unavailable.
 *
 * Never throws — recording is best-effort and must not affect the caller.
 *
 * @param {{ label: string, startMs: number, endMs: number, tokensIn?: number, tokensOut?: number }} entry
 */
export function recordInvocation(entry) {
  try {
    if (!entry || typeof entry.label !== 'string' || !entry.label) return;
    const startMs = Number(entry.startMs);
    const endMs = Number(entry.endMs);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return;
    loadFromDisk();

    const sample = {
      ts: endMs,
      durationMs: endMs - startMs,
      tokensIn: Number(entry.tokensIn) || 0,
      tokensOut: Number(entry.tokensOut) || 0,
    };

    const arr = samplesByLabel.get(entry.label) ?? [];
    arr.push(sample);
    // Trim immediately so the in-memory buffer never grows beyond limits.
    const trimmed = trimStale(arr, Date.now());
    samplesByLabel.set(entry.label, trimmed);

    scheduleFlush();
  } catch (e) {
    // Best-effort: never break the AI call path.
    console.warn(`[workflow-stats] recordInvocation failed: ${e?.message ?? e}`);
  }
}

/**
 * Compute rolling stats for one label.
 *
 * Returns null when:
 *   - we have fewer than MIN_SAMPLES samples (fall back to hand defaults)
 *   - telemetry p50 deviates >DRIFT_RATIO from `handDefaultSeconds`
 *     (something is wrong; surface the warning and keep the hand default)
 *
 * @param {string} label
 * @param {{ handDefaultSeconds?: number }} [opts]
 */
export function getStats(label, opts = {}) {
  loadFromDisk();
  const arr = samplesByLabel.get(label);
  if (!arr || arr.length === 0) return null;

  const fresh = trimStale(arr, Date.now());
  if (fresh.length !== arr.length) {
    // Lazily prune in-memory so subsequent reads are cheap.
    samplesByLabel.set(label, fresh);
    if (fresh.length > 0) scheduleFlush();
  }
  if (fresh.length < MIN_SAMPLES) return null;

  const stats = aggregate(fresh);
  if (!stats) return null;

  const handDefault = Number(opts.handDefaultSeconds);
  if (Number.isFinite(handDefault) && handDefault > 0 && stats.p50_seconds > 0) {
    const ratio = stats.p50_seconds > handDefault
      ? stats.p50_seconds / handDefault
      : handDefault / stats.p50_seconds;
    if (ratio > DRIFT_RATIO) {
      console.warn(
        `[workflow-stats] drift: ${label} telemetry p50=${stats.p50_seconds}s vs hand default=${handDefault}s — investigate`,
      );
      return null;
    }
  }

  return stats;
}

/**
 * Snapshot of stats for every label that has at least one sample. The
 * minimum-samples / drift guards do NOT apply here — this is the debug
 * view, intended for the `/api/workflow-stats` endpoint. Each entry
 * carries `sample_count` so callers can decide whether they trust it.
 */
export function getAllStats() {
  loadFromDisk();
  const out = {};
  const now = Date.now();
  for (const [label, arr] of samplesByLabel.entries()) {
    const fresh = trimStale(arr, now);
    if (fresh.length === 0) continue;
    if (fresh.length !== arr.length) samplesByLabel.set(label, fresh);
    out[label] = aggregate(fresh);
  }
  return out;
}

/**
 * Replace the time/token fields of a `_promise` object with telemetry
 * values when we have ≥MIN_SAMPLES samples and drift is within tolerance.
 * Otherwise returns the input unchanged. The shape is preserved so
 * `PromiseTooltip` / `PromiseBody` consume it without modification.
 *
 * @param {string} label
 * @param {{ verb: string, produces: string, time_seconds: number, tokens_range: [number, number] }} defaults
 */
export function resolvePromise(label, defaults) {
  if (!defaults) return defaults;
  const stats = getStats(label, { handDefaultSeconds: defaults.time_seconds });
  if (!stats) return defaults;
  // Don't replace token range if the route doesn't consume tokens
  // (e.g. regeocode declares [0, 0]).
  const handHasTokens = (defaults.tokens_range?.[0] ?? 0) > 0 || (defaults.tokens_range?.[1] ?? 0) > 0;
  return {
    ...defaults,
    time_seconds: stats.p50_seconds || defaults.time_seconds,
    tokens_range: handHasTokens
      ? [stats.p10_tokens, stats.p90_tokens]
      : defaults.tokens_range,
  };
}

// ─── Test seam ───────────────────────────────────────────────────────────────

/** Test only: clear in-memory state and force re-load on next call. */
export function _resetForTests() {
  samplesByLabel.clear();
  loaded = false;
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  dirty = false;
}

/** Test only: force a synchronous flush of pending changes. */
export function _flushNow() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  flushToDisk();
  dirty = false;
}

/** Test only: path used for the on-disk backing file. */
export const _STATS_PATH = STATS_PATH;

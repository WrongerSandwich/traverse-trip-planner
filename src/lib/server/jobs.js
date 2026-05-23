// Server-side job registry for Ambient Background workflows.
//
// See docs/ai-workflow-ux.md §6 (background-status surface) and §8 (edge cases).
//
// Two coordinated sources of truth:
//   1. An in-memory Map keyed by `${workflow}:${slug}` — authoritative for live
//      state. The indicator UI reads `listJobs()` and the per-job AbortController
//      lives here.
//   2. A `running: '<workflow>'` flag in the trip's frontmatter — a recovery
//      hint that survives server restart. On boot, `sweepStaleJobs()` reconciles
//      any orphaned flags left by a crashed process.
//
// The in-memory map is authoritative when present. Frontmatter is only consulted
// during the restart sweep — not during normal live-state reads. This avoids
// re-parsing files on every indicator poll.
//
// ─── Multi-instance workflow key convention ─────────────────────────────────
//
// The registry treats (workflow, slug) opaquely — the only requirement is that
// the pair is unique per in-flight job. Two patterns are in use:
//
//   • Single-instance (one job of this type per trip):
//       startJob('brochure', slug)         → key 'brochure:<slug>'
//       startJob('deepen', slug)           → key 'deepen:<slug>'
//
//   • Multi-instance (multiple concurrent jobs of this type per trip):
//       Encode the discriminator in the WORKFLOW arg as
//       '<workflow>:<discriminator>'. Leave the slug arg clean.
//         startJob('deepen-section:stops', slug)    → key 'deepen-section:stops:<slug>'
//         startJob('deepen-section:route', slug)    → key 'deepen-section:route:<slug>'
//
// Why discriminator-in-workflow (not in-slug):
//   • TripJobBadge's filter (filterJobsForSlug in src/lib/utils/jobLabels.js)
//     does an exact `j.slug === slug` match. Keeping the slug clean means the
//     per-trip badge surfaces every concurrent job for a trip without special
//     prefix-handling.
//   • The frontmatter `running:` flag carries the full workflow string
//     ('deepen-section:stops'), which is informative for the restart sweep
//     and any out-of-band debugging.
//
// Label rendering: `jobLabel()` and `BackgroundJobsIndicator`'s WORKFLOW_LABELS
// strip a `:<discriminator>` suffix before lookup, so 'deepen-section:stops'
// resolves to the same label as 'deepen-section'. New multi-instance workflows
// must register their bare-workflow label there.

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  ROOT,
  atomicWrite,
  parseFrontmatter,
  setFrontmatterField,
  removeFrontmatterField,
  findTripFile,
  invalidateEnrichCache,
} from './data.js';
import { TraverseError } from './errors.js';

// ─── In-memory registry ──────────────────────────────────────────────────────

/** @type {Map<string, { workflow: string, slug: string, startedAt: number, controller: AbortController, opts: object }>} */
const jobs = new Map();

/**
 * Ring buffer of recently-finished job outcomes, used by the indicator UI to
 * surface success/failure toasts after a job disappears from `listJobs()`.
 * Entries auto-prune by TTL on every read so we never leak memory and the
 * client can poll without seeing stale events forever.
 *
 * Shape: { workflow, slug, outcome: 'success' | 'failure', code?, tokens?, at }
 */
/** @type {Array<{ workflow: string, slug: string, outcome: 'success' | 'failure', code?: string, tokens?: number, at: number }>} */
const recentEvents = [];

/** Recent-event retention window. 60s is enough for a 10s poll to catch any
 *  outcome twice over without indefinite growth. */
const RECENT_EVENT_TTL_MS = 60 * 1000;

/**
 * Build the in-memory registry key for a (workflow, slug) pair.
 *
 * Both args are treated as opaque strings — the key is purely `${workflow}:${slug}`.
 * For multi-instance workflows (e.g. deepen-section's per-section jobs), the
 * discriminator is encoded in the workflow arg as '<workflow>:<discriminator>',
 * which produces keys like 'deepen-section:stops:<slug>'. See the file header
 * for the full convention.
 */
function keyFor(workflow, slug) {
  return `${workflow}:${slug}`;
}

function pushEvent(event) {
  recentEvents.push({ ...event, at: Date.now() });
  pruneRecentEvents();
}

function pruneRecentEvents() {
  const cutoff = Date.now() - RECENT_EVENT_TTL_MS;
  while (recentEvents.length > 0 && recentEvents[0].at < cutoff) {
    recentEvents.shift();
  }
}

// ─── Frontmatter helpers ─────────────────────────────────────────────────────

// Return the on-disk path to the trip's source-of-truth markdown file.
// Returns null when the trip isn't found in any stage (the caller will skip
// frontmatter mutation but keep its in-memory entry).
function tripFilePath(slug) {
  return findTripFile(slug);
}

function readTripFile(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

function writeRunningFlag(slug, workflow) {
  const path = tripFilePath(slug);
  if (!path) return;
  const content = readTripFile(path);
  if (content === null) return;
  if (!parseFrontmatter(content)) return;
  atomicWrite(path, setFrontmatterField(content, 'running', workflow));
  invalidateEnrichCache();
}

function clearRunningFlag(slug, extraFields = {}, removeFields = []) {
  const path = tripFilePath(slug);
  if (!path) return;
  let content = readTripFile(path);
  if (content === null) return;
  if (!parseFrontmatter(content)) return;

  content = removeFrontmatterField(content, 'running');
  for (const field of removeFields) {
    content = removeFrontmatterField(content, field);
  }
  for (const [field, value] of Object.entries(extraFields)) {
    content = setFrontmatterField(content, field, value);
  }
  atomicWrite(path, content);
  invalidateEnrichCache();
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Register a new job. Adds an entry to the in-memory map and writes the
 * `running: '<workflow>'` flag to the trip's frontmatter as a recovery hint.
 *
 * Returns a handle: { workflow, slug, startedAt, controller, opts }.
 * Callers wire `controller.signal` into the `chat()` call so cancellation
 * propagates.
 *
 * Multi-instance workflows: pass the discriminator in the `workflow` arg as
 * '<workflow>:<discriminator>' (e.g. 'deepen-section:stops'); keep `slug`
 * clean. See the file header for the full convention. `cancelJob` /
 * `assertNotRunning` / `/api/jobs/cancel` all accept the same composite
 * workflow string.
 */
export function startJob(workflow, slug, opts = {}) {
  const key = keyFor(workflow, slug);
  const controller = new AbortController();
  const entry = {
    workflow,
    slug,
    startedAt: Date.now(),
    controller,
    opts,
  };
  jobs.set(key, entry);
  writeRunningFlag(slug, workflow);
  return entry;
}

/**
 * Mark a job complete. Removes the in-memory entry and clears the running
 * flag. Optionally records `last_run_success` + token count for indicator UI.
 */
export function completeJob(workflow, slug, result = {}) {
  const key = keyFor(workflow, slug);
  if (!jobs.has(key)) {
    // Idempotent — caller might invoke completeJob from a finally{} after
    // cancelJob already cleaned up.
    return;
  }
  jobs.delete(key);

  const extras = { last_run_success_at: new Date().toISOString() };
  // Accept { tokens } directly (spec-preferred), or extract from usage in either
  // the raw Anthropic shape { input_tokens, output_tokens } or the normalized
  // adapter shape { input, output }.
  let tokens = 0;
  if (typeof result?.tokens === 'number') {
    tokens = result.tokens;
  } else if (result?.usage) {
    tokens = (result.usage.input_tokens ?? result.usage.input ?? 0)
           + (result.usage.output_tokens ?? result.usage.output ?? 0);
  }
  if (tokens > 0) extras.last_run_tokens = String(tokens);
  // A successful run supersedes any earlier failure; clear the stale error
  // fields so the planning page banner reflects current state, not history.
  clearRunningFlag(slug, extras, ['last_run_error', 'last_run_error_at', 'last_run_message']);

  pushEvent({
    workflow,
    slug,
    outcome: 'success',
    ...(tokens > 0 ? { tokens } : {}),
  });
}

/**
 * Mark a job failed. Removes the in-memory entry, clears the running flag,
 * and records `last_run_error` + `last_run_error_at` for indicator UI.
 *
 * `error` may be a TraverseError, a plain Error, or `{ code, message }`.
 */
export function failJob(workflow, slug, error = {}) {
  const key = keyFor(workflow, slug);
  if (!jobs.has(key)) return;
  jobs.delete(key);

  const code = error?.code || 'unknown';
  const extras = {
    last_run_error: code,
    last_run_error_at: new Date().toISOString(),
  };
  const message = sanitizeFrontmatterMessage(error?.message);
  if (message) extras.last_run_message = message;
  clearRunningFlag(slug, extras);

  pushEvent({
    workflow,
    slug,
    outcome: 'failure',
    code,
    ...(message ? { message } : {}),
  });
}

// Frontmatter is single-line `key: value` YAML — collapse newlines, avoid the
// `[...]` array form, and cap length so an unbounded provider error message
// can't blow out the file.
function sanitizeFrontmatterMessage(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let s = raw.replace(/[\r\n]+/g, ' ').trim();
  if (!s) return null;
  // Quote the value so it stays a string on re-parse — leading-space trick
  // gets stripped by parseFrontmatterFields' .trim() and doesn't defend.
  if (s.startsWith('[')) s = `"${s.replace(/"/g, '\\"')}"`;

  return s.length > 300 ? s.slice(0, 300) + '…' : s;
}

/**
 * Cancel an in-flight job. Triggers the AbortController (which propagates
 * into `chat()` via the `signal` parameter) and then performs the same
 * cleanup as `failJob` with code `cancelled`.
 *
 * The action route's own `.catch()` will still run after the abort fires;
 * it should also call `failJob` defensively — which is a no-op once the
 * entry is gone.
 */
export function cancelJob(workflow, slug) {
  const key = keyFor(workflow, slug);
  const entry = jobs.get(key);
  if (!entry) return;
  try {
    entry.controller.abort();
  } catch {
    /* ignore */
  }
  failJob(workflow, slug, { code: 'cancelled' });
}

/**
 * Snapshot of currently-running jobs for the indicator UI. Returns plain
 * JSON-serializable objects — the AbortController is stripped.
 */
export function listJobs() {
  const out = [];
  for (const entry of jobs.values()) {
    out.push({
      workflow: entry.workflow,
      slug: entry.slug,
      startedAt: entry.startedAt,
    });
  }
  return out;
}

/**
 * Snapshot of recently-completed job outcomes. Events older than
 * `RECENT_EVENT_TTL_MS` are pruned on every call. The indicator UI uses this
 * to convert "job disappeared from snapshot" into a typed success/failure
 * toast even when the poll interval misses the live transition.
 */
export function listRecentEvents() {
  pruneRecentEvents();
  return recentEvents.map((e) => ({ ...e }));
}

/**
 * Throws a TraverseError with code `already_running` if a job for this
 * (workflow, slug) is already in flight. Action routes call this before
 * `startJob()` and translate the throw to a 409 Conflict response.
 *
 * The conceptual key is `<workflow>:<slug>`; for multi-instance workflows the
 * caller folds the discriminator into `workflow` (e.g. 'deepen-section:stops'),
 * so collision detection naturally respects per-discriminator uniqueness
 * without any extra plumbing here. See the file header for the convention.
 */
export function assertNotRunning(workflow, slug) {
  // `key` is the conceptual `<workflow>:<slug>[:<discriminator>]`. For
  // single-instance workflows `workflow` is a bare token ('brochure'); for
  // multi-instance ones the discriminator is embedded in `workflow`
  // ('deepen-section:stops'), so this lookup distinguishes concurrent
  // sections of the same trip.
  const key = keyFor(workflow, slug);
  if (jobs.has(key)) {
    throw new TraverseError('already_running', `${workflow} already running for ${slug}`);
  }
}

// ─── Restart sweep ───────────────────────────────────────────────────────────

/**
 * Scan all trip files for `running:` flags older than `maxAgeMinutes`. For
 * each match, clear the flag and record `last_run_aborted: true` with a
 * timestamp. Used at server startup to recover from crashes mid-job.
 *
 * Returns the count of flags cleared.
 *
 * Threshold uses file mtime as a proxy for "how long has this job been
 * orphaned". A job that's truly still running on a fresh process boot is
 * impossible — the in-memory map is the only place the AbortController lives —
 * so any `running:` flag on disk after startup is orphaned. The age threshold
 * exists only to guard against accidentally clobbering an in-progress write
 * (e.g. another process touching the file). Default: 10 minutes.
 */
export function sweepStaleJobs({ maxAgeMinutes = 10 } = {}) {
  const threshold = Date.now() - maxAgeMinutes * 60 * 1000;
  let cleared = 0;

  for (const stage of ['ideas', 'planning', 'completed']) {
    const dir = join(ROOT, stage);
    if (!existsSync(dir)) continue;

    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      let filePath;
      if (entry.isFile() && entry.name.endsWith('.md')) {
        filePath = join(dir, entry.name);
      } else if (entry.isDirectory()) {
        const ov = join(dir, entry.name, 'overview.md');
        if (existsSync(ov)) filePath = ov;
      }
      if (!filePath) continue;

      let content;
      try {
        content = readFileSync(filePath, 'utf8');
      } catch {
        continue;
      }
      const fm = parseFrontmatter(content);
      if (!fm) continue;
      if (!fm.running) continue;

      let mtimeMs;
      try {
        mtimeMs = statSync(filePath).mtimeMs;
      } catch {
        mtimeMs = 0;
      }
      if (mtimeMs > threshold) continue;

      let updated = removeFrontmatterField(content, 'running');
      updated = setFrontmatterField(updated, 'last_run_aborted', 'true');
      updated = setFrontmatterField(updated, 'last_run_aborted_at', new Date().toISOString());
      try {
        atomicWrite(filePath, updated);
        cleared++;
      } catch (e) {
        console.warn(`[jobs] sweep: failed to clear flag on ${filePath}:`, e.message);
      }
    }
  }

  if (cleared > 0) {
    invalidateEnrichCache();
    console.log(`[jobs] sweep: cleared ${cleared} stale running flag(s).`);
  }
  return cleared;
}

// ─── Test seam ───────────────────────────────────────────────────────────────

/** Resets the in-memory map. Tests only. */
export function _resetForTests() {
  jobs.clear();
  recentEvents.length = 0;
}

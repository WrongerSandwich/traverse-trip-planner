// Server-side job registry for Ambient Background workflows.
//
// See docs/ai-workflow-ux.md §6 (background-status surface) and §8 (edge cases).
// See docs/jobs-source-of-truth.md for the registry-on-disk design (#355/#375).
//
// Two coordinated sources of truth:
//   1. An in-memory Map keyed by `${workflow}:${slug}` — authoritative for live
//      state. The indicator UI reads `listJobs()` and the per-job AbortController
//      lives here.
//   2. A central `.cache/.jobs.json` file — the volatile registry of in-flight
//      jobs. Survives server restart so the boot sweep can recover orphaned
//      entries. Written on every startJob/completeJob/failJob/cancelJob. Not a
//      cache: cleared by the writers, not by GC.
//
// The in-memory map is authoritative for normal live reads; the disk file is
// only consulted during the restart sweep (see sweepStaleJobs / hooks.server.js).
// This avoids re-parsing the file on every 10s indicator poll.
//
// Trip frontmatter still carries historical fields (`last_run_error*`,
// `last_run_success_at`, `last_run_tokens`) that drive the trip-detail
// "last background job failed" banner — those are written by completeJob/failJob.
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

import { readFileSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import {
  DATA_DIR,
  atomicWrite,
  parseFrontmatter,
  setFrontmatterField,
  removeFrontmatterField,
  findTripFile,
  invalidateEnrichCache,
} from './data.js';
import { TraverseError } from './errors.js';

// Volatile in-flight job registry (not a cache — see docs/jobs-source-of-truth.md).
// Lives under data/.cache/ for the same Docker bind-mount reason as the caches,
// but the writers (startJob/completeJob/failJob/cancelJob) are the only
// managers; no GC, no read in the hot path.
const JOBS_REGISTRY_PATH = join(DATA_DIR, '.cache', '.jobs.json');

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

// Writes the per-trip historical fields that drive the trip-detail
// "last background job failed" banner (see data flow in
// docs/jobs-source-of-truth.md). The in-flight `running:` flag is no longer
// written here — that's tracked in the central .cache/.jobs.json file instead.
function writeHistoricalFields(slug, extraFields = {}, removeFields = []) {
  const path = tripFilePath(slug);
  if (!path) return;
  let content = readTripFile(path);
  if (content === null) return;
  if (!parseFrontmatter(content)) return;

  for (const field of removeFields) {
    content = removeFrontmatterField(content, field);
  }
  for (const [field, value] of Object.entries(extraFields)) {
    content = setFrontmatterField(content, field, value);
  }
  atomicWrite(path, content);
  invalidateEnrichCache();
}

// ─── On-disk registry helpers ────────────────────────────────────────────────
//
// The registry is a JSON array of { workflow, slug, startedAt, est_seconds? }.
// Mirrors the in-memory map exactly. Written via atomicWrite() on every job
// transition so a crash never leaves a torn file.

function snapshotForDisk() {
  const out = [];
  for (const entry of jobs.values()) {
    const row = {
      workflow: entry.workflow,
      slug: entry.slug,
      startedAt: entry.startedAt,
    };
    if (typeof entry.opts?.est_seconds === 'number') {
      row.est_seconds = entry.opts.est_seconds;
    }
    out.push(row);
  }
  return out;
}

// Persist the in-memory registry to `.cache/.jobs.json`.
//
// A failed write here is NOT swallowed (#492). Swallowing it desyncs the
// in-memory map from disk and — worse — leaves the boot sweep with a stale or
// missing file, so an interrupted trip never gets marked
// `last_run_error: 'interrupted'` after a restart. A persistent failure here
// (read-only `.cache/`, full disk) also breaks the geo/image/route caches and
// workflow-stats, so it's a real fault the operator needs to see.
//
// We escalate the log to error level, emit a one-shot in-app warning event for
// the indicator UI, then re-throw so the writer's caller can react. The
// in-memory map mutation has already happened by the time this runs, so live
// reads (listJobs / the 10s poll) stay consistent — only the persistence step
// is signalled as failed.
function persistRegistry() {
  try {
    atomicWrite(JOBS_REGISTRY_PATH, JSON.stringify(snapshotForDisk(), null, 2));
  } catch (e) {
    console.error(`[jobs] failed to persist registry to ${JOBS_REGISTRY_PATH}:`, e?.message ?? e);
    // One-shot in-app warning: the indicator polls listRecentEvents() and can
    // surface this as a failure toast. Code is registry-specific so the UI can
    // distinguish it from a workflow failure.
    pushEvent({
      workflow: 'jobs-registry',
      slug: '',
      outcome: 'failure',
      code: 'registry_persist_failed',
    });
    throw e;
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Register a new job. Adds an entry to the in-memory map and appends it to
 * the on-disk registry (`.cache/.jobs.json`) so the boot sweep can recover
 * orphaned entries after a crash. Frontmatter is no longer touched here —
 * see docs/jobs-source-of-truth.md.
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
  persistRegistry();
  return entry;
}

/**
 * Mark a job complete. Removes the in-memory entry and the on-disk registry
 * line, then records `last_run_success_at` + token count on the trip's
 * frontmatter for the trip-detail banner.
 */
export function completeJob(workflow, slug, result = {}) {
  const key = keyFor(workflow, slug);
  if (!jobs.has(key)) {
    // Idempotent — caller might invoke completeJob from a finally{} after
    // cancelJob already cleaned up.
    return;
  }
  jobs.delete(key);
  persistRegistry();

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
  // A job can complete successfully but with swallowed partial failures (e.g.
  // geocode-candidates pins most stops but a handful miss / can't be addressed
  // due to a Nominatim hiccup — #488). Record the count on the frontmatter so
  // the detail banner can note it; clear it on a clean run.
  const partialFailures =
    typeof result?.partial_failures === 'number' && result.partial_failures > 0
      ? result.partial_failures
      : 0;
  if (partialFailures > 0) extras.last_run_partial_failures = String(partialFailures);
  // A successful run supersedes any earlier failure; clear the stale error
  // fields (and any prior partial-failure count on a now-clean run) so the
  // planning page banner reflects current state, not history.
  const clearFields = ['last_run_error', 'last_run_error_at', 'last_run_message'];
  if (partialFailures === 0) clearFields.push('last_run_partial_failures');
  writeHistoricalFields(slug, extras, clearFields);

  pushEvent({
    workflow,
    slug,
    outcome: 'success',
    ...(tokens > 0 ? { tokens } : {}),
    ...(partialFailures > 0 ? { partial_failures: partialFailures } : {}),
  });
}

/**
 * Mark a job failed. Removes the in-memory entry and the on-disk registry
 * line, then records `last_run_error` + `last_run_error_at` (+ optional
 * `last_run_message`) on the trip's frontmatter for the trip-detail banner.
 *
 * `error` may be a TraverseError, a plain Error, or `{ code, message }`.
 */
export function failJob(workflow, slug, error = {}) {
  const key = keyFor(workflow, slug);
  if (!jobs.has(key)) return;
  jobs.delete(key);
  persistRegistry();

  const code = error?.code || 'unknown';
  const extras = {
    last_run_error: code,
    last_run_error_at: new Date().toISOString(),
  };
  const message = sanitizeFrontmatterMessage(error?.message);
  if (message) extras.last_run_message = message;
  writeHistoricalFields(slug, extras);

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
 *
 * The abort (the user-facing cancel) has already taken effect before the
 * `failJob` cleanup runs, and `/api/jobs/cancel` is contractually idempotent
 * (always 200). A registry-persist failure inside `failJob` is therefore
 * tolerated here — it has already been escalated to error level and pushed as
 * a one-shot warning event by persistRegistry() (#492), so it is surfaced, not
 * silent — but it must not turn a successful cancel into a 500.
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
  try {
    failJob(workflow, slug, { code: 'cancelled' });
  } catch (e) {
    // persistRegistry() already logged + emitted a one-shot warning; swallow
    // here only so the idempotent cancel response stays 200.
    console.error(`[jobs] cancelJob: cleanup failed for ${workflow}:${slug}:`, e?.message ?? e);
  }
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
//
// On boot, recover orphaned in-flight state from the previous process. Two
// paths run in sequence:
//
//   1. Registry sweep — read `.cache/.jobs.json` (the post-#375 source of
//      truth for in-flight jobs), mark each listed trip's frontmatter with
//      the `interrupted` triple, then delete the file.
//
//   2. Legacy frontmatter scan — walk `ideas/`, `planning/`, `completed/`
//      for trips with a `running:` flag left over from pre-#375 installs.
//      Same recovery action: clear the flag, write the `interrupted` triple.
//      After one boot post-deploy on a given install, no `running:` flags
//      remain anywhere; the scan stays as a one-release-cycle safety net.
//      Remove after 2026-Q4 if no `running:` flags appear in production
//      sweeps. See docs/jobs-source-of-truth.md.
//
// No age threshold (the pre-#377 `maxAgeMinutes` is gone): a single-instance
// Node server can't race itself, and the sweep runs via setImmediate before
// any request is served, so every entry we see is by definition orphaned.

const INTERRUPTED_MESSAGE = 'Server restarted mid-job.';

function interruptedTriple() {
  return {
    last_run_error: 'interrupted',
    last_run_error_at: new Date().toISOString(),
    last_run_message: INTERRUPTED_MESSAGE,
  };
}

/**
 * Boot-time recovery sweep. Returns `{ fromRegistry, fromLegacy }` so the
 * boot log can split the two sources for observability.
 */
export function sweepStaleJobs() {
  const fromRegistry = sweepRegistry();
  const fromLegacy = sweepLegacyFrontmatter();

  if (fromRegistry > 0 || fromLegacy > 0) {
    invalidateEnrichCache();
    console.log(
      `[jobs] sweep: recovered ${fromRegistry} from registry, ${fromLegacy} from legacy frontmatter.`,
    );
  }

  return { fromRegistry, fromLegacy };
}

function sweepRegistry() {
  if (!existsSync(JOBS_REGISTRY_PATH)) return 0;

  let entries;
  try {
    const raw = readFileSync(JOBS_REGISTRY_PATH, 'utf8');
    entries = JSON.parse(raw);
    if (!Array.isArray(entries)) entries = [];
  } catch (e) {
    console.warn(`[jobs] sweep: failed to read ${JOBS_REGISTRY_PATH}:`, e.message);
    entries = [];
  }

  let marked = 0;
  for (const entry of entries) {
    if (!entry || typeof entry.slug !== 'string') continue;
    if (markInterrupted(entry.slug)) marked++;
  }

  try {
    unlinkSync(JOBS_REGISTRY_PATH);
  } catch (e) {
    if (e?.code !== 'ENOENT') {
      console.warn(`[jobs] sweep: failed to delete ${JOBS_REGISTRY_PATH}:`, e.message);
    }
  }

  return marked;
}

function sweepLegacyFrontmatter() {
  let cleared = 0;

  for (const stage of ['ideas', 'planning', 'completed']) {
    const dir = join(DATA_DIR, stage);
    if (!existsSync(dir)) continue;

    let dirEntries;
    try {
      dirEntries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of dirEntries) {
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

      let updated = removeFrontmatterField(content, 'running');
      const triple = interruptedTriple();
      for (const [field, value] of Object.entries(triple)) {
        updated = setFrontmatterField(updated, field, value);
      }
      try {
        atomicWrite(filePath, updated);
        cleared++;
      } catch (e) {
        console.warn(`[jobs] sweep: failed to clear legacy running flag on ${filePath}:`, e.message);
      }
    }
  }

  return cleared;
}

/**
 * Write the `interrupted` triple to the trip's frontmatter. Returns true when
 * the write happened, false when the trip file couldn't be found (we silently
 * skip those — the registry can outlive the trip if a slug was renamed or
 * deleted between the previous boot and this one).
 */
function markInterrupted(slug) {
  const path = findTripFile(slug);
  if (!path) return false;
  let content;
  try {
    content = readFileSync(path, 'utf8');
  } catch {
    return false;
  }
  if (!parseFrontmatter(content)) return false;

  let updated = content;
  const triple = interruptedTriple();
  for (const [field, value] of Object.entries(triple)) {
    updated = setFrontmatterField(updated, field, value);
  }
  try {
    atomicWrite(path, updated);
    return true;
  } catch (e) {
    console.warn(`[jobs] sweep: failed to write interrupted triple to ${path}:`, e.message);
    return false;
  }
}

// ─── Test seam ───────────────────────────────────────────────────────────────

/** Resets the in-memory map. Tests only. The on-disk registry is left to the
 *  test harness (cleanup belongs with whatever mocked the filesystem). */
export function _resetForTests() {
  jobs.clear();
  recentEvents.length = 0;
}

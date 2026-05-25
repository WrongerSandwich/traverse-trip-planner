/**
 * Tests for the enrichTrips partial-enrichment prune guard.
 *
 * Verifies:
 *   1. No "skipping cache prune" warn is emitted when all trips enrich cleanly.
 *   2. The "skipping cache prune" warn IS emitted when one trip's enrichment
 *      throws an unexpected error (completedEnumeration = false).
 *
 * The per-trip throw is injected by seeding a trip with waypoints that are
 * parsed as an array by parseFrontmatter, then making geocode() throw a
 * non-TraverseError error that geocodeWaypoints will re-throw.
 *
 * geocodeWaypoints re-throws any error that is NOT a TraverseError with
 * code 'geocode_quota'. geocode() itself catches all errors and normally
 * returns null — but on attempt=0 it re-raises via `continue` (sleep + retry).
 * On attempt=1 it returns null. So network errors don't propagate.
 *
 * To get a non-null throw past geocode, we make global.fetch throw a
 * TraverseError (imported from errors.js) with code 'some_other_code' — but
 * geocode still catches it on both attempts.
 *
 * PRAGMATIC SOLUTION: We trigger the per-trip outer catch by making the
 * per-trip block's `await sleep(1100)` call (which runs after geocode) throw.
 * sleep() is `new Promise(r => setTimeout(r, ms))`. If we override
 * global.setTimeout to invoke a callback that throws synchronously, the
 * Promise executor calls setTimeout(r, 1100), the mock throws synchronously
 * INSIDE the executor before `r` is ever called, which means the executor
 * throws but the Promise constructor wraps that into a rejected Promise, and
 * `await sleep(1100)` → rejected → caught by the per-trip try/catch.
 *
 * Wait: `new Promise(r => setTimeout(r, 1100))` — if setTimeout throws
 * synchronously, the Promise executor also throws, and `new Promise()` catches
 * it and rejects. Then `await sleep(1100)` becomes `await rejectedPromise`,
 * which throws in the per-trip try block → caught by outer catch →
 * completedEnumeration = false → prune-skip warn emitted!
 *
 * To only affect the 1100ms-delay sleep (not the 500ms geocode retry sleep),
 * we count setTimeout calls and throw on the ones with delay=1100.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── fs mock ─────────────────────────────────────────────────────────────────

const fsState = {
  files: /** @type {Record<string, string>} */ ({}),
  dirs: /** @type {Set<string>} */ (new Set()),
};

function ensureDir(p) {
  let cur = p;
  while (cur && cur !== '/' && cur !== '.') {
    fsState.dirs.add(cur);
    const slash = cur.lastIndexOf('/');
    if (slash <= 0) break;
    cur = cur.slice(0, slash);
  }
}

function seedFile(p, content) {
  fsState.files[p] = content;
  const slash = p.lastIndexOf('/');
  if (slash > 0) ensureDir(p.slice(0, slash));
}

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    existsSync: (p) => (p in fsState.files) || fsState.dirs.has(p),
    readFileSync: (p) => {
      if (!(p in fsState.files)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return fsState.files[p];
    },
    writeFileSync: (p, content) => { fsState.files[p] = content; },
    renameSync: (src, dst) => {
      if (!(src in fsState.files)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      fsState.files[dst] = fsState.files[src];
      delete fsState.files[src];
    },
    readdirSync: (dir, opts) => {
      if (!fsState.dirs.has(dir)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      const prefix = dir.endsWith('/') ? dir : `${dir}/`;
      const names = new Set();
      for (const p of Object.keys(fsState.files)) {
        if (p.startsWith(prefix)) names.add(p.slice(prefix.length).split('/')[0]);
      }
      for (const d of fsState.dirs) {
        if (!d.startsWith(prefix)) continue;
        const rest = d.slice(prefix.length);
        if (rest && !rest.includes('/')) names.add(rest);
      }
      const arr = [...names];
      if (opts?.withFileTypes) {
        return arr.map((name) => {
          const full = `${prefix}${name}`;
          const isDir = fsState.dirs.has(full);
          return { name, isFile: () => !isDir, isDirectory: () => isDir };
        });
      }
      return arr;
    },
    statSync: (p) => {
      if (p in fsState.files) return { isFile: () => true, isDirectory: () => false, mtimeMs: Date.now() };
      if (fsState.dirs.has(p)) return { isFile: () => false, isDirectory: () => true, mtimeMs: Date.now() };
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    },
    mkdirSync: (p) => { ensureDir(p); },
  };
});

vi.mock('../src/lib/server/settings.js', () => ({
  resolveEnv: () => null,
}));

const ROOT = '/prune-test-root';
// User-managed runtime state (trip dirs, .cache/) lives under data/ post-#411.
const DATA = `${ROOT}/data`;
const ORIGINAL_CWD = process.cwd;

process.cwd = () => ROOT;

const { enrichTrips, invalidateEnrichCache } = await import('../src/lib/server/data.js');

function seedIdea(slug, extraFm = {}) {
  const fmLines = Object.entries({
    title: slug,
    status: 'idea',
    destination: 'Nowhere Special',
    ...extraFm,
  })
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
  seedFile(`${DATA}/ideas/${slug}.md`, `---\n${fmLines}\n---\n\nBody.\n`);
}

beforeEach(() => {
  fsState.files = {};
  fsState.dirs = new Set();
  ensureDir(ROOT);
  ensureDir(`${DATA}/ideas`);
  ensureDir(`${DATA}/planning`);
  ensureDir(`${DATA}/completed`);
  process.cwd = () => ROOT;
  invalidateEnrichCache();
});

afterEach(() => {
  process.cwd = ORIGINAL_CWD;
  vi.restoreAllMocks();
});

describe('enrichTrips prune guard', () => {
  it('does NOT emit a prune-skip warning when all trips enrich successfully', async () => {
    seedIdea('trip-clean', { destination: 'Wichita KS' });

    const originalFetch = global.fetch;
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, status: 200, json: async () => [] }),
    );
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      await enrichTrips();
    } finally {
      global.fetch = originalFetch;
    }

    const pruneWarn = warnSpy.mock.calls.find(
      (args) => typeof args[0] === 'string' && args[0].includes('skipping cache prune'),
    );
    expect(pruneWarn).toBeUndefined();
  });

  it('emits "skipping cache prune" warn when a trip throws during enrichment', async () => {
    // Seed a trip. We trigger the per-trip outer catch by making the
    // `await sleep(1100)` call (after a geocode fetch) reject. sleep() is:
    //   function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
    //
    // If the Promise executor throws (because our setTimeout throws synchronously),
    // `new Promise()` catches it and returns a rejected promise. Then
    // `await sleep(1100)` throws in the per-trip try block → per-trip catch fires
    // → completedEnumeration = false → prune-skip warn emitted.
    //
    // We only make setTimeout throw for delay=1100 (the post-geocode sleep) so
    // that the 500ms geocode-retry sleep still works normally.
    // Use a unique destination not cached by previous tests
    seedIdea('trip-a', { destination: 'Topeka KS unique-prune-test' });

    const originalFetch = global.fetch;
    // Return a valid geocode response so fetch doesn't fail → geocode runs to
    // completion → then `await sleep(1100)` is called.
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, status: 200, json: async () => [] }),
    );

    const originalSetTimeout = global.setTimeout;
    let setTimeoutCallCount = 0;
    global.setTimeout = vi.fn((cb, delay, ...args) => {
      setTimeoutCallCount++;
      // Throw synchronously for the 1100ms sleep (post-geocode sleep in enrichTrips).
      // The Promise executor catches this and rejects the promise.
      if (delay === 1100) {
        throw new Error('injected sleep failure for testing');
      }
      return originalSetTimeout(cb, delay, ...args);
    });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      await enrichTrips();
    } finally {
      global.fetch = originalFetch;
      global.setTimeout = originalSetTimeout;
    }

    // The per-trip catch should have fired, setting completedEnumeration=false
    const tripErrorWarn = warnSpy.mock.calls.find(
      (args) => typeof args[0] === 'string' && args[0].includes('enrichTrips: error enriching trip'),
    );
    expect(tripErrorWarn).toBeDefined();

    // pruneCaches should have been skipped
    const pruneWarn = warnSpy.mock.calls.find(
      (args) => typeof args[0] === 'string' && args[0].includes('skipping cache prune'),
    );
    expect(pruneWarn).toBeDefined();
  });
});

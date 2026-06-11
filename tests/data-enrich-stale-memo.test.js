/**
 * #490 — enrichTrips() must not serve a stale snapshot when a mutation lands
 * mid-run.
 *
 * If a trip is created (invalidateEnrichCache()) WHILE an enrichment run is
 * already in flight, the in-flight run captured the trip list at its start.
 * Skipping the memo (the prior #273 guard) keeps the NEXT caller honest — but
 * any caller COALESCED onto the in-flight promise still receives the stale
 * pre-mutation result, so a freshly-seeded trip is missing from the home page
 * for up to the 30s TTL.
 *
 * This test drives the race deterministically: it gates the in-flight run on a
 * controllable deferred (a stalled fetch), seeds a second trip + calls
 * invalidateEnrichCache() during that window, then releases the run and awaits
 * the SAME enrichTrips() promise. The fix re-runs the enumeration, so the
 * awaited result includes the trip that landed mid-run.
 *
 * Regression direction: against the memo-skip-only code, the result is the
 * 1-trip pre-mutation snapshot and the assertion fails.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

vi.mock('../src/lib/server/settings.js', () => ({ resolveEnv: () => null }));

const ROOT = '/stale-memo-root';
const DATA = `${ROOT}/data`;
const ORIGINAL_CWD = process.cwd;
process.cwd = () => ROOT;

const { enrichTrips, invalidateEnrichCache } = await import('../src/lib/server/data.js');

function seedIdea(slug, dest) {
  seedFile(
    `${DATA}/ideas/${slug}.md`,
    `---\ntitle: ${slug}\nstatus: idea\ndestination: ${dest}\n---\nbody\n`,
  );
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
  vi.unstubAllGlobals();
});

describe('enrichTrips stale-memo race (#490)', () => {
  it('re-runs enumeration when a trip is added mid-run, instead of serving the stale snapshot', async () => {
    // One trip to start; its destination geocode stalls so we can wedge a
    // mutation into the enrichment window.
    seedIdea('trip-one', 'Alpha City stale-memo-test');

    const realSetTimeout = globalThis.setTimeout;
    vi.stubGlobal('setTimeout', (cb) => realSetTimeout(cb, 0));

    // First fetch (the in-flight run geocoding Alpha City) stalls on a
    // controllable deferred; subsequent fetches resolve immediately.
    let releaseFirstFetch;
    const firstFetchGate = new Promise((r) => { releaseFirstFetch = r; });
    let fetchCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      fetchCalls++;
      if (fetchCalls === 1) await firstFetchGate;
      return {
        ok: true,
        status: 200,
        json: async () => [{ class: 'place', addresstype: 'city', lat: '40.0', lon: '-90.0' }],
      };
    }));

    // Start the run but DON'T await yet — it's now wedged on the first fetch.
    const inFlight = enrichTrips();
    // Let the run reach the stalled fetch.
    await new Promise((r) => realSetTimeout(r, 10));

    // Mid-run mutation: a second trip is seeded and the cache invalidated,
    // exactly as the seed/add endpoints do.
    seedIdea('trip-two', 'Beta City stale-memo-test');
    invalidateEnrichCache();

    // Release the stalled fetch so the in-flight run completes.
    releaseFirstFetch();

    const result = await inFlight;
    const slugs = result.map((t) => t._slug).sort();

    // The coalesced caller must see BOTH trips — the fix re-enumerates after
    // detecting the mid-run invalidation rather than returning the 1-trip
    // pre-mutation snapshot.
    expect(slugs).toEqual(['trip-one', 'trip-two']);
  });

  it('returns the memoized snapshot on a quiet second call (no needless re-walk)', async () => {
    seedIdea('only-trip', 'Gamma City stale-memo-test');
    const realSetTimeout = globalThis.setTimeout;
    vi.stubGlobal('setTimeout', (cb) => realSetTimeout(cb, 0));
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => [{ class: 'place', addresstype: 'city', lat: '40.0', lon: '-90.0' }],
    })));

    const first = await enrichTrips();
    const second = await enrichTrips();
    // Same memoized array instance — the second call served the memo.
    expect(second).toBe(first);
  });
});

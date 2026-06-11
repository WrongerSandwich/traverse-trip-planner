/**
 * #489 — Cache GC snapshot race.
 *
 * enrichTripsImpl() collects live cache keys at the START of enrichment, but
 * the GC prune runs at the END. A cache entry whose SOURCE appears on disk
 * only in that window (e.g. a candidate added to an existing trip while
 * enrichment is in flight) is absent from the early snapshot and gets wrongly
 * pruned — wasting Nominatim/Pexels quota and flickering the pin on next load.
 *
 * This test simulates the window by making the candidates file return an
 * EXTRA stop name on the second collectLiveCacheKeys() walk (the GC-time
 * re-walk) that wasn't present on the first (start-of-run snapshot). The fix
 * re-walks at GC time and unions the fresh keys, so the entry survives.
 *
 * Regression direction: against the start-of-run-snapshot-only code, the
 * mid-window geocode entry is pruned out of the persisted cache and the
 * assertion fails.
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

// Count reads of the candidates file so we can flip its contents between the
// start-of-run snapshot walk and the GC-time re-walk.
const CANDIDATES_PATH_RE = /\/candidates\.yaml$/;
let candidatesReadCount = 0;

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    existsSync: (p) => (p in fsState.files) || fsState.dirs.has(p),
    readFileSync: (p) => {
      if (CANDIDATES_PATH_RE.test(p)) {
        candidatesReadCount++;
        // First walk (snapshot): only "Existing Stop". Second walk (GC): adds
        // "Mid Run Stop" — the candidate that landed mid-enrichment.
        const stops =
          candidatesReadCount >= 2
            ? '  - id: a\n    name: Existing Stop\n  - id: b\n    name: Mid Run Stop\n'
            : '  - id: a\n    name: Existing Stop\n';
        return `---\nstops:\n${stops}lodging: []\n---\n`;
      }
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
      if (CANDIDATES_PATH_RE.test(p)) return { isFile: () => true, isDirectory: () => false, mtimeMs: Date.now() };
      if (p in fsState.files) return { isFile: () => true, isDirectory: () => false, mtimeMs: Date.now() };
      if (fsState.dirs.has(p)) return { isFile: () => false, isDirectory: () => true, mtimeMs: Date.now() };
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    },
    mkdirSync: (p) => { ensureDir(p); },
  };
});

vi.mock('../src/lib/server/settings.js', () => ({ resolveEnv: () => null }));

const ROOT = '/gc-race-root';
const DATA = `${ROOT}/data`;
const CACHES_PATH = `${DATA}/.cache/.caches.json`;
const ORIGINAL_CWD = process.cwd;
process.cwd = () => ROOT;

const { enrichTrips, invalidateEnrichCache, _markGeoDirtyForTest } =
  await import('../src/lib/server/data.js');

function readPersistedCaches() {
  const raw = fsState.files[CACHES_PATH];
  return raw ? JSON.parse(raw) : null;
}

beforeEach(() => {
  fsState.files = {};
  fsState.dirs = new Set();
  candidatesReadCount = 0;
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

describe('enrichTrips GC snapshot race (#489)', () => {
  it('does not prune a geocode entry whose candidate appeared mid-enrichment', async () => {
    // A planning trip with overview.md + candidates.yaml. The destination is
    // unique so it survives prune on its own merits.
    seedFile(
      `${DATA}/planning/glacier/overview.md`,
      `---\ntitle: Glacier\nstatus: planning\ndestination: West Glacier MT race-test\n---\nbody\n`,
    );
    seedFile(`${DATA}/planning/glacier/candidates.yaml`, 'placeholder'); // content comes from the read hook

    // Mocked Nominatim: every query resolves so the destination geocode in the
    // enrich loop succeeds. (Throttle sleeps are zeroed.)
    const realSetTimeout = globalThis.setTimeout;
    vi.stubGlobal('setTimeout', (cb) => realSetTimeout(cb, 0));
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => [{ class: 'place', addresstype: 'city', lat: '48.5', lon: '-114.0' }],
    })));

    // Seed the geocode cache for the candidate that "appears" mid-run — this
    // mimics the geocode-candidates job caching "Mid Run Stop" in the window
    // between the start-of-run snapshot and the GC prune.
    _markGeoDirtyForTest('Mid Run Stop', [48.6, -114.1]);

    await enrichTrips();

    const caches = readPersistedCaches();
    expect(caches).not.toBeNull();
    // The GC re-walk (#489) sees "Mid Run Stop" in candidates.yaml and keeps
    // its geocode entry. Without the fix, the start-of-run snapshot lacked it
    // and pruneCaches() deleted it before the flush.
    expect(caches.geo).toHaveProperty('Mid Run Stop');
  });

  it('still prunes a geocode entry that is genuinely orphaned (no live source)', async () => {
    seedFile(
      `${DATA}/planning/glacier/overview.md`,
      `---\ntitle: Glacier\nstatus: planning\ndestination: West Glacier MT race-test\n---\nbody\n`,
    );
    seedFile(`${DATA}/planning/glacier/candidates.yaml`, 'placeholder');

    const realSetTimeout = globalThis.setTimeout;
    vi.stubGlobal('setTimeout', (cb) => realSetTimeout(cb, 0));
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => [{ class: 'place', addresstype: 'city', lat: '48.5', lon: '-114.0' }],
    })));

    // An orphan that no trip or candidate references — must be pruned.
    _markGeoDirtyForTest('Orphan Nowhere', [10, 10]);

    await enrichTrips();

    const caches = readPersistedCaches();
    expect(caches).not.toBeNull();
    expect(caches.geo).not.toHaveProperty('Orphan Nowhere');
  });
});

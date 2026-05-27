/**
 * Tests for the two-tier geocode resolution inside enrichTripsImpl() (#421).
 *
 * Problem: the serial for-loop in enrichTripsImpl() serialized ALL geocodeCached()
 * calls — even cache hits — so 10 warm-cache trips still paid the 1.1s-per-miss
 * sleep because each trip waited for the previous trip's in-flight promise.
 *
 * Fix: two-tier resolution.
 *   1. Hit pass (parallel): Promise.all over trips — returns cached coord if
 *      present, null if not yet known. No network, no sleep.
 *   2. Miss pass (serialized): for each trip that got null in the hit pass,
 *      run through the existing rate-limited geocode path serially.
 *
 * Invariants asserted here:
 *   A. Warm cache (10 trips, all hits): geocode phase completes in <200ms;
 *      no fetch calls made; sleep(1100) never called.
 *   B. Cold cache (10 trips, all misses): exactly 10 fetch calls made.
 *   C. Mixed (5 hits, 5 misses): fetch called exactly 5 times.
 *   D. Coalescing: two concurrent enrichTrips() calls for the same uncached
 *      destination produce exactly one Nominatim request (geocodeInflight Map).
 *   E. sleep(1100) fires only on cache misses: warm-cache run never calls
 *      setTimeout(cb, 1100).
 *   F. _coords populated correctly on all trips for mixed hit/miss scenario.
 *
 * To keep B, C, D tests fast (not paying real 1.1s×N delays), we replace
 * setTimeout globally with a zero-delay shim, except for tests A and E that
 * explicitly measure timing or count the 1100ms calls.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── fs mock ───────────────────────────────────────────────────────────────────

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

// ── global constants ──────────────────────────────────────────────────────────

const ROOT = '/enrich-geocode-test-root';
const DATA = `${ROOT}/data`;

// ── helpers ───────────────────────────────────────────────────────────────────

function resetFs() {
  fsState.files = {};
  fsState.dirs = new Set();
  ensureDir(ROOT);
  ensureDir(`${DATA}/.cache`);
  ensureDir(`${DATA}/ideas`);
  ensureDir(`${DATA}/planning`);
  ensureDir(`${DATA}/completed`);
  seedFile(
    `${DATA}/home.md`,
    `---\nhome_city: Test City\nhome_coords: [38.97, -94.69]\n---\n`,
  );
}

function seedIdea(slug, destination) {
  seedFile(
    `${DATA}/ideas/${slug}.md`,
    `---\ntitle: ${slug}\nstatus: idea\ndestination: ${destination}\nvibe: test\ncreated: 2026-01-01\n---\nBody.\n`,
  );
}

function nominatimResponse(lat, lon) {
  return [{ class: 'place', addresstype: 'city', lat: String(lat), lon: String(lon) }];
}

// Stub fetch to return a valid geocode response. The counter lets tests assert
// on the number of real Nominatim requests.
function stubFetch(responseBuilder = () => nominatimResponse(41, -95)) {
  let callCount = 0;
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    callCount++;
    const m = url.match(/[?&]q=([^&]+)/);
    const dest = m ? decodeURIComponent(m[1]) : '__unknown__';
    return { ok: true, status: 200, json: async () => responseBuilder(dest, callCount) };
  }));
  return { getCallCount: () => callCount };
}

// Zero-delay setTimeout shim: replaces the 1100ms (and 500ms, 50ms, etc.) sleeps
// with immediate resolution so cold-cache tests don't take 11+ seconds.
// Returns a cleanup function that restores the original setTimeout.
function installInstantSleep() {
  const original = globalThis.setTimeout;
  globalThis.setTimeout = (cb, _delay, ...args) => original(cb, 0, ...args);
  return () => { globalThis.setTimeout = original; };
}

// ── module lifecycle ──────────────────────────────────────────────────────────
// vi.resetModules() in beforeEach gives each test a fresh data.js with an empty
// geocodeCache — same pattern as data-geocode.test.js.

const ORIGINAL_CWD = process.cwd;

let mod;
beforeEach(async () => {
  process.cwd = () => ROOT;
  resetFs();
  vi.resetModules();
  mod = await import('../src/lib/server/data.js');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  process.cwd = ORIGINAL_CWD;
});

// ── A: warm-cache timing ──────────────────────────────────────────────────────
//
// Real sleeps are NOT skipped here — we want to verify that a fully warm cache
// completes the geocode phase in under 200ms, which requires the actual sleep
// to be absent for cache hits.

describe('A: warm cache — 10 trips, all cache hits, <200ms', () => {
  it('finishes the geocode phase well under 200ms and makes no fetch calls', async () => {
    const destinations = Array.from({ length: 10 }, (_, i) => `WarmA${i} ST`);
    destinations.forEach((dest, i) => seedIdea(`a-warm-${i}`, dest));

    // Cold run: prime the geocodeCache (with real sleeps — accept the ~11s cost).
    let coldCallCount = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      coldCallCount++;
      return { ok: true, status: 200, json: async () => nominatimResponse(40 + coldCallCount * 0.1, -90) };
    }));
    await mod.enrichTrips();
    expect(coldCallCount).toBe(10);

    // Hot run: all hits, no network.
    mod.invalidateEnrichCache();
    vi.stubGlobal('fetch', vi.fn(() => {
      throw new Error('fetch must NOT be called on a warm-cache run');
    }));

    const t0 = Date.now();
    await mod.enrichTrips();
    const elapsed = Date.now() - t0;

    expect(globalThis.fetch).not.toHaveBeenCalled();
    // 200ms is very generous — actual should be <20ms with zero network calls.
    expect(elapsed).toBeLessThan(200);
  }, 60_000); // allow 11s cold run + warm run
});

// ── E: sleep(1100) never fires on cache hits ──────────────────────────────────

describe('E: sleep(1100) fires only on misses, never on warm-cache hits', () => {
  it('does not invoke setTimeout(cb, 1100) for any of 10 warm-cache trips', async () => {
    const destinations = Array.from({ length: 10 }, (_, i) => `WarmE${i} WA`);
    destinations.forEach((dest, i) => seedIdea(`e-warm-${i}`, dest));

    // Cold run to prime the cache (real sleeps).
    let coldIdx = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      coldIdx++;
      return { ok: true, status: 200, json: async () => nominatimResponse(40 + coldIdx * 0.1, -90) };
    }));
    await mod.enrichTrips();

    mod.invalidateEnrichCache();

    // Hot run: intercept setTimeout to detect any 1100ms sleep calls.
    vi.stubGlobal('fetch', vi.fn(() =>
      Promise.resolve({ ok: true, status: 200, json: async () => [] }),
    ));

    const originalSetTimeout = globalThis.setTimeout;
    const sleep1100Calls = [];
    vi.stubGlobal('setTimeout', vi.fn((cb, delay, ...args) => {
      if (delay === 1100) sleep1100Calls.push(delay);
      return originalSetTimeout(cb, delay, ...args);
    }));

    try {
      await mod.enrichTrips();
    } finally {
      vi.stubGlobal('setTimeout', originalSetTimeout);
    }

    expect(sleep1100Calls).toHaveLength(0);
  }, 60_000);
});

// ── B: cold cache ─────────────────────────────────────────────────────────────
// Uses instant-sleep shim so the test completes quickly.

describe('B: cold cache — one fetch per unique destination', () => {
  it('makes exactly 10 Nominatim requests for 10 distinct cold destinations', async () => {
    const destinations = Array.from({ length: 10 }, (_, i) => `ColdB${i} CO`);
    destinations.forEach((dest, i) => seedIdea(`b-cold-${i}`, dest));

    const restoreSetTimeout = installInstantSleep();
    const { getCallCount } = stubFetch();

    try {
      await mod.enrichTrips();
    } finally {
      restoreSetTimeout();
    }

    expect(getCallCount()).toBe(10);
  });
});

// ── C: mixed hit/miss ─────────────────────────────────────────────────────────

describe('C: mixed — only cold destinations trigger fetches', () => {
  it('makes exactly 5 Nominatim requests when 5 of 10 destinations are pre-cached', async () => {
    const hotDests  = Array.from({ length: 5 }, (_, i) => `MixHotC${i} MX`);
    const coldDests = Array.from({ length: 5 }, (_, i) => `MixColdC${i} MX`);

    // Seed hot trips only; run enrichTrips to prime their cache entries.
    hotDests.forEach((d, i) => seedIdea(`c-hot-${i}`, d));

    const restoreSetTimeout1 = installInstantSleep();
    let firstRunCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      firstRunCalls++;
      return { ok: true, status: 200, json: async () => nominatimResponse(40, -90) };
    }));
    try {
      await mod.enrichTrips();
    } finally {
      restoreSetTimeout1();
    }
    expect(firstRunCalls).toBe(5);

    // Add cold trips; invalidate enrich memo (keep geocodeCache).
    coldDests.forEach((d, i) => seedIdea(`c-cold-${i}`, d));
    mod.invalidateEnrichCache();
    vi.unstubAllGlobals();

    const restoreSetTimeout2 = installInstantSleep();
    let secondRunCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      secondRunCalls++;
      return { ok: true, status: 200, json: async () => nominatimResponse(41, -91) };
    }));
    try {
      await mod.enrichTrips();
    } finally {
      restoreSetTimeout2();
    }

    // Only the 5 cold destinations should have triggered Nominatim requests.
    expect(secondRunCalls).toBe(5);
  });
});

// ── D: geocodeInflight coalescing ─────────────────────────────────────────────

describe('D: geocodeInflight coalescing — one fetch for concurrent same-destination misses', () => {
  it('produces exactly one Nominatim request when two enrichTrips() calls race', async () => {
    seedIdea('d-coal', 'CoalesceD CC');

    const restoreSetTimeout = installInstantSleep();
    let fetchCallCount = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      fetchCallCount++;
      return { ok: true, status: 200, json: async () => nominatimResponse(41.0, -95.0) };
    }));

    let r1, r2;
    try {
      [r1, r2] = await Promise.all([mod.enrichTrips(), mod.enrichTrips()]);
    } finally {
      restoreSetTimeout();
    }

    // Both callers get the same result array (single-flight invariant from enrichTrips).
    expect(r1).toBe(r2);
    // Only one Nominatim request total.
    expect(fetchCallCount).toBe(1);
  });
});

// ── F: _coords correctness ────────────────────────────────────────────────────

describe('F: _coords populated correctly for all trips', () => {
  it('assigns correct coords to each trip regardless of hit/miss status', async () => {
    // Pre-warm one destination by seeding only that trip first.
    seedIdea('f-hot', 'HotCityF PA');

    const restoreSetTimeout1 = installInstantSleep();
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const m = url.match(/[?&]q=([^&]+)/);
      const dest = decodeURIComponent(m?.[1] ?? '');
      if (dest === 'HotCityF PA') {
        return { ok: true, status: 200, json: async () => nominatimResponse(40.0, -80.0) };
      }
      return { ok: true, status: 200, json: async () => [] };
    }));
    try {
      await mod.enrichTrips();
    } finally {
      restoreSetTimeout1();
    }

    // Now add a cold trip and re-enrich.
    seedIdea('f-cold', 'ColdCityF TX');
    mod.invalidateEnrichCache();
    vi.unstubAllGlobals();

    const restoreSetTimeout2 = installInstantSleep();
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const m = url.match(/[?&]q=([^&]+)/);
      const dest = decodeURIComponent(m?.[1] ?? '');
      if (dest === 'ColdCityF TX') {
        return { ok: true, status: 200, json: async () => nominatimResponse(29.76, -95.37) };
      }
      // HotCityF PA should not be fetched again — it's cached.
      throw new Error(`unexpected fetch for: ${dest}`);
    }));

    let trips;
    try {
      trips = await mod.enrichTrips();
    } finally {
      restoreSetTimeout2();
    }

    const hot  = trips.find(t => t.destination === 'HotCityF PA');
    const cold = trips.find(t => t.destination === 'ColdCityF TX');

    expect(hot).toBeDefined();
    expect(cold).toBeDefined();
    expect(hot._coords).toEqual([40.0, -80.0]);
    expect(cold._coords).toEqual([29.76, -95.37]);
  });
});

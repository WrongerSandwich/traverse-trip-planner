/**
 * Tests for the geocoder hardening that prevents waypoint disambiguation
 * failures from drawing dogleg routes (see #N — Honey Creek IA case).
 *
 * Three pure helpers + one integration:
 *   - pickBestGeocodeResult(results): prefer settlements over rivers/POIs
 *   - buildViewbox(home, dest, pad): bounding box for Nominatim re-ranking
 *   - isOffAxis(wp, home, dest, thresholdMi): detect implausible cached coords
 *   - geocode(q, { viewbox }): integrated behavior with fetch mocked
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Stub fs at module load so the cache files don't poison test state.
const fsMock = vi.hoisted(() => ({
  readFileSync: vi.fn(() => { throw new Error('no file'); }),
  existsSync: vi.fn(() => false),
  readdirSync: vi.fn(() => []),
  statSync: vi.fn(() => ({ isDirectory: () => false })),
  mkdirSync: vi.fn(),
  renameSync: vi.fn(),
  writeFileSync: vi.fn(),
}));
vi.mock('fs', () => fsMock);
vi.mock('node:fs', () => fsMock);

let mod;
beforeEach(async () => {
  vi.resetModules();
  mod = await import('../src/lib/server/data.js');
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

// ── pickBestGeocodeResult ────────────────────────────────────────────────────

describe('pickBestGeocodeResult', () => {
  it('returns null for empty array', () => {
    expect(mod.pickBestGeocodeResult([])).toBeNull();
  });

  it('returns the only result when it is a settlement', () => {
    const r = [{ class: 'place', addresstype: 'hamlet', lat: '41.43', lon: '-95.87' }];
    expect(mod.pickBestGeocodeResult(r)).toEqual([41.43, -95.87]);
  });

  it('prefers a settlement over a higher-ranked waterway (Honey Creek case)', () => {
    // Reproduces the real Nominatim response: a Lucas County river outranks
    // the Pottawattamie hamlet by importance, but we want the hamlet.
    const r = [
      { class: 'waterway', addresstype: 'river',  lat: '40.92', lon: '-93.13' },
      { class: 'place',    addresstype: 'hamlet', lat: '41.43', lon: '-95.87' },
    ];
    expect(mod.pickBestGeocodeResult(r)).toEqual([41.43, -95.87]);
  });

  it('prefers a settlement over a natural feature', () => {
    const r = [
      { class: 'natural', addresstype: 'peak', lat: '47.0', lon: '-121.0' },
      { class: 'place',   addresstype: 'town', lat: '47.5', lon: '-122.0' },
    ];
    expect(mod.pickBestGeocodeResult(r)).toEqual([47.5, -122.0]);
  });

  it('falls back to the top result when no settlement is present (POI waypoint)', () => {
    // Some waypoints are landmarks — "Hitchcock Nature Center" wouldn't match
    // settlement criteria. Don't drop these; use the top hit.
    const r = [
      { class: 'tourism', addresstype: 'attraction', lat: '41.4', lon: '-95.9' },
      { class: 'amenity', addresstype: 'parking',    lat: '41.5', lon: '-95.8' },
    ];
    expect(mod.pickBestGeocodeResult(r)).toEqual([41.4, -95.9]);
  });

  it('accepts a variety of settlement addresstypes (city/town/village/hamlet/suburb/municipality)', () => {
    for (const at of ['city', 'town', 'village', 'hamlet', 'suburb', 'municipality']) {
      const r = [
        { class: 'waterway', addresstype: 'river', lat: '40.0', lon: '-90.0' },
        { class: 'place',    addresstype: at,      lat: '41.0', lon: '-91.0' },
      ];
      expect(mod.pickBestGeocodeResult(r)).toEqual([41.0, -91.0]);
    }
  });

  it('rejects out-of-range coords and skips to the next candidate', () => {
    const r = [
      { class: 'place', addresstype: 'town', lat: '999', lon: '0' },
      { class: 'place', addresstype: 'town', lat: '41.0', lon: '-95.0' },
    ];
    expect(mod.pickBestGeocodeResult(r)).toEqual([41.0, -95.0]);
  });
});

// ── buildViewbox ─────────────────────────────────────────────────────────────

describe('buildViewbox', () => {
  it('returns [west, south, east, north] padded around both points', () => {
    // Home = Overland Park (38.97, -94.69), Dest = Pisgah IA (41.83, -95.93)
    const vb = mod.buildViewbox([38.97, -94.69], [41.83, -95.93], 1.0);
    // Expect [west, south, east, north] — Nominatim accepts any two opposing corners.
    const [west, south, east, north] = vb;
    expect(west).toBeCloseTo(-96.93, 2);   // -95.93 - 1.0
    expect(east).toBeCloseTo(-93.69, 2);   // -94.69 + 1.0
    expect(south).toBeCloseTo(37.97, 2);   // 38.97 - 1.0
    expect(north).toBeCloseTo(42.83, 2);   // 41.83 + 1.0
  });

  it('returns null when either endpoint is missing', () => {
    expect(mod.buildViewbox(null, [41.83, -95.93], 1.0)).toBeNull();
    expect(mod.buildViewbox([38.97, -94.69], null, 1.0)).toBeNull();
    expect(mod.buildViewbox(null, null, 1.0)).toBeNull();
  });

  it('applies a default padding of 1 degree', () => {
    const vb = mod.buildViewbox([40, -90], [42, -92]);
    const [west, south, east, north] = vb;
    expect(east - west).toBeCloseTo(4.0, 5);  // 2° span + 1° padding each side
    expect(north - south).toBeCloseTo(4.0, 5);
  });
});

// ── isOffAxis ────────────────────────────────────────────────────────────────

describe('isOffAxis', () => {
  // Home: Overland Park KS (38.97, -94.69)
  // Dest: Pisgah IA (41.83, -95.93)
  // This is a roughly north-by-northwest line ~325 mi long.
  const HOME = [38.97, -94.69];
  const DEST = [41.83, -95.93];
  const THRESHOLD_MI = 100;

  it('returns false for a waypoint sitting near the route line (correct Honey Creek)', () => {
    // Real Honey Creek (Pottawattamie County): (41.43, -95.87) — basically on the line.
    expect(mod.isOffAxis([41.43, -95.87], HOME, DEST, THRESHOLD_MI)).toBe(false);
  });

  it('returns true for the bad Honey Creek geocode (Lucas County river)', () => {
    // The bad coord that triggered the dogleg: (40.92, -93.13) — ~120 mi east of the corridor.
    expect(mod.isOffAxis([40.92, -93.13], HOME, DEST, THRESHOLD_MI)).toBe(true);
  });

  it('returns false for waypoints on the segment (Council Bluffs, Missouri Valley)', () => {
    expect(mod.isOffAxis([41.26, -95.85], HOME, DEST, THRESHOLD_MI)).toBe(false);
    expect(mod.isOffAxis([41.56, -95.89], HOME, DEST, THRESHOLD_MI)).toBe(false);
  });

  it('returns false when home or dest are missing (skip the check)', () => {
    expect(mod.isOffAxis([0, 0], null, DEST, THRESHOLD_MI)).toBe(false);
    expect(mod.isOffAxis([0, 0], HOME, null, THRESHOLD_MI)).toBe(false);
  });

  it('returns false for a point near home even if not exactly on the line', () => {
    // 20 mi northeast of home — small detour from the start, should pass.
    expect(mod.isOffAxis([39.25, -94.45], HOME, DEST, THRESHOLD_MI)).toBe(false);
  });

  it('returns true for a point clearly far from the corridor', () => {
    // Denver, CO — same general latitude band but ~500 mi west of the corridor.
    expect(mod.isOffAxis([39.74, -104.99], HOME, DEST, THRESHOLD_MI)).toBe(true);
  });
});

// ── geocode() integration ────────────────────────────────────────────────────

describe('geocode(): fetch integration', () => {
  function mockFetch(responseBody, status = 200) {
    const fetchMock = vi.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => responseBody,
    }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('uses limit=5 in the Nominatim URL (was limit=1)', async () => {
    const fetchMock = mockFetch([
      { class: 'place', addresstype: 'town', lat: '41.0', lon: '-95.0' },
    ]);
    await mod.geocode('Anywhere');
    const url = fetchMock.mock.calls[0][0];
    expect(url).toMatch(/limit=5/);
  });

  it('returns the settlement from a mixed result set (Honey Creek case)', async () => {
    mockFetch([
      { class: 'waterway', addresstype: 'river',  lat: '40.9180637', lon: '-93.1270364' },
      { class: 'place',    addresstype: 'hamlet', lat: '41.4332421', lon: '-95.8666517' },
    ]);
    const coords = await mod.geocode('Honey Creek IA');
    expect(coords).toEqual([41.4332421, -95.8666517]);
  });

  it('passes viewbox option through to the Nominatim URL', async () => {
    const fetchMock = mockFetch([
      { class: 'place', addresstype: 'town', lat: '41', lon: '-95' },
    ]);
    await mod.geocode('Anywhere', { viewbox: [-96.9, 37.9, -93.7, 42.8] });
    const url = fetchMock.mock.calls[0][0];
    // viewbox is URL-encoded; check for the encoded comma-joined string
    expect(url).toMatch(/viewbox=/);
    expect(decodeURIComponent(url)).toMatch(/viewbox=-96\.9,37\.9,-93\.7,42\.8/);
  });

  it('omits viewbox param when none is provided', async () => {
    const fetchMock = mockFetch([
      { class: 'place', addresstype: 'town', lat: '41', lon: '-95' },
    ]);
    await mod.geocode('Anywhere');
    const url = fetchMock.mock.calls[0][0];
    expect(url).not.toMatch(/viewbox=/);
  });

  it('returns null for empty result set', async () => {
    mockFetch([]);
    const coords = await mod.geocode('xyzzy');
    expect(coords).toBeNull();
  });

  it('caches by query string only (second call to same q skips fetch even with different viewbox)', async () => {
    const fetchMock = mockFetch([
      { class: 'place', addresstype: 'town', lat: '41', lon: '-95' },
    ]);
    await mod.geocode('Somewhere', { viewbox: [-96, 38, -94, 42] });
    await mod.geocode('Somewhere', { viewbox: [-100, 30, -90, 50] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

// ── geocodeWaypoints() off-axis eviction ─────────────────────────────────────

describe('geocodeWaypoints(): cache + off-axis eviction', () => {
  function mockFetchSequence(responses) {
    let i = 0;
    const fetchMock = vi.fn(async () => {
      const body = responses[Math.min(i, responses.length - 1)];
      i++;
      return { ok: true, status: 200, json: async () => body };
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('returns cached coords when they sit on-corridor (no re-fetch)', async () => {
    const fetchMock = mockFetchSequence([]);
    // Seed cache directly via geocode() with mocked fetch returning a valid settlement
    // for "Council Bluffs IA"
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200, json: async () => [
        { class: 'place', addresstype: 'city', lat: '41.2588', lon: '-95.8519' },
      ],
    })));
    const seedFetch = globalThis.fetch;
    await mod.geocode('Council Bluffs IA');
    expect(seedFetch).toHaveBeenCalledTimes(1);

    // Now call geocodeWaypoints with home + dest such that Council Bluffs is on the corridor.
    const HOME = [38.97, -94.69];
    const DEST = [41.83, -95.93];
    const coords = await mod.geocodeWaypoints(['Council Bluffs IA'], { homeCoords: HOME, destCoords: DEST });
    expect(coords).toEqual([[41.2588, -95.8519]]);
    // Only the initial seed fetch — no re-fetch
    expect(seedFetch).toHaveBeenCalledTimes(1);
    // suppress unused
    void fetchMock;
  });

  it('evicts a cached coord that is off-axis and re-geocodes with viewbox', async () => {
    const HOME = [38.97, -94.69];
    const DEST = [41.83, -95.93];

    // Seed cache with the WRONG Honey Creek (Lucas County river) — first fetch
    // returns only the river so the cache gets poisoned.
    let fetchCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      fetchCalls++;
      if (fetchCalls === 1) {
        // Initial seed — pre-viewbox-aware behavior; only the river is in the response
        return {
          ok: true, status: 200, json: async () => [
            { class: 'waterway', addresstype: 'river', lat: '40.9180637', lon: '-93.1270364' },
          ],
        };
      }
      // Re-geocode after eviction: this time the viewbox-biased fetch returns the hamlet
      return {
        ok: true, status: 200, json: async () => [
          { class: 'place', addresstype: 'hamlet', lat: '41.4332421', lon: '-95.8666517' },
        ],
      };
    }));
    await mod.geocode('Honey Creek IA');
    expect(fetchCalls).toBe(1);

    // Now geocodeWaypoints with proper context — the cached (40.92, -93.13) is
    // ~120 mi off the Overland Park → Pisgah corridor, so it should be evicted
    // and re-geocoded.
    const coords = await mod.geocodeWaypoints(['Honey Creek IA'], {
      homeCoords: HOME, destCoords: DEST,
    });
    expect(fetchCalls).toBe(2);
    expect(coords).toEqual([[41.4332421, -95.8666517]]);

    // The second URL must include viewbox
    const lastUrl = globalThis.fetch.mock.calls[1][0];
    expect(lastUrl).toMatch(/viewbox=/);
  });

  it('skips off-axis check when home or dest context is missing', async () => {
    // Seed bad cache
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200, json: async () => [
        { class: 'waterway', addresstype: 'river', lat: '40.92', lon: '-93.13' },
      ],
    })));
    await mod.geocode('Honey Creek IA');
    const initialCalls = globalThis.fetch.mock.calls.length;

    // Without context, no eviction — cache value is returned as-is.
    const coords = await mod.geocodeWaypoints(['Honey Creek IA']);
    expect(coords).toEqual([[40.92, -93.13]]);
    // No additional fetch
    expect(globalThis.fetch.mock.calls.length).toBe(initialCalls);
  });
});

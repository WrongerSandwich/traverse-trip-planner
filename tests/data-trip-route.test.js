/**
 * #491: getTripRoute() must degrade to null (→ 404 at the endpoint) when
 * Nominatim/OSRM are unavailable, rather than throwing (→ 500 in the client
 * console). The route line is a progressive enhancement; a missing line is
 * fine, an unhandled 500 is not.
 *
 * #488: getTripRoute consumes geocodeWaypoints' new { coords, error } shape —
 * a quota error surfaced by the swallow fix must not crash the lookup.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Configurable in-memory fs. Default: one planning trip with waypoints.
const fsState = vi.hoisted(() => ({ files: /** @type {Record<string,string>} */ ({}) }));

const fsMock = vi.hoisted(() => ({
  readFileSync: vi.fn((p) => {
    if (p in fsState.files) return fsState.files[p];
    throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  }),
  existsSync: vi.fn((p) => p in fsState.files),
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
  fsState.files = {};
  mod = await import('../src/lib/server/data.js');
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

/** Seed a planning trip overview with waypoints under the data dir. */
function seedTrip(slug, waypoints) {
  // DATA_DIR is `${cwd}/data`; the test cwd resolves to the repo root, but the
  // path only needs to be internally consistent with what existsSync checks.
  const path = `${mod.DATA_DIR}/planning/${slug}/overview.md`;
  const wp = `[${waypoints.join(', ')}]`;
  fsState.files[path] =
    `---\ntitle: Test\nstatus: planning\ndestination: Somewhere ST\nwaypoints: ${wp}\n---\nbody\n`;
}

describe('getTripRoute() service-failure degradation (#491)', () => {
  it('returns null (not a throw) when geocode rate-limits with geocode_quota', async () => {
    seedTrip('quota-trip', ['Town A ST', 'Town B ST']);
    // Make the 429-retry sleep instant.
    const realSetTimeout = globalThis.setTimeout;
    vi.stubGlobal('setTimeout', (cb) => realSetTimeout(cb, 0));
    // Every Nominatim call 429s → geocode() re-throws geocode_quota (#488).
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 429, json: async () => [] })));

    await expect(mod.getTripRoute('quota-trip')).resolves.toBeNull();
  });

  it('returns null when fetch rejects outright (network down)', async () => {
    seedTrip('down-trip', ['Town A ST', 'Town B ST']);
    const realSetTimeout = globalThis.setTimeout;
    vi.stubGlobal('setTimeout', (cb) => realSetTimeout(cb, 0));
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));

    await expect(mod.getTripRoute('down-trip')).resolves.toBeNull();
  });

  it('returns null for a trip with no waypoints without touching the network', async () => {
    const path = `${mod.DATA_DIR}/planning/no-wp/overview.md`;
    fsState.files[path] = `---\ntitle: T\nstatus: planning\ndestination: X\n---\nbody\n`;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(mod.getTripRoute('no-wp')).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

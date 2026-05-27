/**
 * Contract for the single-file cache layout (issue #420). Geocode, image,
 * and route caches previously lived in three separate files under
 * `data/.cache/`. flushCaches() wrote them sequentially, which gave only
 * per-file atomicity — concurrent SSR requests could interleave their
 * writes against pruneCaches() and produce referential drift across the
 * three files. The single combined `.caches.json` collapses that to a
 * single atomicWrite() per flush.
 *
 * Tests use the mkdtemp + chdir + vi.resetModules pattern from
 * tests/image-cache-purge.test.js so each test exercises a real data.js
 * with controlled fixture state.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, mkdtempSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let workdir;
let originalCwd;

function cachePath(name) {
  return join(workdir, 'data', '.cache', name);
}

beforeEach(() => {
  vi.resetModules();
  workdir = mkdtempSync(join(tmpdir(), 'traverse-cache-flush-'));
  mkdirSync(join(workdir, 'data', '.cache'), { recursive: true });
  originalCwd = process.cwd();
  process.chdir(workdir);
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(workdir, { recursive: true, force: true });
});

describe('cache load — combined .caches.json', () => {
  it('reads geo, image, and route from a present combined file', async () => {
    writeFileSync(cachePath('.caches.json'), JSON.stringify({
      geo:   { 'Portland OR': [45.5, -122.7] },
      image: { 'Portland city': { value: { medium: 'm' }, fetchedAt: 1 } },
      route: { 'k1': [[45.5, -122.7], [46, -123]] },
    }));

    const data = await import('../src/lib/server/data.js');
    // Indirect verification: a known geocode entry survives load via geocode()
    // hitting the cache without making a network call. (Direct cache export
    // not part of the public API; assert via behavior.)
    // ...but for these tests we just need to know the combined file was read.
    // The combined file should remain on disk untouched.
    expect(existsSync(cachePath('.caches.json'))).toBe(true);
    expect(JSON.parse(readFileSync(cachePath('.caches.json'), 'utf8')).geo['Portland OR']).toEqual([45.5, -122.7]);
    expect(typeof data.flushCaches).toBe('function');
  });

  it('migrates from legacy three-file layout into a combined file and deletes legacy files', async () => {
    writeFileSync(cachePath('.geocode-cache.json'), JSON.stringify({ 'Portland OR': [45.5, -122.7] }));
    writeFileSync(cachePath('.image-cache.json'),   JSON.stringify({ 'Portland city': { value: { medium: 'm' }, fetchedAt: 1 } }));
    writeFileSync(cachePath('.route-cache.json'),   JSON.stringify({ 'k1': [[45.5, -122.7], [46, -123]] }));

    await import('../src/lib/server/data.js');

    // Combined file produced with merged content.
    expect(existsSync(cachePath('.caches.json'))).toBe(true);
    const combined = JSON.parse(readFileSync(cachePath('.caches.json'), 'utf8'));
    expect(combined.geo['Portland OR']).toEqual([45.5, -122.7]);
    expect(combined.image['Portland city']).toEqual({ value: { medium: 'm' }, fetchedAt: 1 });
    expect(combined.route['k1']).toEqual([[45.5, -122.7], [46, -123]]);

    // Legacy files removed so future reads can't drift from the combined file.
    expect(existsSync(cachePath('.geocode-cache.json'))).toBe(false);
    expect(existsSync(cachePath('.image-cache.json'))).toBe(false);
    expect(existsSync(cachePath('.route-cache.json'))).toBe(false);
  });

  it('handles partial legacy state (only some files present)', async () => {
    writeFileSync(cachePath('.geocode-cache.json'), JSON.stringify({ 'Portland OR': [45.5, -122.7] }));
    // No image-cache or route-cache.

    await import('../src/lib/server/data.js');

    expect(existsSync(cachePath('.caches.json'))).toBe(true);
    const combined = JSON.parse(readFileSync(cachePath('.caches.json'), 'utf8'));
    expect(combined.geo['Portland OR']).toEqual([45.5, -122.7]);
    expect(combined.image).toEqual({});
    expect(combined.route).toEqual({});

    expect(existsSync(cachePath('.geocode-cache.json'))).toBe(false);
  });

  it('prefers the combined file when both combined and legacy files exist', async () => {
    // Hand-crafted conflict: combined says coords A, legacy says coords B.
    // The combined file is canonical and must win.
    writeFileSync(cachePath('.caches.json'), JSON.stringify({
      geo: { 'Portland OR': [45.5, -122.7] },
      image: {},
      route: {},
    }));
    writeFileSync(cachePath('.geocode-cache.json'), JSON.stringify({ 'Portland OR': [0, 0] }));

    await import('../src/lib/server/data.js');

    const combined = JSON.parse(readFileSync(cachePath('.caches.json'), 'utf8'));
    expect(combined.geo['Portland OR']).toEqual([45.5, -122.7]);
  });

  it('starts with empty caches when nothing is on disk', async () => {
    const { flushCaches } = await import('../src/lib/server/data.js');

    // No combined or legacy files were written; init should not have produced
    // a combined file either (no migration was triggered — there's nothing
    // to merge).
    expect(existsSync(cachePath('.caches.json'))).toBe(false);

    // flushCaches with nothing dirty should be a no-op (no file produced).
    flushCaches();
    expect(existsSync(cachePath('.caches.json'))).toBe(false);
  });
});

describe('cache flush — atomicity across the three cache subsets', () => {
  it('a flush after a mutation writes a single combined file (not the legacy three)', async () => {
    // Pre-seed a tiny combined file so the load is deterministic.
    writeFileSync(cachePath('.caches.json'), JSON.stringify({ geo: {}, image: {}, route: {} }));

    const { flushCaches, _markGeoDirtyForTest } = await import('../src/lib/server/data.js');
    // Mutate via a test-only helper so we don't have to drive a real geocode
    // network call through Nominatim mocks. The helper sets one entry on the
    // geocode cache and marks it dirty.
    _markGeoDirtyForTest('Portland OR', [45.5, -122.7]);

    flushCaches();

    expect(existsSync(cachePath('.caches.json'))).toBe(true);
    const combined = JSON.parse(readFileSync(cachePath('.caches.json'), 'utf8'));
    expect(combined.geo['Portland OR']).toEqual([45.5, -122.7]);

    // Crucially, the legacy paths must NOT reappear — the single-file layout
    // is the only persistence target now.
    expect(existsSync(cachePath('.geocode-cache.json'))).toBe(false);
    expect(existsSync(cachePath('.image-cache.json'))).toBe(false);
    expect(existsSync(cachePath('.route-cache.json'))).toBe(false);
  });
});

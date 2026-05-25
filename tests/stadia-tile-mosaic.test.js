import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockResolveEnv = vi.hoisted(() => vi.fn());
vi.mock('$lib/server/settings.js', () => ({ resolveEnv: mockResolveEnv }));

import { stadiaTileMosaic, _resetProbeCacheForTest } from '../src/lib/server/stadia.js';

function okProbe() {
  return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), {
    status: 200,
    headers: { 'content-type': 'image/png' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetProbeCacheForTest();
  mockResolveEnv.mockImplementation((k) => (k === 'STADIA_API_KEY' ? 'STADIA-TEST-KEY' : undefined));
  globalThis.fetch = vi.fn(async () => okProbe());
});

const baseArgs = {
  centerLat: 43.0747,
  centerLon: -89.3861,
  zoom: 12,
  viewBoxW: 720,
  viewBoxH: 480,
  style: 'outdoors',
  retina: true,
};

describe('stadiaTileMosaic', () => {
  it('returns null when STADIA_API_KEY is unset (no probe fetched)', async () => {
    mockResolveEnv.mockReturnValue(undefined);
    const res = await stadiaTileMosaic(baseArgs);
    expect(res).toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('returns a tile mosaic when the probe succeeds', async () => {
    const res = await stadiaTileMosaic(baseArgs);
    expect(res).not.toBeNull();
    expect(res.zoom).toBe(12);
    expect(res.centerLat).toBeCloseTo(43.0747);
    expect(res.tiles.length).toBeGreaterThan(0);
    // Each tile carries an SVG-space position + same-origin proxy URL.
    for (const t of res.tiles) {
      expect(t.url).toMatch(/^\/api\/stadia-tile\?/);
      expect(t.url).toContain('style=outdoors');
      expect(t.url).toContain('r=2x');
      expect(t.w).toBe(256);
      expect(t.h).toBe(256);
    }
  });

  it('probes Stadia exactly once and caches the verdict', async () => {
    await stadiaTileMosaic(baseArgs);
    await stadiaTileMosaic(baseArgs);
    await stadiaTileMosaic(baseArgs);
    // First call probes, subsequent calls hit the TTL cache.
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const probeUrl = globalThis.fetch.mock.calls[0][0];
    expect(probeUrl).toContain('/outdoors/0/0/0@2x.png');
    expect(probeUrl).toContain('api_key=STADIA-TEST-KEY');
  });

  it('falls back to null when the probe returns non-200', async () => {
    globalThis.fetch = vi.fn(async () => new Response('forbidden', { status: 403 }));
    const res = await stadiaTileMosaic(baseArgs);
    expect(res).toBeNull();
  });

  it('falls back to null when the probe network call throws', async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error('ECONNRESET'); });
    const res = await stadiaTileMosaic(baseArgs);
    expect(res).toBeNull();
  });

  it('caches a failure verdict so a bad key does not get re-probed each render', async () => {
    globalThis.fetch = vi.fn(async () => new Response('forbidden', { status: 403 }));
    await stadiaTileMosaic(baseArgs);
    await stadiaTileMosaic(baseArgs);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('separates cache entries when retina changes', async () => {
    await stadiaTileMosaic(baseArgs);
    await stadiaTileMosaic({ ...baseArgs, retina: false });
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    const calls = globalThis.fetch.mock.calls.map((c) => c[0]);
    expect(calls[0]).toContain('@2x.png');
    expect(calls[1]).toMatch(/\/0\/0\/0\.png/);
  });
});

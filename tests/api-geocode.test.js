import { describe, it, expect, vi, beforeEach } from 'vitest';

// Stub @sveltejs/kit so we can inspect response bodies.
vi.mock('@sveltejs/kit', () => ({
  json: (body, init = {}) => ({ _body: body, _status: init.status ?? 200 }),
  error: (status, msg) => {
    throw Object.assign(new Error(msg), { status });
  },
}));

// Mock the data module so no real disk/network calls happen.
vi.mock('../src/lib/server/data.js', () => ({
  geocode: vi.fn(),
  flushCaches: vi.fn(),
}));

import { geocode, flushCaches } from '../src/lib/server/data.js';
import { GET } from '../src/routes/api/geocode/+server.js';

/**
 * Build a mock SvelteKit `url` object with the given search params.
 */
function makeUrl(params = {}) {
  const sp = new URLSearchParams(params);
  return { searchParams: sp };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Pure helper: response shape transform ────────────────────────────────────

/**
 * normalizeResult mirrors the transform in the endpoint:
 * geocode() coords → { label, lat, lon }.
 * Extracted here so we can unit-test it independently of the HTTP layer.
 */
function normalizeResult(query, coords) {
  if (!coords) return null;
  const [lat, lon] = coords;
  return { label: query, lat, lon };
}

describe('normalizeResult (shape transform)', () => {
  it('returns null when coords are null', () => {
    expect(normalizeResult('Anywhere', null)).toBeNull();
  });

  it('maps [lat, lon] coords to { label, lat, lon }', () => {
    const result = normalizeResult('Kansas City, MO', [39.0997, -94.5786]);
    expect(result).toEqual({ label: 'Kansas City, MO', lat: 39.0997, lon: -94.5786 });
  });

  it('preserves the query string as the label', () => {
    const result = normalizeResult('Overland Park, KS', [38.9822, -94.6708]);
    expect(result.label).toBe('Overland Park, KS');
  });
});

// ── Validation ───────────────────────────────────────────────────────────────

describe('GET /api/geocode — validation', () => {
  it('returns 400 with code=invalid_input when q is missing', async () => {
    const res = await GET({ url: makeUrl() });
    expect(res._status).toBe(400);
    expect(res._body.code).toBe('invalid_input');
    expect(res._body.error).toMatch(/required/i);
  });

  it('returns 400 with code=invalid_input when q is empty string', async () => {
    const res = await GET({ url: makeUrl({ q: '' }) });
    expect(res._status).toBe(400);
    expect(res._body.code).toBe('invalid_input');
  });

  it('returns 400 with code=invalid_input when q is whitespace-only', async () => {
    const res = await GET({ url: makeUrl({ q: '   ' }) });
    expect(res._status).toBe(400);
    expect(res._body.code).toBe('invalid_input');
  });

  it('does not call geocode() when q is invalid', async () => {
    await GET({ url: makeUrl({ q: '' }) });
    expect(geocode).not.toHaveBeenCalled();
  });
});

// ── Happy path ───────────────────────────────────────────────────────────────

describe('GET /api/geocode — happy path', () => {
  it('returns 200 with a single result when geocode() finds a match', async () => {
    geocode.mockResolvedValue([38.9822, -94.6708]);

    const res = await GET({ url: makeUrl({ q: 'Overland Park, KS' }) });
    expect(res._status).toBe(200);
    expect(res._body.results).toHaveLength(1);
    const [r] = res._body.results;
    expect(r.label).toBe('Overland Park, KS');
    expect(r.lat).toBe(38.9822);
    expect(r.lon).toBe(-94.6708);
  });

  it('calls geocode() with the trimmed query string', async () => {
    geocode.mockResolvedValue([39.0997, -94.5786]);

    await GET({ url: makeUrl({ q: '  Kansas City  ' }) });
    expect(geocode).toHaveBeenCalledWith('Kansas City');
  });

  it('returns an empty results array when geocode() returns null (no match)', async () => {
    geocode.mockResolvedValue(null);

    const res = await GET({ url: makeUrl({ q: 'xyzzy-no-such-place' }) });
    expect(res._status).toBe(200);
    expect(res._body.results).toEqual([]);
  });

  it('always calls flushCaches() after geocode()', async () => {
    geocode.mockResolvedValue([38.9, -94.6]);

    await GET({ url: makeUrl({ q: 'Some City' }) });
    expect(flushCaches).toHaveBeenCalledOnce();
  });

  it('calls flushCaches() even on a cache miss (null result)', async () => {
    geocode.mockResolvedValue(null);

    await GET({ url: makeUrl({ q: 'Nowhere' }) });
    expect(flushCaches).toHaveBeenCalledOnce();
  });
});

// ── Response shape contract ───────────────────────────────────────────────────

describe('GET /api/geocode — response shape', () => {
  it('always returns a "results" array at the top level', async () => {
    geocode.mockResolvedValue([40.0, -90.0]);

    const res = await GET({ url: makeUrl({ q: 'Springfield, IL' }) });
    expect(res._body).toHaveProperty('results');
    expect(Array.isArray(res._body.results)).toBe(true);
  });

  it('result items have exactly label, lat, lon', async () => {
    geocode.mockResolvedValue([39.7392, -104.9903]);

    const res = await GET({ url: makeUrl({ q: 'Denver, CO' }) });
    const [r] = res._body.results;
    expect(Object.keys(r).sort()).toEqual(['label', 'lat', 'lon']);
  });

  it('lat and lon are numbers, not strings', async () => {
    geocode.mockResolvedValue([36.1627, -86.7816]);

    const res = await GET({ url: makeUrl({ q: 'Nashville, TN' }) });
    const [r] = res._body.results;
    expect(typeof r.lat).toBe('number');
    expect(typeof r.lon).toBe('number');
  });
});

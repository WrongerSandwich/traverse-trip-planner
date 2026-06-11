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

// Mock rate-limit so we control its behavior per test.
vi.mock('../src/lib/server/rate-limit.js', () => ({
  rateLimitResponse: vi.fn(() => null),
}));

import { geocode, flushCaches } from '../src/lib/server/data.js';
import { rateLimitResponse } from '../src/lib/server/rate-limit.js';
import { TraverseError } from '../src/lib/server/errors.js';
import { GET } from '../src/routes/api/geocode/+server.js';

/**
 * Build a mock SvelteKit event object with the given search params.
 */
function makeEvent(params = {}, ip = '127.0.0.1') {
  const sp = new URLSearchParams(params);
  return {
    url: { searchParams: sp },
    getClientAddress: () => ip,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: rate limiter allows all requests.
  rateLimitResponse.mockReturnValue(null);
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
    const result = normalizeResult('Cleveland, OH', [41.4993, -81.6944]);
    expect(result.label).toBe('Cleveland, OH');
  });
});

// ── Rate limiting ─────────────────────────────────────────────────────────────

describe('GET /api/geocode — rate limiting', () => {
  it('returns 429 immediately when rateLimitResponse returns a response', async () => {
    const mockLimited = { _body: { code: 'rate_limited' }, _status: 429 };
    rateLimitResponse.mockReturnValue(mockLimited);

    const res = await GET(makeEvent({ q: 'Denver, CO' }));
    expect(res).toBe(mockLimited);
    expect(res._status).toBe(429);
    // Should not proceed to geocode when rate-limited
    expect(geocode).not.toHaveBeenCalled();
  });

  it('passes the event and geocode endpoint to rateLimitResponse', async () => {
    geocode.mockResolvedValue({ coords: [39.0997, -94.5786], fromCache: false });
    const event = makeEvent({ q: 'Kansas City, MO' });

    await GET(event);

    expect(rateLimitResponse).toHaveBeenCalledOnce();
    expect(rateLimitResponse).toHaveBeenCalledWith({ event, endpoint: 'geocode' });
  });
});

// ── Validation ───────────────────────────────────────────────────────────────

describe('GET /api/geocode — validation', () => {
  it('returns 400 with code=invalid_input when q is missing', async () => {
    const res = await GET(makeEvent());
    expect(res._status).toBe(400);
    expect(res._body.code).toBe('invalid_input');
    expect(res._body.error).toMatch(/required/i);
  });

  it('returns 400 with code=invalid_input when q is empty string', async () => {
    const res = await GET(makeEvent({ q: '' }));
    expect(res._status).toBe(400);
    expect(res._body.code).toBe('invalid_input');
  });

  it('returns 400 with code=invalid_input when q is whitespace-only', async () => {
    const res = await GET(makeEvent({ q: '   ' }));
    expect(res._status).toBe(400);
    expect(res._body.code).toBe('invalid_input');
  });

  it('does not call geocode() when q is invalid', async () => {
    await GET(makeEvent({ q: '' }));
    expect(geocode).not.toHaveBeenCalled();
  });
});

// ── Happy path ───────────────────────────────────────────────────────────────

describe('GET /api/geocode — happy path', () => {
  it('returns 200 with a single result when geocode() finds a match', async () => {
    geocode.mockResolvedValue({ coords: [41.4993, -81.6944], fromCache: false });

    const res = await GET(makeEvent({ q: 'Cleveland, OH' }));
    expect(res._status).toBe(200);
    expect(res._body.results).toHaveLength(1);
    const [r] = res._body.results;
    expect(r.label).toBe('Cleveland, OH');
    expect(r.lat).toBe(41.4993);
    expect(r.lon).toBe(-81.6944);
  });

  it('calls geocode() with the trimmed query string', async () => {
    geocode.mockResolvedValue({ coords: [39.0997, -94.5786], fromCache: false });

    await GET(makeEvent({ q: '  Kansas City  ' }));
    expect(geocode).toHaveBeenCalledWith('Kansas City');
  });

  it('returns an empty results array when geocode() returns null (no match)', async () => {
    geocode.mockResolvedValue({ coords: null, fromCache: false });

    const res = await GET(makeEvent({ q: 'xyzzy-no-such-place' }));
    expect(res._status).toBe(200);
    expect(res._body.results).toEqual([]);
  });

  it('always calls flushCaches() after geocode()', async () => {
    geocode.mockResolvedValue({ coords: [38.9, -94.6], fromCache: false });

    await GET(makeEvent({ q: 'Some City' }));
    expect(flushCaches).toHaveBeenCalledOnce();
  });

  it('calls flushCaches() even on a cache miss (null result)', async () => {
    geocode.mockResolvedValue({ coords: null, fromCache: false });

    await GET(makeEvent({ q: 'Nowhere' }));
    expect(flushCaches).toHaveBeenCalledOnce();
  });
});

// ── #488: rate-limit no longer 500s ───────────────────────────────────────────

describe('GET /api/geocode — geocode_quota handling', () => {
  it('returns 429 with code=geocode_quota when geocode() throws a quota error', async () => {
    // geocode() now re-throws geocode_quota (Nominatim 429) instead of
    // swallowing it; the endpoint must degrade to a typed 429, not a 500.
    geocode.mockRejectedValue(new TraverseError('geocode_quota', 'rate limited'));

    const res = await GET(makeEvent({ q: 'Busy Place' }));
    expect(res._status).toBe(429);
    expect(res._body.code).toBe('geocode_quota');
    // Cache is still flushed on the quota path.
    expect(flushCaches).toHaveBeenCalledOnce();
  });

  it('re-throws a non-quota error rather than masking it', async () => {
    geocode.mockRejectedValue(new Error('unexpected boom'));
    await expect(GET(makeEvent({ q: 'Somewhere' }))).rejects.toThrow('unexpected boom');
  });
});

// ── Response shape contract ───────────────────────────────────────────────────

describe('GET /api/geocode — response shape', () => {
  it('always returns a "results" array at the top level', async () => {
    geocode.mockResolvedValue({ coords: [40.0, -90.0], fromCache: false });

    const res = await GET(makeEvent({ q: 'Springfield, IL' }));
    expect(res._body).toHaveProperty('results');
    expect(Array.isArray(res._body.results)).toBe(true);
  });

  it('result items have exactly label, lat, lon', async () => {
    geocode.mockResolvedValue({ coords: [39.7392, -104.9903], fromCache: false });

    const res = await GET(makeEvent({ q: 'Denver, CO' }));
    const [r] = res._body.results;
    expect(Object.keys(r).sort()).toEqual(['label', 'lat', 'lon']);
  });

  it('lat and lon are numbers, not strings', async () => {
    geocode.mockResolvedValue({ coords: [36.1627, -86.7816], fromCache: false });

    const res = await GET(makeEvent({ q: 'Nashville, TN' }));
    const [r] = res._body.results;
    expect(typeof r.lat).toBe('number');
    expect(typeof r.lon).toBe('number');
  });
});

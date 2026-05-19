import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockResolveEnv = vi.hoisted(() => vi.fn());
vi.mock('$lib/server/settings.js', () => ({ resolveEnv: mockResolveEnv }));

import { GET } from '../src/routes/api/stadia-map/+server.js';
import { _resetBucketsForTest } from '../src/lib/server/rate-limit.js';

function evt(qs, { clientAddress = '127.0.0.1' } = {}) {
  return {
    url: new URL(`http://x/api/stadia-map?${qs}`),
    request: new Request(`http://x/api/stadia-map?${qs}`),
    getClientAddress: () => clientAddress,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveEnv.mockImplementation((k) => k === 'STADIA_API_KEY' ? 'STADIA-TEST-KEY' : undefined);
  _resetBucketsForTest?.();
  // Stub fetch — happy path returns a small PNG.
  globalThis.fetch = vi.fn(async () => new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), {
    status: 200,
    headers: { 'content-type': 'image/png' },
  }));
});

describe('GET /api/stadia-map', () => {
  it('returns 503 when STADIA_API_KEY is unset', async () => {
    mockResolveEnv.mockReturnValue(undefined);
    const res = await GET(evt('center=38.98,-94.67&zoom=12&size=720x480&style=outdoors'));
    expect(res.status).toBe(503);
  });

  it('proxies the image and strips the key from the public URL', async () => {
    const res = await GET(evt('center=38.98,-94.67&zoom=12&size=720x480@2x&style=outdoors'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('cache-control')).toMatch(/max-age=\d+/);
    // Upstream fetch was called with the real key, but the response we return
    // doesn't echo it anywhere.
    const calledWith = globalThis.fetch.mock.calls[0][0];
    expect(calledWith).toContain('api_key=STADIA-TEST-KEY');
    const bodyText = await res.text();
    expect(bodyText).not.toContain('STADIA-TEST-KEY');
  });

  it('rejects unknown style', async () => {
    const res = await GET(evt('center=0,0&zoom=10&size=100x100&style=satellite'));
    expect(res.status).toBe(400);
  });

  it('rejects malformed center', async () => {
    const res = await GET(evt('center=foo&zoom=10&size=100x100&style=outdoors'));
    expect(res.status).toBe(400);
  });

  it('rejects out-of-range center', async () => {
    const res = await GET(evt('center=91,0&zoom=10&size=100x100&style=outdoors'));
    expect(res.status).toBe(400);
  });

  it('rejects non-integer zoom', async () => {
    const res = await GET(evt('center=0,0&zoom=12.5&size=100x100&style=outdoors'));
    expect(res.status).toBe(400);
  });

  it('rejects oversized dimensions', async () => {
    const res = await GET(evt('center=0,0&zoom=10&size=3000x3000&style=outdoors'));
    expect(res.status).toBe(400);
  });

  it('returns 429 after exhausting the per-IP bucket', async () => {
    // stadia-map capacity = 30; fire 31 requests from the same IP.
    let last;
    for (let i = 0; i < 31; i++) {
      last = await GET(evt('center=0,0&zoom=10&size=100x100&style=outdoors'));
    }
    expect(last.status).toBe(429);
  });

  it('propagates a 502 when Stadia rejects the key', async () => {
    globalThis.fetch = vi.fn(async () => new Response('unauthorized', { status: 401 }));
    const res = await GET(evt('center=0,0&zoom=10&size=100x100&style=outdoors', { clientAddress: '10.0.0.1' }));
    expect(res.status).toBe(502);
  });
});

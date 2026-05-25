import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockResolveEnv = vi.hoisted(() => vi.fn());
vi.mock('$lib/server/settings.js', () => ({ resolveEnv: mockResolveEnv }));

import { GET } from '../src/routes/api/stadia-tile/+server.js';
import { _resetBucketsForTest } from '../src/lib/server/rate-limit.js';

function evt(qs, { clientAddress = '127.0.0.1' } = {}) {
  return {
    url: new URL(`http://x/api/stadia-tile?${qs}`),
    request: new Request(`http://x/api/stadia-tile?${qs}`),
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

describe('GET /api/stadia-tile', () => {
  it('returns 503 when STADIA_API_KEY is unset', async () => {
    mockResolveEnv.mockReturnValue(undefined);
    const res = await GET(evt('z=12&x=1000&y=1500&style=outdoors'));
    expect(res.status).toBe(503);
  });

  it('proxies the tile and never echoes the key in the response', async () => {
    const res = await GET(evt('z=12&x=1000&y=1500&style=outdoors&r=2x'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('cache-control')).toMatch(/max-age=\d+/);
    const calledWith = globalThis.fetch.mock.calls[0][0];
    expect(calledWith).toContain('api_key=STADIA-TEST-KEY');
    expect(calledWith).toContain('/outdoors/12/1000/1500@2x.png');
    const bodyText = await res.text();
    expect(bodyText).not.toContain('STADIA-TEST-KEY');
  });

  it('builds a non-retina URL when r is omitted', async () => {
    await GET(evt('z=12&x=1000&y=1500&style=outdoors'));
    const calledWith = globalThis.fetch.mock.calls[0][0];
    expect(calledWith).toContain('/outdoors/12/1000/1500.png');
    expect(calledWith).not.toContain('@2x');
  });

  it('rejects unknown style', async () => {
    const res = await GET(evt('z=12&x=0&y=0&style=satellite'));
    expect(res.status).toBe(400);
  });

  it('rejects an unsupported retina suffix', async () => {
    const res = await GET(evt('z=12&x=0&y=0&style=outdoors&r=4x'));
    expect(res.status).toBe(400);
  });

  it('rejects non-integer zoom', async () => {
    const res = await GET(evt('z=12.5&x=0&y=0&style=outdoors'));
    expect(res.status).toBe(400);
  });

  it('rejects tile coords out of range for the zoom', async () => {
    // At z=2 the max tile index is 3. Asking for x=4 must 400.
    const res = await GET(evt('z=2&x=4&y=0&style=outdoors'));
    expect(res.status).toBe(400);
  });

  it('returns 429 after exhausting the per-IP bucket', async () => {
    // stadia-tile capacity = 60; fire 61 requests from the same IP.
    let last;
    for (let i = 0; i < 61; i++) {
      last = await GET(evt('z=12&x=0&y=0&style=outdoors'));
    }
    expect(last.status).toBe(429);
  });

  it('propagates a 502 when Stadia rejects the key', async () => {
    globalThis.fetch = vi.fn(async () => new Response('unauthorized', { status: 401 }));
    const res = await GET(evt('z=12&x=0&y=0&style=outdoors', { clientAddress: '10.0.0.1' }));
    expect(res.status).toBe(502);
  });
});

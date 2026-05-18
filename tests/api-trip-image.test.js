import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// We stub data.js (fetchImage / updateImageMeta) per-test instead of
// touching real disk or hitting Pexels.

afterEach(() => vi.resetModules());

describe('GET /api/trip/[slug]/image/search', () => {
  it('returns 400 when q is missing', async () => {
    vi.doMock('$lib/server/data.js', () => ({ fetchImage: vi.fn() }));
    const { GET } = await import('../src/routes/api/trip/[slug]/image/search/+server.js');
    const res = await GET({ params: { slug: 'demo' }, url: new URL('http://x/?q=') });
    expect(res.status).toBe(400);
  });

  it('returns 503 image_search_unconfigured when PEXELS_API_KEY is missing', async () => {
    vi.doMock('$lib/server/data.js', () => ({
      // fetchImage returns null when no API key is configured.
      fetchImage: vi.fn().mockResolvedValue(null),
      isPexelsConfigured: vi.fn().mockReturnValue(false),
    }));
    const { GET } = await import('../src/routes/api/trip/[slug]/image/search/+server.js');
    const res = await GET({ params: { slug: 'demo' }, url: new URL('http://x/?q=mountains') });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe('image_search_unconfigured');
  });

  it('returns the photos array on success', async () => {
    const photos = [
      { medium: 'a-m', large: 'a-l', photographer: 'A' },
      { medium: 'b-m', large: 'b-l', photographer: 'B' },
    ];
    vi.doMock('$lib/server/data.js', () => ({
      fetchImage: vi.fn().mockResolvedValue({ ...photos[0], photos }),
      isPexelsConfigured: vi.fn().mockReturnValue(true),
    }));
    const { GET } = await import('../src/routes/api/trip/[slug]/image/search/+server.js');
    const res = await GET({ params: { slug: 'demo' }, url: new URL('http://x/?q=mountains') });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.photos).toEqual(photos);
  });

  it('returns empty photos when Pexels finds nothing', async () => {
    vi.doMock('$lib/server/data.js', () => ({
      fetchImage: vi.fn().mockResolvedValue(null),
      isPexelsConfigured: vi.fn().mockReturnValue(true),
    }));
    const { GET } = await import('../src/routes/api/trip/[slug]/image/search/+server.js');
    const res = await GET({ params: { slug: 'demo' }, url: new URL('http://x/?q=zzzzzz') });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.photos).toEqual([]);
  });
});

describe('POST /api/trip/[slug]/image', () => {
  it('writes image_query when provided', async () => {
    const updateImageMeta = vi.fn().mockReturnValue({ ok: true });
    vi.doMock('$lib/server/data.js', () => ({ updateImageMeta }));
    const { POST } = await import('../src/routes/api/trip/[slug]/image/+server.js');
    const res = await POST({
      params: { slug: 'demo' },
      request: new Request('http://x', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ image_query: 'mountains' }),
      }),
    });
    expect(res.status).toBe(200);
    expect(updateImageMeta).toHaveBeenCalledWith('demo', { image_query: 'mountains' });
  });

  it('writes image_pick when provided', async () => {
    const updateImageMeta = vi.fn().mockReturnValue({ ok: true });
    vi.doMock('$lib/server/data.js', () => ({ updateImageMeta }));
    const { POST } = await import('../src/routes/api/trip/[slug]/image/+server.js');
    const res = await POST({
      params: { slug: 'demo' },
      request: new Request('http://x', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ image_pick: 2 }),
      }),
    });
    expect(res.status).toBe(200);
    expect(updateImageMeta).toHaveBeenCalledWith('demo', { image_pick: 2 });
  });

  it('returns 404 when the trip is not found', async () => {
    vi.doMock('$lib/server/data.js', () => ({
      updateImageMeta: vi.fn().mockReturnValue(null),
    }));
    const { POST } = await import('../src/routes/api/trip/[slug]/image/+server.js');
    const res = await POST({
      params: { slug: 'missing' },
      request: new Request('http://x', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ image_query: 'x' }),
      }),
    });
    expect(res.status).toBe(404);
  });

  it('returns 400 when updateImageMeta throws TypeError (invalid input)', async () => {
    vi.doMock('$lib/server/data.js', () => ({
      updateImageMeta: vi.fn(() => { throw new TypeError('image_pick must be an integer 0, 1, or 2'); }),
    }));
    const { POST } = await import('../src/routes/api/trip/[slug]/image/+server.js');
    const res = await POST({
      params: { slug: 'demo' },
      request: new Request('http://x', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ image_pick: 7 }),
      }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 500 image_save_failed on unexpected errors', async () => {
    vi.doMock('$lib/server/data.js', () => ({
      updateImageMeta: vi.fn(() => { throw new Error('disk full'); }),
    }));
    const { POST } = await import('../src/routes/api/trip/[slug]/image/+server.js');
    const res = await POST({
      params: { slug: 'demo' },
      request: new Request('http://x', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ image_query: 'x' }),
      }),
    });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe('image_save_failed');
  });
});

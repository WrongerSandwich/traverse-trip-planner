import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCancelJob = vi.hoisted(() => vi.fn());

vi.mock('$lib/server/jobs.js', () => ({
  cancelJob: mockCancelJob,
}));

const { POST } = await import('../src/routes/api/jobs/cancel/+server.js');

function makeRequest(body) {
  return {
    request: { json: async () => body },
  };
}

beforeEach(() => {
  mockCancelJob.mockReset();
});

describe('POST /api/jobs/cancel', () => {
  it('calls cancelJob with the supplied workflow + slug', async () => {
    const res = await POST(makeRequest({ workflow: 'brochure', slug: 'hannibal-twain' }));
    expect(mockCancelJob).toHaveBeenCalledWith('brochure', 'hannibal-twain');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });

  it('returns 400 when workflow is missing', async () => {
    const res = await POST(makeRequest({ slug: 'hannibal-twain' }));
    expect(mockCancelJob).not.toHaveBeenCalled();
    expect(res.status).toBe(400);
  });

  it('returns 400 when slug is missing', async () => {
    const res = await POST(makeRequest({ workflow: 'brochure' }));
    expect(mockCancelJob).not.toHaveBeenCalled();
    expect(res.status).toBe(400);
  });

  it('returns 400 on malformed (non-string) inputs', async () => {
    const res = await POST(makeRequest({ workflow: 42, slug: ['x'] }));
    expect(mockCancelJob).not.toHaveBeenCalled();
    expect(res.status).toBe(400);
  });

  it('is idempotent — cancelJob is a no-op for unknown jobs and we still 200', async () => {
    // The registry's cancelJob already silently no-ops for unknown jobs.
    // We don't introspect — we just trust it and return 200 so the client
    // can dismiss confidently.
    const res = await POST(makeRequest({ workflow: 'brochure', slug: 'never-started' }));
    expect(mockCancelJob).toHaveBeenCalledWith('brochure', 'never-started');
    expect(res.status).toBe(200);
  });
});

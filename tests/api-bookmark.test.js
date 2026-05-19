import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@sveltejs/kit', () => ({
  json: (body, init = {}) => ({ _body: body, _status: init.status ?? 200 }),
  error: (status, msg) => { throw Object.assign(new Error(msg), { status }); },
}));

const mockToggleStarred = vi.hoisted(() => vi.fn());

vi.mock('$lib/server/data.js', () => ({
  toggleStarred: mockToggleStarred,
  rejectInvalidSlug: () => null,
}));

import { POST } from '../src/routes/api/bookmark/[slug]/+server.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/bookmark/[slug]', () => {
  it('returns the toggled state on happy path', () => {
    mockToggleStarred.mockReturnValue({ slug: 'glacier-loop', starred: true });

    const res = POST({ params: { slug: 'glacier-loop' } });
    expect(res._status).toBe(200);
    expect(res._body).toEqual({ slug: 'glacier-loop', starred: true });
    expect(mockToggleStarred).toHaveBeenCalledWith('glacier-loop');
  });

  it('round-trips the starred:false case', () => {
    mockToggleStarred.mockReturnValue({ slug: 'ozarks', starred: false });

    const res = POST({ params: { slug: 'ozarks' } });
    expect(res._body.starred).toBe(false);
  });

  it('returns 404 when toggleStarred returns null (trip not found)', () => {
    mockToggleStarred.mockReturnValue(null);

    const res = POST({ params: { slug: 'missing-trip' } });
    expect(res.status).toBe(404);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@sveltejs/kit', () => ({
  json: (body, init = {}) => ({ _body: body, _status: init.status ?? 200 }),
  error: (status, msg) => { throw Object.assign(new Error(msg), { status }); },
}));

const { mockExistsSync, mockMkdirSync, mockRenameSync } = vi.hoisted(() => ({
  mockExistsSync: vi.fn(),
  mockMkdirSync: vi.fn(),
  mockRenameSync: vi.fn(),
}));

vi.mock('fs', () => ({
  existsSync: mockExistsSync,
  mkdirSync: mockMkdirSync,
  renameSync: mockRenameSync,
}));

const { mockFindArchivedTripLocation, mockInvalidateEnrichCache, mockRejectInvalidSlug } = vi.hoisted(() => ({
  mockFindArchivedTripLocation: vi.fn(),
  mockInvalidateEnrichCache: vi.fn(),
  mockRejectInvalidSlug: vi.fn(),
}));

vi.mock('$lib/server/data.js', () => ({
  ROOT: '/test-root',
  findArchivedTripLocation: mockFindArchivedTripLocation,
  invalidateEnrichCache: mockInvalidateEnrichCache,
  rejectInvalidSlug: mockRejectInvalidSlug,
}));

import { POST } from '../src/routes/api/unarchive/[slug]/+server.js';

beforeEach(() => {
  vi.clearAllMocks();
  mockExistsSync.mockReturnValue(false);
  mockInvalidateEnrichCache.mockReturnValue(undefined);
  mockRejectInvalidSlug.mockReturnValue(null); // valid slug by default
});

describe('POST /api/unarchive/[slug]', () => {
  it('unarchives a directory-style planning trip back to planning/', () => {
    mockFindArchivedTripLocation.mockReturnValue({
      slug: 'ozarks',
      stage: 'planning',
      kind: 'dir',
      path: '/test-root/archived/planning/ozarks',
    });

    const res = POST({ params: { slug: 'ozarks' } });
    expect(res._status).toBe(200);
    expect(res._body).toEqual({ ok: true, slug: 'ozarks', toStage: 'planning' });
    expect(mockMkdirSync).toHaveBeenCalledWith(
      '/test-root/planning',
      { recursive: true }
    );
    expect(mockRenameSync).toHaveBeenCalledWith(
      '/test-root/archived/planning/ozarks',
      '/test-root/planning/ozarks'
    );
    expect(mockInvalidateEnrichCache).toHaveBeenCalledOnce();
  });

  it('unarchives a file-style idea back to ideas/', () => {
    mockFindArchivedTripLocation.mockReturnValue({
      slug: 'parked-idea',
      stage: 'ideas',
      kind: 'file',
      path: '/test-root/archived/ideas/parked-idea.md',
    });

    const res = POST({ params: { slug: 'parked-idea' } });
    expect(res._body.toStage).toBe('ideas');
    expect(mockRenameSync).toHaveBeenCalledWith(
      '/test-root/archived/ideas/parked-idea.md',
      '/test-root/ideas/parked-idea.md'
    );
    expect(mockInvalidateEnrichCache).toHaveBeenCalledOnce();
  });

  it('unarchives a directory-style completed trip back to completed/', () => {
    mockFindArchivedTripLocation.mockReturnValue({
      slug: 'done-trip',
      stage: 'completed',
      kind: 'dir',
      path: '/test-root/archived/completed/done-trip',
    });

    const res = POST({ params: { slug: 'done-trip' } });
    expect(res._status).toBe(200);
    expect(res._body).toEqual({ ok: true, slug: 'done-trip', toStage: 'completed' });
    expect(mockRenameSync).toHaveBeenCalledWith(
      '/test-root/archived/completed/done-trip',
      '/test-root/completed/done-trip'
    );
  });

  it('returns 404 when the slug is not found in any archived/ stage', () => {
    mockFindArchivedTripLocation.mockReturnValue(null);

    const res = POST({ params: { slug: 'nope' } });
    expect(res.status).toBe(404);
    expect(mockRenameSync).not.toHaveBeenCalled();
    expect(mockInvalidateEnrichCache).not.toHaveBeenCalled();
  });

  it('returns 409 when the target slug already exists in the destination stage', () => {
    mockFindArchivedTripLocation.mockReturnValue({
      slug: 'dup',
      stage: 'planning',
      kind: 'dir',
      path: '/test-root/archived/planning/dup',
    });
    // Target exists at planning/dup
    mockExistsSync.mockReturnValue(true);

    const res = POST({ params: { slug: 'dup' } });
    expect(res.status).toBe(409);
    expect(mockRenameSync).not.toHaveBeenCalled();
    expect(mockInvalidateEnrichCache).not.toHaveBeenCalled();
  });

  it('returns 400 when the slug is invalid', () => {
    mockRejectInvalidSlug.mockReturnValue(new Response('Invalid slug', { status: 400 }));

    const res = POST({ params: { slug: '../../etc/passwd' } });
    expect(res.status).toBe(400);
    expect(mockFindArchivedTripLocation).not.toHaveBeenCalled();
    expect(mockRenameSync).not.toHaveBeenCalled();
  });

  it('returns 500 when renameSync throws', () => {
    mockFindArchivedTripLocation.mockReturnValue({
      slug: 'crash',
      stage: 'planning',
      kind: 'dir',
      path: '/test-root/archived/planning/crash',
    });
    mockRenameSync.mockImplementation(() => { throw new Error('EXDEV'); });

    const res = POST({ params: { slug: 'crash' } });
    expect(res.status).toBe(500);
    expect(mockInvalidateEnrichCache).not.toHaveBeenCalled();
  });

  it('never surfaces trips from archived/exploring/', () => {
    // findArchivedTripLocation must skip exploring stage — it should return null
    // for a slug that only exists in archived/exploring/
    mockFindArchivedTripLocation.mockReturnValue(null);

    const res = POST({ params: { slug: 'old-exploring-trip' } });
    expect(res.status).toBe(404);
    expect(mockRenameSync).not.toHaveBeenCalled();
  });
});

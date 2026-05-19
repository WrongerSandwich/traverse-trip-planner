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

const { mockFindTripLocation, mockInvalidateEnrichCache } = vi.hoisted(() => ({
  mockFindTripLocation: vi.fn(),
  mockInvalidateEnrichCache: vi.fn(),
}));

vi.mock('$lib/server/data.js', () => ({
  ROOT: '/test-root',
  findTripLocation: mockFindTripLocation,
  invalidateEnrichCache: mockInvalidateEnrichCache,
  rejectInvalidSlug: () => null,
}));

import { POST } from '../src/routes/api/archive/[slug]/+server.js';

beforeEach(() => {
  vi.clearAllMocks();
  mockExistsSync.mockReturnValue(false);
  mockInvalidateEnrichCache.mockReturnValue(undefined);
});

describe('POST /api/archive/[slug]', () => {
  it('archives a directory-style planning trip', () => {
    mockFindTripLocation.mockReturnValue({
      slug: 'ozarks',
      stage: 'planning',
      kind: 'dir',
      path: '/test-root/planning/ozarks',
    });

    const res = POST({ params: { slug: 'ozarks' } });
    expect(res._status).toBe(200);
    expect(res._body).toEqual({ ok: true, slug: 'ozarks', fromStage: 'planning' });
    expect(mockMkdirSync).toHaveBeenCalledWith(
      '/test-root/archived/planning',
      { recursive: true }
    );
    expect(mockRenameSync).toHaveBeenCalledWith(
      '/test-root/planning/ozarks',
      '/test-root/archived/planning/ozarks'
    );
    expect(mockInvalidateEnrichCache).toHaveBeenCalledOnce();
  });

  it('archives a file-style idea', () => {
    mockFindTripLocation.mockReturnValue({
      slug: 'parked-idea',
      stage: 'ideas',
      kind: 'file',
      path: '/test-root/ideas/parked-idea.md',
    });

    const res = POST({ params: { slug: 'parked-idea' } });
    expect(res._body.fromStage).toBe('ideas');
    expect(mockRenameSync).toHaveBeenCalledWith(
      '/test-root/ideas/parked-idea.md',
      '/test-root/archived/ideas/parked-idea.md'
    );
    expect(mockInvalidateEnrichCache).toHaveBeenCalledOnce();
  });

  it('returns 404 when the trip is not found', () => {
    mockFindTripLocation.mockReturnValue(null);

    const res = POST({ params: { slug: 'nope' } });
    expect(res.status).toBe(404);
    expect(mockRenameSync).not.toHaveBeenCalled();
    expect(mockInvalidateEnrichCache).not.toHaveBeenCalled();
  });

  it('returns 409 when the archive destination already exists', () => {
    mockFindTripLocation.mockReturnValue({
      slug: 'dup',
      stage: 'planning',
      kind: 'dir',
      path: '/test-root/planning/dup',
    });
    mockExistsSync.mockReturnValue(true);

    const res = POST({ params: { slug: 'dup' } });
    expect(res.status).toBe(409);
    expect(mockRenameSync).not.toHaveBeenCalled();
    expect(mockInvalidateEnrichCache).not.toHaveBeenCalled();
  });

  it('returns 500 when renameSync throws', () => {
    mockFindTripLocation.mockReturnValue({
      slug: 'crash',
      stage: 'planning',
      kind: 'dir',
      path: '/test-root/planning/crash',
    });
    mockRenameSync.mockImplementation(() => { throw new Error('EXDEV'); });

    const res = POST({ params: { slug: 'crash' } });
    expect(res.status).toBe(500);
    expect(mockInvalidateEnrichCache).not.toHaveBeenCalled();
  });
});

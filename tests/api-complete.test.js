import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@sveltejs/kit', () => ({
  json: (body, init = {}) => ({ _body: body, _status: init.status ?? 200 }),
  error: (status, msg) => { throw Object.assign(new Error(msg), { status }); },
}));

const { mockExistsSync, mockMkdirSync, mockRenameSync, mockReadFileSync, fsMock } = vi.hoisted(() => {
  const existsSync = vi.fn();
  const mkdirSync = vi.fn();
  const renameSync = vi.fn();
  const readFileSync = vi.fn();
  return {
    mockExistsSync: existsSync,
    mockMkdirSync: mkdirSync,
    mockRenameSync: renameSync,
    mockReadFileSync: readFileSync,
    fsMock: {
      existsSync,
      mkdirSync,
      renameSync,
      readFileSync,
      readdirSync: vi.fn(() => []),
      statSync: vi.fn(),
      writeFileSync: vi.fn(),
      unlinkSync: vi.fn(),
    },
  };
});

// Both 'fs' and 'node:fs' resolve to this — data.js uses 'fs', atomic-write.js uses 'node:fs'.
vi.mock('fs', () => fsMock);
vi.mock('node:fs', () => fsMock);

// Use the real moveTrip — POST goes through data.js, which is exactly where
// the bug was. No $lib/server/data.js mock.
import { POST } from '../src/routes/api/complete/[slug]/+server.js';

beforeEach(() => {
  vi.clearAllMocks();
  // Default: source dir exists, dest dir does not, overview.md absent (skip rewrite).
  mockExistsSync.mockImplementation((p) => p.includes('/planning/'));
  mockReadFileSync.mockReturnValue('---\nstatus: planning\ntitle: Test\n---\n\nbody');
});

describe('POST /api/complete/[slug]', () => {
  it('moves a planning trip to completed (regression for missing renameSync import)', () => {
    // Source exists in planning, dest doesn't exist in completed, overview.md exists.
    mockExistsSync.mockImplementation((p) => {
      if (p.endsWith('/planning/ozarks')) return true;
      if (p.endsWith('/completed/ozarks')) return false;
      if (p.endsWith('/overview.md')) return true;
      return false;
    });

    const res = POST({ params: { slug: 'ozarks' } });

    expect(res._status).toBe(200);
    expect(res._body).toEqual({ ok: true, slug: 'ozarks', stage: 'completed' });
    // First renameSync is the folder move (the bug site); a second call may
    // come from atomicWrite's tmp→canonical rename for the overview.md rewrite.
    expect(mockRenameSync.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(mockRenameSync.mock.calls[0][0]).toMatch(/\/planning\/ozarks$/);
    expect(mockRenameSync.mock.calls[0][1]).toMatch(/\/completed\/ozarks$/);
  });

  it('returns 404 when trip not in planning', () => {
    mockExistsSync.mockReturnValue(false);
    const res = POST({ params: { slug: 'nope' } });
    expect(res._status).toBe(404);
    expect(mockRenameSync).not.toHaveBeenCalled();
  });

  it('returns 409 when trip already in completed', () => {
    mockExistsSync.mockImplementation((p) => p.endsWith('/planning/dup') || p.endsWith('/completed/dup'));
    const res = POST({ params: { slug: 'dup' } });
    expect(res._status).toBe(409);
    expect(mockRenameSync).not.toHaveBeenCalled();
  });

  it('returns 400 when slug is invalid (rejectInvalidSlug returns real Response)', () => {
    const res = POST({ params: { slug: '../etc/passwd' } });
    expect(res.status).toBe(400);
    expect(mockRenameSync).not.toHaveBeenCalled();
  });
});

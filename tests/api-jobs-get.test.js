import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@sveltejs/kit', () => ({
  json: (body, init = {}) => ({ _body: body, _status: init.status ?? 200 }),
  error: (status, msg) => { throw Object.assign(new Error(msg), { status }); },
}));

const { mockListJobs, mockListRecentEvents } = vi.hoisted(() => ({
  mockListJobs: vi.fn(() => []),
  mockListRecentEvents: vi.fn(() => []),
}));

vi.mock('$lib/server/jobs.js', () => ({
  listJobs: mockListJobs,
  listRecentEvents: mockListRecentEvents,
}));

const { mockFindTripFile, mockParseFrontmatter } = vi.hoisted(() => ({
  mockFindTripFile: vi.fn(),
  mockParseFrontmatter: vi.fn(),
}));

vi.mock('$lib/server/data.js', () => ({
  DATA_DIR: '/test-root/data',
  findTripFile: mockFindTripFile,
  parseFrontmatter: mockParseFrontmatter,
}));

const mockReadFileSync = vi.hoisted(() => vi.fn());

vi.mock('node:fs', () => ({
  readFileSync: mockReadFileSync,
}));

import { GET } from '../src/routes/api/jobs/+server.js';

beforeEach(() => {
  vi.clearAllMocks();
  mockListJobs.mockReturnValue([]);
  mockListRecentEvents.mockReturnValue([]);
  mockFindTripFile.mockReturnValue(null);
});

describe('GET /api/jobs — happy path', () => {
  it('returns empty jobs and recent arrays when there is no activity', () => {
    const res = GET();
    expect(res._status).toBe(200);
    expect(res._body).toEqual({ jobs: [], recent: [] });
  });

  it('returns in-flight jobs enriched with trip titles', () => {
    mockListJobs.mockReturnValue([
      { workflow: 'deepen', slug: 'glacier-loop', startedAt: 1000 },
    ]);
    mockFindTripFile.mockReturnValue('/test/ideas/glacier-loop.md');
    mockReadFileSync.mockReturnValue('---\ntitle: Glacier Loop\n---\nbody');
    mockParseFrontmatter.mockReturnValue({ title: 'Glacier Loop' });

    const res = GET();
    expect(res._status).toBe(200);
    expect(res._body.jobs).toHaveLength(1);
    expect(res._body.jobs[0]).toMatchObject({
      workflow: 'deepen',
      slug: 'glacier-loop',
      title: 'Glacier Loop',
    });
  });

  it('returns recent events enriched with trip titles', () => {
    mockListRecentEvents.mockReturnValue([
      { workflow: 'brochure', slug: 'ozarks', kind: 'completed', at: 2000 },
    ]);
    mockFindTripFile.mockReturnValue('/test/planning/ozarks/overview.md');
    mockReadFileSync.mockReturnValue('---\ntitle: Ozarks Backroads\n---\nbody');
    mockParseFrontmatter.mockReturnValue({ title: 'Ozarks Backroads' });

    const res = GET();
    expect(res._body.recent).toHaveLength(1);
    expect(res._body.recent[0].title).toBe('Ozarks Backroads');
  });
});

describe('GET /api/jobs — downstream failures', () => {
  it('emits title: null when findTripFile returns null', () => {
    mockListJobs.mockReturnValue([
      { workflow: 'deepen', slug: 'unknown', startedAt: 1000 },
    ]);
    mockFindTripFile.mockReturnValue(null);

    const res = GET();
    expect(res._body.jobs[0].title).toBeNull();
    expect(mockReadFileSync).not.toHaveBeenCalled();
  });

  it('emits title: null when readFileSync throws (file vanished between findTripFile and read)', () => {
    mockListJobs.mockReturnValue([
      { workflow: 'deepen', slug: 'race-slug', startedAt: 1000 },
    ]);
    mockFindTripFile.mockReturnValue('/test/ideas/race-slug.md');
    mockReadFileSync.mockImplementation(() => { throw new Error('ENOENT'); });

    const res = GET();
    expect(res._body.jobs[0].title).toBeNull();
  });

  it('emits title: null when parseFrontmatter returns null (malformed frontmatter)', () => {
    mockListJobs.mockReturnValue([
      { workflow: 'deepen', slug: 'malformed', startedAt: 1000 },
    ]);
    mockFindTripFile.mockReturnValue('/test/ideas/malformed.md');
    mockReadFileSync.mockReturnValue('no frontmatter here');
    mockParseFrontmatter.mockReturnValue(null);

    const res = GET();
    expect(res._body.jobs[0].title).toBeNull();
  });
});

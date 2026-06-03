import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockExistsSync, mockReaddirSync, mockReadFileSync } = vi.hoisted(() => ({
  mockExistsSync: vi.fn(),
  mockReaddirSync: vi.fn(),
  mockReadFileSync: vi.fn(),
}));

vi.mock('fs', () => ({
  existsSync: mockExistsSync,
  readdirSync: mockReaddirSync,
  readFileSync: mockReadFileSync,
}));

const mockParseFrontmatter = vi.hoisted(() => vi.fn());

vi.mock('$lib/server/data.js', () => ({
  ROOT: '/test-root',
  DATA_DIR: '/test-root/data',
  parseFrontmatter: mockParseFrontmatter,
  rejectInvalidSlug: () => null,
}));

const mockTripsToIcs = vi.hoisted(() => vi.fn(() => 'BEGIN:VCALENDAR\nEND:VCALENDAR\n'));
const mockTripToIcs = vi.hoisted(() => vi.fn(() => 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n'));
const mockReadPlan = vi.hoisted(() => vi.fn());
const mockReadCandidates = vi.hoisted(() => vi.fn());

vi.mock('$lib/server/ics.js', () => ({
  tripsToIcs: mockTripsToIcs,
  tripToIcs: mockTripToIcs,
}));

vi.mock('$lib/server/plan.js', () => ({
  readPlan: mockReadPlan,
}));

vi.mock('$lib/server/candidates.js', () => ({
  readCandidates: mockReadCandidates,
}));

import { GET as listGET } from '../src/routes/api/cal.ics/+server.js';
import { GET as singleGET } from '../src/routes/api/cal/[slug].ics/+server.js';

function dirent(name, isDirectory = true) {
  return { name, isDirectory: () => isDirectory };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockExistsSync.mockReturnValue(false);
  mockReaddirSync.mockReturnValue([]);
  mockTripsToIcs.mockReturnValue('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n');
});

describe('GET /api/cal.ics — list', () => {
  it('returns text/calendar content type', () => {
    const res = listGET();
    expect(res.headers.get('Content-Type')).toBe('text/calendar; charset=utf-8');
    expect(res.headers.get('Cache-Control')).toBe('no-cache');
  });

  it('returns an empty calendar when no planning dir exists', async () => {
    mockExistsSync.mockReturnValue(false);
    const res = listGET();
    expect(mockTripsToIcs).toHaveBeenCalledWith([]);
    const body = await res.text();
    expect(body).toMatch(/VCALENDAR/);
  });

  it('aggregates planning trips with overview.md into ics', () => {
    mockExistsSync.mockImplementation((p) => p.includes('planning') || p.endsWith('overview.md'));
    mockReaddirSync.mockReturnValue([dirent('ozarks'), dirent('glacier-loop')]);
    mockReadFileSync.mockImplementation((p) => `---\ntitle: ${p}\n---\nbody`);
    mockParseFrontmatter.mockImplementation((c) => ({ title: c.split('title: ')[1].split('\n')[0] }));

    listGET();
    const tripsArg = mockTripsToIcs.mock.calls[0][0];
    expect(tripsArg).toHaveLength(2);
    expect(tripsArg.map((t) => t._slug).sort()).toEqual(['glacier-loop', 'ozarks']);
  });

  it('skips entries that are not directories or lack overview.md', () => {
    mockExistsSync.mockImplementation((p) => {
      if (p.endsWith('planning')) return true;
      // overview.md only exists for 'real-trip'
      return p.includes('real-trip') && p.endsWith('overview.md');
    });
    mockReaddirSync.mockReturnValue([
      dirent('real-trip', true),
      dirent('not-a-dir', false),
      dirent('no-overview', true),
    ]);
    mockReadFileSync.mockReturnValue('---\ntitle: Real Trip\n---\nbody');
    mockParseFrontmatter.mockReturnValue({ title: 'Real Trip' });

    listGET();
    const tripsArg = mockTripsToIcs.mock.calls[0][0];
    expect(tripsArg).toHaveLength(1);
    expect(tripsArg[0]._slug).toBe('real-trip');
  });

  it('skips overview.md files whose frontmatter does not parse', () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue([dirent('malformed')]);
    mockReadFileSync.mockReturnValue('no frontmatter');
    mockParseFrontmatter.mockReturnValue(null);

    listGET();
    expect(mockTripsToIcs).toHaveBeenCalledWith([]);
  });
});

describe('GET /api/cal/[slug].ics — single trip', () => {
  it('returns 404 when no overview.md found in planning or completed', () => {
    mockExistsSync.mockReturnValue(false);
    const res = singleGET({ params: { slug: 'missing' } });
    expect(res.status).toBe(404);
  });

  it('serves ics for a planning-stage trip with plan and candidates', async () => {
    mockExistsSync.mockImplementation((p) => p.includes('planning/found-trip/overview.md'));
    mockReadFileSync.mockReturnValue('---\ntitle: Found Trip\n---\nbody');
    mockParseFrontmatter.mockReturnValue({ title: 'Found Trip' });
    mockReadPlan.mockReturnValue({ days: [] });
    mockReadCandidates.mockReturnValue({ stops: [], lodging: [] });

    const res = singleGET({ params: { slug: 'found-trip' } });
    expect(res.headers.get('Content-Type')).toBe('text/calendar; charset=utf-8');
    expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="found-trip.ics"');
    expect(mockTripToIcs).toHaveBeenCalledWith(
      expect.objectContaining({ _slug: 'found-trip', title: 'Found Trip' }),
      { plan: { days: [] }, candidates: { stops: [], lodging: [] } }
    );
  });

  it('falls back to completed/ when planning/ has no overview', () => {
    mockExistsSync.mockImplementation((p) => p.includes('completed/done-trip/overview.md'));
    mockReadFileSync.mockReturnValue('---\ntitle: Done Trip\n---\nbody');
    mockParseFrontmatter.mockReturnValue({ title: 'Done Trip' });
    mockReadPlan.mockReturnValue({ days: [] });
    mockReadCandidates.mockReturnValue({ stops: [], lodging: [] });

    singleGET({ params: { slug: 'done-trip' } });
    expect(mockTripToIcs).toHaveBeenCalledWith(
      expect.objectContaining({ _slug: 'done-trip' }),
      { plan: { days: [] }, candidates: { stops: [], lodging: [] } }
    );
  });

  it('returns 404 when frontmatter does not parse', () => {
    mockExistsSync.mockImplementation((p) => p.includes('planning/found/overview.md'));
    mockReadFileSync.mockReturnValue('no frontmatter');
    mockParseFrontmatter.mockReturnValue(null);

    const res = singleGET({ params: { slug: 'found' } });
    expect(res.status).toBe(404);
  });

  it('returns 204 when tripToIcs returns falsy', () => {
    mockExistsSync.mockImplementation((p) => p.includes('planning/no-plan/overview.md'));
    mockReadFileSync.mockReturnValue('---\ntitle: No Plan\n---\nbody');
    mockParseFrontmatter.mockReturnValue({ title: 'No Plan' });
    mockReadPlan.mockReturnValue(null);
    mockReadCandidates.mockReturnValue(null);
    mockTripToIcs.mockReturnValue(null);

    const res = singleGET({ params: { slug: 'no-plan' } });
    expect(res.status).toBe(204);
  });
});

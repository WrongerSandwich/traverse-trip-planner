/**
 * Behavior contract for src/routes/+page.server.js when show_archived is toggled.
 *
 * - With show_archived=false (default), only active trips appear; no _archived field.
 * - With show_archived=true, both active and archived trips appear; archived ones
 *   carry _archived: true.
 * - archived/exploring/ trips NEVER appear regardless of toggle state.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@sveltejs/kit', () => ({
  redirect: (status, location) => {
    const err = Object.assign(new Error('Redirect'), { status, location });
    return err;
  },
}));

const mockEnrichTrips = vi.hoisted(() => vi.fn());
const mockGetHome = vi.hoisted(() => vi.fn());
const mockCollectArchivedTrips = vi.hoisted(() => vi.fn());

vi.mock('$lib/server/data.js', () => ({
  DATA_DIR: '/test-root/data',
  enrichTrips: mockEnrichTrips,
  getHome: mockGetHome,
  collectArchivedTrips: mockCollectArchivedTrips,
}));

let load;

beforeEach(async () => {
  vi.resetModules();
  mockEnrichTrips.mockReset();
  mockGetHome.mockReset();
  mockCollectArchivedTrips.mockReset();

  mockGetHome.mockReturnValue({ city: 'Test City', coords: [41.0, -93.0] });
  mockEnrichTrips.mockResolvedValue([{ _slug: 'active-trip', title: 'Active' }]);
  mockCollectArchivedTrips.mockReturnValue([
    { _slug: 'old-one', title: 'Old One', _stage: 'ideas', _archived: true },
  ]);

  ({ load } = await import('../src/routes/+page.server.js'));
});

describe('+page.server.js — show_archived toggle', () => {
  it('omits archived trips when show_archived is not set', async () => {
    const result = await load({ url: new URL('http://localhost/') });
    const slugs = result.trips.map(t => t._slug);
    expect(slugs).toContain('active-trip');
    expect(slugs).not.toContain('old-one');
    expect(result.trips.every(t => !t._archived)).toBe(true);
    expect(result.showArchived).toBe(false);
  });

  it('omits archived trips when show_archived=false', async () => {
    const result = await load({ url: new URL('http://localhost/?show_archived=false') });
    expect(result.trips.map(t => t._slug)).not.toContain('old-one');
    expect(result.showArchived).toBe(false);
  });

  it('includes archived trips tagged _archived: true when show_archived=true', async () => {
    const result = await load({ url: new URL('http://localhost/?show_archived=true') });
    const archived = result.trips.filter(t => t._archived);
    expect(archived).toHaveLength(1);
    expect(archived[0]._slug).toBe('old-one');
    expect(archived[0]._archived).toBe(true);
    expect(result.showArchived).toBe(true);
  });

  it('includes active trips alongside archived when show_archived=true', async () => {
    const result = await load({ url: new URL('http://localhost/?show_archived=true') });
    const slugs = result.trips.map(t => t._slug);
    expect(slugs).toContain('active-trip');
    expect(slugs).toContain('old-one');
  });

  it('exposes archivedCount even when toggle is off', async () => {
    const result = await load({ url: new URL('http://localhost/') });
    expect(result.archivedCount).toBe(1);
  });

  it('collectArchivedTrips is always called to compute archivedCount', async () => {
    await load({ url: new URL('http://localhost/') });
    expect(mockCollectArchivedTrips).toHaveBeenCalledOnce();
  });
});

/**
 * Behavior contract for src/routes/+page.server.js:
 *
 * On a fresh install (no home.md AND no trips) the index page redirects to
 * /onboarding rather than rendering the empty home page. With a home.md OR
 * any trip on disk, the load function returns data as usual.
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

// Helper to build a minimal event object matching SvelteKit's load() signature.
function makeEvent(path = '/') {
  return { url: new URL(`http://localhost${path}`) };
}

beforeEach(async () => {
  vi.resetModules();
  mockEnrichTrips.mockReset();
  mockGetHome.mockReset();
  mockCollectArchivedTrips.mockReset();
  mockCollectArchivedTrips.mockReturnValue([]); // no archived trips by default
  ({ load } = await import('../src/routes/+page.server.js'));
});

describe('index +page.server.js — fresh-install redirect', () => {
  it('redirects to /onboarding when no home and no trips', async () => {
    mockEnrichTrips.mockResolvedValue([]);
    mockGetHome.mockReturnValue(null);

    await expect(load(makeEvent())).rejects.toMatchObject({
      status: 303,
      location: '/onboarding',
    });
  });

  it('redirects when home.md is present but has no coords (incomplete onboarding)', async () => {
    mockEnrichTrips.mockResolvedValue([]);
    mockGetHome.mockReturnValue({ city: 'Somewhere', coords: null });

    await expect(load(makeEvent())).rejects.toMatchObject({
      status: 303,
      location: '/onboarding',
    });
  });

  it('does NOT redirect when at least one trip exists, even without a home', async () => {
    const trips = [{ slug: 't1', title: 'Trip 1' }];
    mockEnrichTrips.mockResolvedValue(trips);
    mockGetHome.mockReturnValue(null);

    const result = await load(makeEvent());
    expect(result.trips).toEqual(trips);
    expect(result.home).toBeNull();
    expect(result.showArchived).toBe(false);
    expect(result.archivedCount).toBe(0);
  });

  it('does NOT redirect when home is configured, even without trips', async () => {
    const home = { city: 'Des Moines', coords: [41.58, -93.62] };
    mockEnrichTrips.mockResolvedValue([]);
    mockGetHome.mockReturnValue(home);

    const result = await load(makeEvent());
    expect(result.trips).toEqual([]);
    expect(result.home).toEqual(home);
  });

  it('returns data normally when both home and trips are present', async () => {
    const trips = [{ slug: 't1' }];
    const home = { city: 'Des Moines', coords: [41.58, -93.62] };
    mockEnrichTrips.mockResolvedValue(trips);
    mockGetHome.mockReturnValue(home);

    const result = await load(makeEvent());
    expect(result.trips).toEqual(trips);
    expect(result.home).toEqual(home);
  });
});

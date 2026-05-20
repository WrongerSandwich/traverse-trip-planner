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

vi.mock('$lib/server/data.js', () => ({
  enrichTrips: mockEnrichTrips,
  getHome: mockGetHome,
}));

let load;

beforeEach(async () => {
  vi.resetModules();
  mockEnrichTrips.mockReset();
  mockGetHome.mockReset();
  ({ load } = await import('../src/routes/+page.server.js'));
});

describe('index +page.server.js — fresh-install redirect', () => {
  it('redirects to /onboarding when no home and no trips', async () => {
    mockEnrichTrips.mockResolvedValue([]);
    mockGetHome.mockReturnValue(null);

    await expect(load()).rejects.toMatchObject({
      status: 303,
      location: '/onboarding',
    });
  });

  it('redirects when home.md is present but has no coords (incomplete onboarding)', async () => {
    mockEnrichTrips.mockResolvedValue([]);
    mockGetHome.mockReturnValue({ city: 'Somewhere', coords: null });

    await expect(load()).rejects.toMatchObject({
      status: 303,
      location: '/onboarding',
    });
  });

  it('does NOT redirect when at least one trip exists, even without a home', async () => {
    const trips = [{ slug: 't1', title: 'Trip 1' }];
    mockEnrichTrips.mockResolvedValue(trips);
    mockGetHome.mockReturnValue(null);

    const result = await load();
    expect(result).toEqual({ trips, home: null });
  });

  it('does NOT redirect when home is configured, even without trips', async () => {
    const home = { city: 'Des Moines', coords: [41.58, -93.62] };
    mockEnrichTrips.mockResolvedValue([]);
    mockGetHome.mockReturnValue(home);

    const result = await load();
    expect(result).toEqual({ trips: [], home });
  });

  it('returns data normally when both home and trips are present', async () => {
    const trips = [{ slug: 't1' }];
    const home = { city: 'Des Moines', coords: [41.58, -93.62] };
    mockEnrichTrips.mockResolvedValue(trips);
    mockGetHome.mockReturnValue(home);

    const result = await load();
    expect(result).toEqual({ trips, home });
  });
});

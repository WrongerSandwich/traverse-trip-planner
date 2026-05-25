/**
 * Regression tests for #271 — SSR page-server loaders must validate the slug
 * before touching enrichTrips() or the filesystem.
 *
 * Each `load` function is imported and called with an invalid slug. We assert
 * that it throws a SvelteKit error(404) without ever reaching enrichTrips().
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- @sveltejs/kit mock ---
vi.mock('@sveltejs/kit', () => ({
  error: (status, msg) => {
    const err = Object.assign(new Error(msg ?? String(status)), { status });
    return err;
  },
}));

// --- data mock — enrichTrips must NOT be called for invalid slugs ---
const mockEnrichTrips = vi.hoisted(() => vi.fn());
const mockIsValidSlug = vi.hoisted(() => vi.fn());

vi.mock('$lib/server/data.js', () => ({
  DATA_DIR: '/test-root/data',
  enrichTrips: mockEnrichTrips,
  getHome: () => ({}),
  getTripFiles: vi.fn(() => null),
  isValidSlug: mockIsValidSlug,
  getTripRoute: vi.fn(() => null),
  geocode: vi.fn(async () => ({ coords: null, fromCache: false })),
  ROOT: '/test-root',
}));

// --- plan + candidates mocks ---
vi.mock('$lib/server/plan.js', () => ({
  readPlan: vi.fn(() => null),
  findDanglingCandidateIds: vi.fn(() => []),
}));
vi.mock('$lib/server/candidates.js', () => ({
  readCandidates: vi.fn(() => null),
}));

// --- stadia mock ---
vi.mock('$lib/server/stadia.js', () => ({
  stadiaTileMosaic: vi.fn(() => null),
}));

// --- projection util mock ---
vi.mock('$lib/utils/projection.js', () => ({
  chooseZoomForBbox: vi.fn(() => 12),
}));

// Slugs that must be rejected before any filesystem or enrichTrips() access.
const INVALID_SLUGS = [
  '../etc/passwd',
  '..%2F..%2Fetc%2Fpasswd',
  '/etc/passwd',
  'foo/bar',
  '',
  'Foo-Bar',
  '..',
  'trip/../other',
];

// Helper: call load and assert it throws a 404, catching both thrown errors and
// returned error objects (depending on SvelteKit's `error()` semantics).
async function assertThrows404(loadFn, slug) {
  // Configure isValidSlug to return false for this slug.
  mockIsValidSlug.mockReturnValue(false);
  let threw = false;
  try {
    await loadFn({ params: { slug }, depends: () => {} });
  } catch (err) {
    threw = true;
    expect(err.status).toBe(404);
  }
  expect(threw, `load() should throw for slug "${slug}"`).toBe(true);
  // enrichTrips() must not have been called.
  expect(mockEnrichTrips, `enrichTrips() must not be called for slug "${slug}"`).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── /trips/[slug] ─────────────────────────────────────────────────────────────

describe('trips/[slug]/+page.server.js — invalid slug → 404 before enrichTrips', () => {
  let load;
  beforeEach(async () => {
    ({ load } = await import('../src/routes/trips/[slug]/+page.server.js'));
  });

  for (const slug of INVALID_SLUGS) {
    it(`rejects slug "${slug}"`, async () => {
      await assertThrows404(load, slug);
    });
  }

  it('proceeds to enrichTrips for a valid slug (isValidSlug returns true)', async () => {
    mockIsValidSlug.mockReturnValue(true);
    mockEnrichTrips.mockResolvedValue([]);
    // No trip found → should throw 404 from the trip lookup, not slug check.
    // We just confirm enrichTrips was called.
    try { await load({ params: { slug: 'glacier-loop' }, depends: () => {} }); } catch { /* expected */ }
    expect(mockEnrichTrips).toHaveBeenCalled();
  });
});

// ── /trips/[slug]/brochure ────────────────────────────────────────────────────

describe('trips/[slug]/brochure/+page.server.js — invalid slug → 404 before enrichTrips', () => {
  let load;
  beforeEach(async () => {
    ({ load } = await import('../src/routes/trips/[slug]/brochure/+page.server.js'));
  });

  for (const slug of INVALID_SLUGS) {
    it(`rejects slug "${slug}"`, async () => {
      await assertThrows404(load, slug);
    });
  }

  it('proceeds to enrichTrips for a valid slug', async () => {
    mockIsValidSlug.mockReturnValue(true);
    mockEnrichTrips.mockResolvedValue([]);
    try { await load({ params: { slug: 'glacier-loop' } }); } catch { /* expected */ }
    expect(mockEnrichTrips).toHaveBeenCalled();
  });
});


/**
 * Tests for the planExtractionFailed flag in
 * src/routes/trips/[slug]/+page.server.js (#343).
 *
 * The loader detects the extract-only recovery state:
 *   - trip is planning-stage
 *   - planning/<slug>/overview.md exists
 *   - planning/<slug>/plan.md does NOT exist
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- @sveltejs/kit mock ---
vi.mock('@sveltejs/kit', () => ({
  error: (status, msg) => {
    const err = Object.assign(new Error(msg ?? String(status)), { status });
    return err;
  },
}));

// --- fs mock (existsSync) ---
const mockExistsSync = vi.hoisted(() => vi.fn());
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, existsSync: mockExistsSync };
});

// --- path mock (join — pass-through, just capture calls) ---
// We don't need to override join; the real join is fine for building paths.

// --- data mock ---
const mockEnrichTrips = vi.hoisted(() => vi.fn());
const mockIsValidSlug = vi.hoisted(() => vi.fn(() => true));
const mockGetTripFiles = vi.hoisted(() => vi.fn());

vi.mock('$lib/server/data.js', () => ({
  enrichTrips: mockEnrichTrips,
  getHome: () => ({}),
  getTripFiles: mockGetTripFiles,
  isValidSlug: mockIsValidSlug,
  ROOT: '/test-root',
}));

// --- plan + candidates mocks ---
const mockReadPlan = vi.hoisted(() => vi.fn(() => null));
vi.mock('$lib/server/plan.js', () => ({
  readPlan: mockReadPlan,
  findDanglingCandidateIds: vi.fn(() => []),
}));
vi.mock('$lib/server/candidates.js', () => ({
  readCandidates: vi.fn(() => null),
}));

// --- stadia + projection mocks (consumed by brochure loader, not this one, but
//     we guard against any transitive imports that might blow up) ---
vi.mock('$lib/server/stadia.js', () => ({
  stadiaStaticMapUrl: vi.fn(() => null),
}));
vi.mock('$lib/utils/projection.js', () => ({
  chooseZoomForBbox: vi.fn(() => 12),
}));

// ── helpers ──────────────────────────────────────────────────────────────────

function makePlanningTrip(slug = 'ozarks-backroads') {
  return { _slug: slug, _stage: 'planning', title: 'Test Trip' };
}

function setupPlanningFiles(slug, { hasOverview, hasPlan }) {
  // getTripFiles returns planning stage info so resolvedStage = 'planning'
  mockGetTripFiles.mockReturnValue({
    slug,
    stage: 'planning',
    files: hasOverview ? { overview: '# Test' } : {},
  });

  // existsSync is called by the loader for overview.md and plan.md
  mockExistsSync.mockImplementation((path) => {
    if (path.endsWith('overview.md')) return hasOverview;
    if (path.endsWith('plan.md')) return hasPlan;
    return false;
  });
}

// ── tests ────────────────────────────────────────────────────────────────────

describe('trips/[slug]/+page.server.js — planExtractionFailed flag', () => {
  let load;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockIsValidSlug.mockReturnValue(true);
    // Fresh import each time so module-level state is reset
    vi.resetModules();
    ({ load } = await import('../src/routes/trips/[slug]/+page.server.js'));
  });

  it('is true when planning + overview.md exists + plan.md missing', async () => {
    const slug = 'ozarks-backroads';
    mockEnrichTrips.mockResolvedValue([makePlanningTrip(slug)]);
    setupPlanningFiles(slug, { hasOverview: true, hasPlan: false });

    const result = await load({ params: { slug }, depends: () => {} });

    expect(result.planExtractionFailed).toBe(true);
  });

  it('is false when plan.md exists', async () => {
    const slug = 'ozarks-backroads';
    mockEnrichTrips.mockResolvedValue([makePlanningTrip(slug)]);
    setupPlanningFiles(slug, { hasOverview: true, hasPlan: true });
    mockReadPlan.mockReturnValue({ days: [], field_guide_notes: '', gotchas: '', cover_query: null });

    const result = await load({ params: { slug }, depends: () => {} });

    expect(result.planExtractionFailed).toBe(false);
  });

  it('is false when stage is completed', async () => {
    const slug = 'old-trip';
    mockEnrichTrips.mockResolvedValue([{ _slug: slug, _stage: 'completed', title: 'Old Trip' }]);
    mockGetTripFiles.mockReturnValue({
      slug,
      stage: 'completed',
      files: { overview: '# Done' },
    });
    // existsSync — overview exists, plan exists
    mockExistsSync.mockReturnValue(true);

    const result = await load({ params: { slug }, depends: () => {} });

    expect(result.planExtractionFailed).toBe(false);
  });

  it('is false when stage is idea', async () => {
    const slug = 'new-idea';
    mockEnrichTrips.mockResolvedValue([{ _slug: slug, _stage: 'ideas', title: 'New Idea' }]);
    mockGetTripFiles.mockReturnValue({
      slug,
      stage: 'ideas',
      files: {},
    });
    // existsSync is not called with planning paths for idea-stage trips;
    // the flag check guards on resolvedStage === 'planning'
    mockExistsSync.mockReturnValue(false);

    const result = await load({ params: { slug }, depends: () => {} });

    expect(result.planExtractionFailed).toBe(false);
  });
});

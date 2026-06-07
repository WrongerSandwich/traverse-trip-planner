import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── @sveltejs/kit mock (error helper) ─────────────────────────────────────────
const mockError = vi.hoisted(() => vi.fn((status, msg) => {
  const e = new Error(msg ?? String(status));
  e.status = status;
  return e;
}));

vi.mock('@sveltejs/kit', () => ({
  error: mockError,
}));

// ── node:fs mock ──────────────────────────────────────────────────────────────
vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

// ── $lib/server/data.js mock ──────────────────────────────────────────────────
const { mockEnrichTrips, mockGetHome, mockIsValidSlug } = vi.hoisted(() => ({
  mockEnrichTrips: vi.fn(),
  mockGetHome: vi.fn(),
  mockIsValidSlug: vi.fn(),
}));

vi.mock('$lib/server/data.js', () => ({
  enrichTrips: mockEnrichTrips,
  getHome: mockGetHome,
  isValidSlug: mockIsValidSlug,
}));

// ── $lib/server/derive-brochure.js mock ───────────────────────────────────────
const mockDeriveBrochure = vi.hoisted(() => vi.fn());

vi.mock('$lib/server/derive-brochure.js', () => ({
  deriveBrochure: mockDeriveBrochure,
}));

// ── Import AFTER mocks are set up ─────────────────────────────────────────────
import { load } from '../src/routes/trips/[slug]/today/+page.server.js';

// ── Test data ─────────────────────────────────────────────────────────────────
const FAKE_TRIP = {
  _slug: 'st-louis',
  title: 'St. Louis Getaway',
  destination: 'St. Louis, MO',
  status: 'planning',
};

function makeDays(dates = []) {
  return dates.map((date, i) => ({
    n: i + 1,
    date: date ?? null,
    stops: [],
    lodging: null,
    notes: '',
    drive_distance_mi: null,
  }));
}

function makeBrochure(days) {
  return {
    title: 'St. Louis Getaway',
    target_date: days[0]?.date ?? null,
    duration_days: days.length,
    field_guide_notes: ['Bring sunscreen'],
    gotchas: ['Parking is expensive downtown'],
    days,
    stops: [],
    lodging: [],
  };
}

function makeUrl(query = '') {
  return new URL(`http://localhost/trips/st-louis/today${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIsValidSlug.mockReturnValue(true);
  mockGetHome.mockReturnValue({ home: 'data' });
  mockEnrichTrips.mockResolvedValue([FAKE_TRIP]);
  mockDeriveBrochure.mockReturnValue(makeBrochure(makeDays(['2026-07-10', '2026-07-11', '2026-07-12'])));
});

// ── Invalid slug ──────────────────────────────────────────────────────────────
describe('load — invalid slug', () => {
  it('throws 404 when isValidSlug returns false', async () => {
    mockIsValidSlug.mockReturnValue(false);
    let thrown;
    try {
      await load({ params: { slug: '../bad' }, url: makeUrl() });
    } catch (e) {
      thrown = e;
    }
    expect(mockError).toHaveBeenCalledWith(404);
    expect(thrown).toBeDefined();
  });
});

// ── Trip not found ────────────────────────────────────────────────────────────
describe('load — trip not found', () => {
  it('throws 404 when trip is not in the list', async () => {
    mockEnrichTrips.mockResolvedValue([]);
    let thrown;
    try {
      await load({ params: { slug: 'st-louis' }, url: makeUrl() });
    } catch (e) {
      thrown = e;
    }
    expect(mockError).toHaveBeenCalledWith(404, expect.stringContaining('st-louis'));
    expect(thrown).toBeDefined();
  });
});

// ── Empty state when deriveBrochure returns null ───────────────────────────────
describe('load — no plan', () => {
  it('returns hasPlan: false (not a 404) when deriveBrochure returns null', async () => {
    mockDeriveBrochure.mockReturnValue(null);
    const result = await load({ params: { slug: 'st-louis' }, url: makeUrl() });
    expect(result.hasPlan).toBe(false);
    expect(result.trip).toBe(FAKE_TRIP);
  });

  it('returns hasPlan: false when deriveBrochure throws', async () => {
    mockDeriveBrochure.mockImplementation(() => { throw new Error('bad plan file'); });
    const result = await load({ params: { slug: 'st-louis' }, url: makeUrl() });
    expect(result.hasPlan).toBe(false);
  });
});

// ── Day selection — ?day param ─────────────────────────────────────────────────
describe('load — ?day param', () => {
  it('selects day 2 when ?day=2 is in the URL', async () => {
    const result = await load({ params: { slug: 'st-louis' }, url: makeUrl('?day=2') });
    expect(result.selectedDay).toBe(2);
    expect(result.day.n).toBe(2);
  });

  it('selects day 1 when ?day=1 is in the URL', async () => {
    const result = await load({ params: { slug: 'st-louis' }, url: makeUrl('?day=1') });
    expect(result.selectedDay).toBe(1);
    expect(result.day.n).toBe(1);
  });

  it('selects day 3 when ?day=3 is in the URL (last day)', async () => {
    const result = await load({ params: { slug: 'st-louis' }, url: makeUrl('?day=3') });
    expect(result.selectedDay).toBe(3);
    expect(result.day.n).toBe(3);
  });
});

// ── Day selection — fallback to resolveCurrentDay ─────────────────────────────
describe('load — resolveCurrentDay fallback', () => {
  it('falls back to resolveCurrentDay default when ?day is absent', async () => {
    // All days are dated in the past → resolveCurrentDay returns days.length
    const pastDays = makeDays(['2020-01-01', '2020-01-02', '2020-01-03']);
    mockDeriveBrochure.mockReturnValue(makeBrochure(pastDays));
    const result = await load({ params: { slug: 'st-louis' }, url: makeUrl() });
    // Today (2026-06-07) is after all dates → resolveCurrentDay gives days.length = 3
    expect(result.selectedDay).toBe(3);
  });

  it('falls back to resolveCurrentDay when ?day is non-numeric', async () => {
    const result = await load({ params: { slug: 'st-louis' }, url: makeUrl('?day=abc') });
    // abc is NaN, not an integer, so we fall back — dates are in future → day 1
    const futureDays = makeDays(['2030-07-10', '2030-07-11', '2030-07-12']);
    mockDeriveBrochure.mockReturnValue(makeBrochure(futureDays));
    const result2 = await load({ params: { slug: 'st-louis' }, url: makeUrl('?day=abc') });
    expect(result2.selectedDay).toBe(1);
  });

  it('falls back when ?day is out of range (0)', async () => {
    const result = await load({ params: { slug: 'st-louis' }, url: makeUrl('?day=0') });
    // 0 is < 1, so out of range → use resolveCurrentDay
    expect(typeof result.selectedDay).toBe('number');
    expect(result.selectedDay).toBeGreaterThanOrEqual(1);
    expect(result.selectedDay).toBeLessThanOrEqual(3);
  });

  it('falls back when ?day is out of range (exceeds dayCount)', async () => {
    const result = await load({ params: { slug: 'st-louis' }, url: makeUrl('?day=99') });
    expect(typeof result.selectedDay).toBe('number');
    expect(result.selectedDay).toBeGreaterThanOrEqual(1);
    expect(result.selectedDay).toBeLessThanOrEqual(3);
  });
});

// ── Return shape ──────────────────────────────────────────────────────────────
describe('load — return shape', () => {
  it('returns hasPlan: true with expected fields when plan exists', async () => {
    const result = await load({ params: { slug: 'st-louis' }, url: makeUrl('?day=1') });
    expect(result.hasPlan).toBe(true);
    expect(result.trip).toBe(FAKE_TRIP);
    expect(result.title).toBe('St. Louis Getaway');
    expect(result.destination).toBe('St. Louis, MO');
    expect(result.dayCount).toBe(3);
    expect(result.selectedDay).toBe(1);
    expect(result.day).toBeDefined();
    expect(result.day.n).toBe(1);
    expect(result.fieldGuideNotes).toEqual(['Bring sunscreen']);
    expect(result.gotchas).toEqual(['Parking is expensive downtown']);
  });

  it('returns dayPills carrying each day number and date for the picker', async () => {
    const result = await load({ params: { slug: 'st-louis' }, url: makeUrl('?day=1') });
    expect(result.dayPills).toEqual([
      { n: 1, date: '2026-07-10' },
      { n: 2, date: '2026-07-11' },
      { n: 3, date: '2026-07-12' },
    ]);
  });

  it('includes startsInDays when first day is in the future', async () => {
    // Use a far-future trip so it definitely starts in the future
    const futureDays = makeDays(['2099-01-10', '2099-01-11']);
    mockDeriveBrochure.mockReturnValue(makeBrochure(futureDays));
    const result = await load({ params: { slug: 'st-louis' }, url: makeUrl() });
    expect(result.startsInDays).toBeGreaterThan(0);
  });

  it('startsInDays is null/undefined when first day has no date', async () => {
    const undatedDays = makeDays([null, null]);
    mockDeriveBrochure.mockReturnValue(makeBrochure(undatedDays));
    const result = await load({ params: { slug: 'st-louis' }, url: makeUrl() });
    expect(result.startsInDays == null).toBe(true);
  });

  it('startsInDays is null/undefined when first day date is in the past', async () => {
    const pastDays = makeDays(['2020-01-01', '2020-01-02']);
    mockDeriveBrochure.mockReturnValue(makeBrochure(pastDays));
    const result = await load({ params: { slug: 'st-louis' }, url: makeUrl() });
    expect(result.startsInDays == null).toBe(true);
  });
});

import { describe, it, expect } from 'vitest';
import { resolveCurrentDay, navUrl, telHref } from '../src/lib/today.js';

// ---------------------------------------------------------------------------
// resolveCurrentDay
// ---------------------------------------------------------------------------

describe('resolveCurrentDay', () => {
  // Helper: build a day object with an optional date string.
  function day(date) {
    return { date: date ?? null };
  }

  it('returns the 1-based index of the day whose date matches today', () => {
    const days = [day('2026-07-10'), day('2026-07-11'), day('2026-07-12')];
    const today = new Date(2026, 6, 11); // July 11 local
    expect(resolveCurrentDay(days, today)).toBe(2);
  });

  it('returns 1 when today is before the first dated day', () => {
    const days = [day('2026-07-10'), day('2026-07-11'), day('2026-07-12')];
    const today = new Date(2026, 6, 5); // July 5 — before the trip
    expect(resolveCurrentDay(days, today)).toBe(1);
  });

  it('returns days.length when today is after the last dated day', () => {
    const days = [day('2026-07-10'), day('2026-07-11'), day('2026-07-12')];
    const today = new Date(2026, 6, 20); // July 20 — after the trip
    expect(resolveCurrentDay(days, today)).toBe(3);
  });

  it('returns 1 when no days have a date', () => {
    const days = [day(null), day(null), day(null)];
    const today = new Date(2026, 6, 11);
    expect(resolveCurrentDay(days, today)).toBe(1);
  });

  it('returns 1 for a single-day array when date matches', () => {
    const days = [day('2026-07-10')];
    const today = new Date(2026, 6, 10); // July 10 local
    expect(resolveCurrentDay(days, today)).toBe(1);
  });

  it('returns 1 for a single-day array when today is before', () => {
    const days = [day('2026-07-10')];
    const today = new Date(2026, 6, 1); // July 1 — before
    expect(resolveCurrentDay(days, today)).toBe(1);
  });

  it('returns 1 (days.length) for a single-day array when today is after', () => {
    const days = [day('2026-07-10')];
    const today = new Date(2026, 6, 20); // July 20 — after
    expect(resolveCurrentDay(days, today)).toBe(1);
  });

  it('matches the first day when today equals the first dated day', () => {
    const days = [day('2026-07-10'), day('2026-07-11')];
    const today = new Date(2026, 6, 10); // July 10 local
    expect(resolveCurrentDay(days, today)).toBe(1);
  });

  it('matches the last day when today equals the last dated day', () => {
    const days = [day('2026-07-10'), day('2026-07-11'), day('2026-07-12')];
    const today = new Date(2026, 6, 12); // July 12 local
    expect(resolveCurrentDay(days, today)).toBe(3);
  });

  it('handles mixed dated and undated days, matching the dated one', () => {
    // Days with gaps — only the middle day has a date.
    const days = [day(null), day('2026-07-11'), day(null)];
    const today = new Date(2026, 6, 11); // July 11 — matches day 2
    expect(resolveCurrentDay(days, today)).toBe(2);
  });

  it('zero-pads single-digit months and days when matching today', () => {
    const days = [day('2026-01-05'), day('2026-01-06')];
    const today = new Date(2026, 0, 5); // Jan 5 — exercises the 01/05 pad path
    expect(resolveCurrentDay(days, today)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// navUrl
// ---------------------------------------------------------------------------

describe('navUrl', () => {
  const BASE = 'https://www.google.com/maps/dir/?api=1&destination=';

  it('uses coords when present', () => {
    const stop = { coords: { lat: 38.627, lng: -90.198 }, name: 'Arch', address: '1 Main St' };
    expect(navUrl(stop)).toBe(`${BASE}38.627,-90.198`);
  });

  it('uses address (URL-encoded) when coords absent', () => {
    const stop = { address: '1 Main St, St. Louis, MO' };
    expect(navUrl(stop)).toBe(`${BASE}${encodeURIComponent('1 Main St, St. Louis, MO')}`);
  });

  it('falls back to "name, destination" (URL-encoded) when neither coords nor address', () => {
    const stop = { name: 'Gateway Arch' };
    const destination = 'St. Louis, MO';
    expect(navUrl(stop, destination)).toBe(`${BASE}${encodeURIComponent('Gateway Arch, St. Louis, MO')}`);
  });

  it('prefers coords over address', () => {
    const stop = { coords: { lat: 1, lng: 2 }, address: 'Should be ignored' };
    expect(navUrl(stop)).toBe(`${BASE}1,2`);
  });

  it('encodes special characters in address', () => {
    const stop = { address: 'Café & Bar, 42nd St' };
    expect(navUrl(stop)).toBe(`${BASE}${encodeURIComponent('Café & Bar, 42nd St')}`);
  });
});

// ---------------------------------------------------------------------------
// telHref
// ---------------------------------------------------------------------------

describe('telHref', () => {
  it('strips spaces, parens, and dashes from a formatted phone number', () => {
    expect(telHref('(314) 555-0182')).toBe('tel:3145550182');
  });

  it('passes through a digits-only string unchanged', () => {
    expect(telHref('3145550182')).toBe('tel:3145550182');
  });

  it('strips dots used as separators', () => {
    expect(telHref('314.555.0182')).toBe('tel:3145550182');
  });

  it('strips plus sign from international format, keeping digits', () => {
    expect(telHref('+1 (314) 555-0182')).toBe('tel:13145550182');
  });

  it('returns a bare tel: for an empty or whitespace-only phone', () => {
    expect(telHref('')).toBe('tel:');
    expect(telHref('   ')).toBe('tel:');
  });
});

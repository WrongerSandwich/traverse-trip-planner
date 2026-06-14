import { describe, it, expect } from 'vitest';
import { formatPlanDateRange } from '../src/lib/format-date.js';

describe('formatPlanDateRange', () => {
  it('returns empty string when no days have dates', () => {
    expect(formatPlanDateRange([])).toBe('');
    expect(formatPlanDateRange([{ date: null }, { date: '' }])).toBe('');
  });

  it('returns the single date when exactly one day has a date', () => {
    expect(formatPlanDateRange([{ date: '2026-06-20' }])).toBe('Jun 20');
  });

  it('returns a same-month range for two days in the same month', () => {
    expect(formatPlanDateRange([{ date: '2026-06-20' }, { date: '2026-06-21' }])).toBe('Jun 20–21');
  });

  it('returns a cross-month range when days span two months', () => {
    expect(formatPlanDateRange([{ date: '2026-06-30' }, { date: '2026-07-02' }])).toBe('Jun 30 – Jul 2');
  });

  it('uses earliest and latest set dates and ignores undated days in between', () => {
    // Day 1 has a date, day 2 does not, day 3 has a date → range is day 1 to day 3.
    expect(formatPlanDateRange([{ date: '2026-07-10' }, { date: null }, { date: '2026-07-12' }])).toBe('Jul 10–12');
  });

  it('handles null/undefined input gracefully', () => {
    expect(formatPlanDateRange(null)).toBe('');
    expect(formatPlanDateRange(undefined)).toBe('');
  });
});

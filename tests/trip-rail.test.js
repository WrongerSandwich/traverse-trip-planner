import { describe, it, expect } from 'vitest';
import { tripQuickStats, activeSection } from '../src/lib/utils/trip-rail.js';

describe('tripQuickStats', () => {
  it('builds present stat rows in order, dropping absent ones', () => {
    // drive: _drive_hours=4.5 → driveLabel → "4.5 hr"
    // nights: duration_days=3 → lodgingNights → 2
    // planDaysCount passed as second arg (not on trip object)
    const trip = { home_distance_mi: 312, _drive_hours: 4.5, duration_days: 3 };
    expect(tripQuickStats(trip, 2)).toEqual([
      { label: 'Distance', value: '312 mi' },
      { label: 'Drive', value: '4.5 hr' },
      { label: 'Nights', value: '2' },
      { label: 'Days planned', value: '2' },
    ]);
  });

  it('formats whole drive hours without a decimal', () => {
    const trip = { home_distance_mi: 200, _drive_hours: 4 };
    expect(tripQuickStats(trip)).toEqual([
      { label: 'Distance', value: '200 mi' },
      { label: 'Drive', value: '4 hr' },
    ]);
  });

  it('omits drive when _drive_hours is absent', () => {
    const trip = { home_distance_mi: 150 };
    expect(tripQuickStats(trip)).toEqual([{ label: 'Distance', value: '150 mi' }]);
  });

  it('omits nights when duration_days is absent or <= 1', () => {
    expect(tripQuickStats({ duration_days: 1 })).toEqual([]);
    expect(tripQuickStats({})).toEqual([]);
  });

  it('handles duration_days as array (first element wins)', () => {
    const trip = { duration_days: ['4'] };
    expect(tripQuickStats(trip)).toEqual([{ label: 'Nights', value: '3' }]);
  });

  it('omits days-planned when planDaysCount is 0 or null', () => {
    expect(tripQuickStats({}, 0)).toEqual([]);
    expect(tripQuickStats({}, null)).toEqual([]);
    expect(tripQuickStats({})).toEqual([]);
  });

  it('returns [] when nothing is known', () => {
    expect(tripQuickStats({})).toEqual([]);
  });

  it('rounds float home_distance_mi to the nearest integer', () => {
    expect(tripQuickStats({ home_distance_mi: 312.7 })).toEqual([
      { label: 'Distance', value: '313 mi' },
    ]);
  });
});

describe('activeSection', () => {
  const positions = [
    { id: 'overview', top: 0 },
    { id: 'route', top: 500 },
    { id: 'plan', top: 1200 },
    { id: 'candidates', top: 2000 },
  ];

  it('returns the last section whose top is at or above the scroll line', () => {
    expect(activeSection(positions, 0)).toBe('overview');
    expect(activeSection(positions, 600)).toBe('route');
    expect(activeSection(positions, 1300)).toBe('plan');
    expect(activeSection(positions, 9999)).toBe('candidates');
  });

  it('clamps to the first section when scrolled above the top', () => {
    expect(activeSection(positions, -50)).toBe('overview');
  });

  it('returns null for no sections', () => {
    expect(activeSection([], 100)).toBeNull();
  });

  it('a section at its exact top boundary is active (inclusive)', () => {
    expect(activeSection(positions, 500)).toBe('route');
    expect(activeSection(positions, 1200)).toBe('plan');
  });
});

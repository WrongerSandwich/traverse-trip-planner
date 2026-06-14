import { describe, it, expect } from 'vitest';
import { metaPills, driveLabel } from '../src/lib/utils/trip-meta.js';

describe('driveLabel', () => {
  it('formats whole hours without a decimal and half hours with one', () => {
    expect(driveLabel({ _drive_hours: 4 })).toBe('4 hr');
    expect(driveLabel({ _drive_hours: 4.5 })).toBe('4.5 hr');
  });
  it('returns null when drive hours are absent', () => {
    expect(driveLabel({})).toBe(null);
    expect(driveLabel({ _drive_hours: null })).toBe(null);
  });
});

describe('metaPills', () => {
  it('builds the pill row from present fields, dropping absent ones', () => {
    const trip = {
      destination: 'St. Louis, MO',
      _drive_hours: 4,
      home_distance_mi: 312,
      duration_days: 3,
      _cost: '$700–$1,400',
    };
    expect(metaPills(trip)).toEqual([
      { kind: 'destination', text: 'St. Louis, MO' },
      { kind: 'drive', text: '4 hr · 312 mi' },
      { kind: 'nights', text: '2 nights' },
      { kind: 'cost', text: '$700–$1,400' },
    ]);
  });
  it('combines fractional drive hours with distance', () => {
    const trip = { _drive_hours: 4.5, home_distance_mi: 287.7 };
    expect(metaPills(trip)).toEqual([
      { kind: 'drive', text: '4.5 hr · 288 mi' },
    ]);
  });
  it('shows distance alone (no drive hours) as a drive pill', () => {
    const trip = { destination: 'X', home_distance_mi: 150 };
    expect(metaPills(trip)).toEqual([
      { kind: 'destination', text: 'X' },
      { kind: 'drive', text: '150 mi' },
    ]);
  });
  it('omits distance pill when home_distance_mi is absent', () => {
    const trip = { _drive_hours: 4 };
    expect(metaPills(trip)).toEqual([
      { kind: 'drive', text: '4 hr' },
    ]);
  });
  it('omits nights when not derivable and singularizes one night', () => {
    expect(metaPills({ destination: 'X', duration_days: 2 }))
      .toEqual([{ kind: 'destination', text: 'X' }, { kind: 'nights', text: '1 night' }]);
    expect(metaPills({ destination: 'X' })).toEqual([{ kind: 'destination', text: 'X' }]);
  });
  it('handles duration_days given as an array (first element wins)', () => {
    expect(metaPills({ destination: 'X', duration_days: ['4'] }))
      .toEqual([{ kind: 'destination', text: 'X' }, { kind: 'nights', text: '3 nights' }]);
  });
  it('returns [] for an empty trip', () => {
    expect(metaPills({})).toEqual([]);
  });
});

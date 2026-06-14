import { describe, it, expect } from 'vitest';
import { driveConnectorLabel } from '../src/lib/utils/drive-connector.js';

describe('driveConnectorLabel', () => {
  it('formats distance alone', () => {
    expect(driveConnectorLabel({ mi: 2 })).toBe('↓ 2 mi');
  });
  it('appends duration when present', () => {
    expect(driveConnectorLabel({ mi: 5, min: 12 })).toBe('↓ 5 mi · 12 min');
  });
  it('rounds fractional miles to one decimal and drops trailing .0', () => {
    expect(driveConnectorLabel({ mi: 0.8 })).toBe('↓ 0.8 mi');
    expect(driveConnectorLabel({ mi: 9.0 })).toBe('↓ 9 mi');
  });
  it('returns null when there is no distance to show', () => {
    expect(driveConnectorLabel({})).toBeNull();
    expect(driveConnectorLabel({ mi: 0 })).toBeNull();
  });

  // Guard-logic boundary tests — protect against regressions on invalid inputs.
  it('returns null for negative distance', () => {
    expect(driveConnectorLabel({ mi: -1 })).toBeNull();
  });
  it('returns null for NaN distance', () => {
    expect(driveConnectorLabel({ mi: NaN })).toBeNull();
  });
  it('returns null for Infinity distance', () => {
    expect(driveConnectorLabel({ mi: Infinity })).toBeNull();
  });
  it('returns null when called with no arguments', () => {
    expect(driveConnectorLabel()).toBeNull();
  });
  it('rounds fractional minutes', () => {
    expect(driveConnectorLabel({ mi: 3, min: 7.6 })).toBe('↓ 3 mi · 8 min');
  });
});

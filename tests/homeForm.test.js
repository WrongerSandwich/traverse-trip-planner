import { describe, it, expect } from 'vitest';
import { travelersToString, stringToTravelers } from '../src/lib/utils/homeForm.js';

describe('travelersToString', () => {
  it('joins an array into a comma-separated string', () => {
    expect(travelersToString(['evan', 'erika'])).toBe('evan, erika');
  });

  it('returns empty string for an empty array', () => {
    expect(travelersToString([])).toBe('');
  });

  it('returns empty string for null/undefined', () => {
    expect(travelersToString(null)).toBe('');
    expect(travelersToString(undefined)).toBe('');
  });

  it('handles a single traveler', () => {
    expect(travelersToString(['evan'])).toBe('evan');
  });

  it('handles names with spaces', () => {
    expect(travelersToString(['Evan T', 'Erika M'])).toBe('Evan T, Erika M');
  });
});

describe('stringToTravelers', () => {
  it('splits a comma-separated string into an array', () => {
    expect(stringToTravelers('evan, erika')).toEqual(['evan', 'erika']);
  });

  it('trims whitespace from each entry', () => {
    expect(stringToTravelers('  evan ,  erika  ')).toEqual(['evan', 'erika']);
  });

  it('returns empty array for empty string', () => {
    expect(stringToTravelers('')).toEqual([]);
  });

  it('returns empty array for whitespace-only string', () => {
    expect(stringToTravelers('   ')).toEqual([]);
  });

  it('returns empty array for null/undefined', () => {
    expect(stringToTravelers(null)).toEqual([]);
    expect(stringToTravelers(undefined)).toEqual([]);
  });

  it('filters out empty tokens from trailing commas', () => {
    expect(stringToTravelers('evan, erika,')).toEqual(['evan', 'erika']);
  });

  it('handles a single name', () => {
    expect(stringToTravelers('evan')).toEqual(['evan']);
  });

  it('round-trips through travelersToString', () => {
    const original = ['alice', 'bob', 'carol'];
    expect(stringToTravelers(travelersToString(original))).toEqual(original);
  });
});

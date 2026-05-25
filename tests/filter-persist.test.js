import { describe, it, expect } from 'vitest';
import { serializeFilters, parseFilters, FILTER_STORAGE_KEY } from '$lib/utils/filterPersist.js';

const DEFAULTS = {
  activeFilter:  'all',
  activeSort:    'modified',
  activeDist:    'any',
  activeCost:    'any',
  activeNPS:     false,
  activeStarred: false,
};

describe('serializeFilters', () => {
  it('round-trips default state', () => {
    const raw = serializeFilters(DEFAULTS);
    expect(parseFilters(raw)).toEqual(DEFAULTS);
  });

  it('round-trips non-default state', () => {
    const state = {
      activeFilter:  'planning',
      activeSort:    'distance',
      activeDist:    'u3',
      activeCost:    'budget',
      activeNPS:     true,
      activeStarred: true,
    };
    expect(parseFilters(serializeFilters(state))).toEqual(state);
  });

  it('includes a schema version key', () => {
    const obj = JSON.parse(serializeFilters(DEFAULTS));
    expect(typeof obj.v).toBe('number');
  });
});

describe('parseFilters', () => {
  it('returns null for null input', () => {
    expect(parseFilters(null)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseFilters('')).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    expect(parseFilters('{not json')).toBeNull();
  });

  it('returns null for wrong schema version', () => {
    const obj = JSON.parse(serializeFilters(DEFAULTS));
    obj.v = 99;
    expect(parseFilters(JSON.stringify(obj))).toBeNull();
  });

  it('returns null when a required field is missing', () => {
    const obj = JSON.parse(serializeFilters(DEFAULTS));
    delete obj.activeFilter;
    expect(parseFilters(JSON.stringify(obj))).toBeNull();
  });

  it('returns null when activeFilter has an unknown value', () => {
    const obj = JSON.parse(serializeFilters(DEFAULTS));
    obj.activeFilter = 'bogus';
    expect(parseFilters(JSON.stringify(obj))).toBeNull();
  });

  it('returns null when activeDist has an unknown value', () => {
    const obj = JSON.parse(serializeFilters(DEFAULTS));
    obj.activeDist = 'u10';
    expect(parseFilters(JSON.stringify(obj))).toBeNull();
  });

  it('returns null when activeCost has an unknown value', () => {
    const obj = JSON.parse(serializeFilters(DEFAULTS));
    obj.activeCost = 'luxury';
    expect(parseFilters(JSON.stringify(obj))).toBeNull();
  });

  it('returns null when activeSort has an unknown value', () => {
    const obj = JSON.parse(serializeFilters(DEFAULTS));
    obj.activeSort = 'random';
    expect(parseFilters(JSON.stringify(obj))).toBeNull();
  });

  it('coerces activeNPS to boolean', () => {
    const obj = JSON.parse(serializeFilters(DEFAULTS));
    obj.activeNPS = 1; // truthy non-boolean
    const result = parseFilters(JSON.stringify(obj));
    expect(result?.activeNPS).toBe(true);
  });

  it('coerces activeStarred to boolean', () => {
    const obj = JSON.parse(serializeFilters(DEFAULTS));
    obj.activeStarred = 0;
    const result = parseFilters(JSON.stringify(obj));
    expect(result?.activeStarred).toBe(false);
  });

  it('exports the storage key constant', () => {
    expect(typeof FILTER_STORAGE_KEY).toBe('string');
    expect(FILTER_STORAGE_KEY.length).toBeGreaterThan(0);
  });
});

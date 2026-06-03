import { describe, it, expect } from 'vitest';
import { HAND_DEFAULTS, MAX_TOKENS } from '../src/lib/server/promises.js';
import { ERROR_REGISTRY } from '../src/lib/errors-registry.js';

describe('stop-prep constants', () => {
  it('MAX_TOKENS has a stop-prep budget', () => {
    expect(MAX_TOKENS['stop-prep']).toBeGreaterThan(0);
  });

  it('HAND_DEFAULTS has a shape-valid stop-prep promise', () => {
    const p = HAND_DEFAULTS['stop-prep'];
    expect(p).toBeTruthy();
    expect(typeof p.verb).toBe('string');
    expect(p.verb.trim()).not.toBe('');
    expect(typeof p.produces).toBe('string');
    expect(p.produces.trim()).not.toBe('');
    expect(Number.isFinite(p.time_seconds)).toBe(true);
    expect(p.time_seconds).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(p.tokens_range)).toBe(true);
    expect(p.tokens_range).toHaveLength(2);
    expect(p.tokens_range[0]).toBeGreaterThanOrEqual(0);
    expect(p.tokens_range[1]).toBeGreaterThanOrEqual(p.tokens_range[0]);
  });

  it('ERROR_REGISTRY has stop_prep_all_failed', () => {
    expect(ERROR_REGISTRY.stop_prep_all_failed).toBeTruthy();
    expect(typeof ERROR_REGISTRY.stop_prep_all_failed.sentence).toBe('string');
    expect(Array.isArray(ERROR_REGISTRY.stop_prep_all_failed.affordances)).toBe(true);
  });
});

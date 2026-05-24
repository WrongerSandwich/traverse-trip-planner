import { describe, it, expect } from 'vitest';
import { HAND_DEFAULTS, MAX_TOKENS } from '$lib/server/promises.js';

describe('promises for new candidate workflows', () => {
  it('declares add-candidate with verb, produces, time, and tokens range', () => {
    const p = HAND_DEFAULTS['add-candidate'];
    expect(p).toBeDefined();
    expect(p.verb).toMatch(/add/i);
    expect(p.produces).toMatch(/candidate/i);
    expect(typeof p.time_seconds).toBe('number');
    expect(Array.isArray(p.tokens_range)).toBe(true);
    expect(p.tokens_range).toHaveLength(2);
    expect(MAX_TOKENS['add-candidate']).toBeGreaterThan(0);
  });

  it('declares find-more with verb, produces, time, and tokens range', () => {
    const p = HAND_DEFAULTS['find-more'];
    expect(p).toBeDefined();
    expect(p.verb).toMatch(/find/i);
    expect(p.produces).toMatch(/candidate/i);
    expect(typeof p.time_seconds).toBe('number');
    expect(p.time_seconds).toBeGreaterThan(30);
    expect(MAX_TOKENS['find-more']).toBeGreaterThan(0);
  });
});

import { describe, it, expect } from 'vitest';
import { formatUsage } from '../src/lib/server/ai.js';

describe('formatUsage', () => {
  it('formats a normal single-turn call', () => {
    expect(formatUsage({ input: 1234, output: 567, total: 1801, turns: 1 }))
      .toBe('Used 1,234 in / 567 out · 1 turn');
  });

  it('pluralizes turns correctly', () => {
    expect(formatUsage({ input: 100, output: 50, total: 150, turns: 5 }))
      .toBe('Used 100 in / 50 out · 5 turns');
  });

  it('returns empty string for missing usage', () => {
    expect(formatUsage(null)).toBe('');
    expect(formatUsage(undefined)).toBe('');
  });

  it('defaults missing fields to 0 and 1 turn', () => {
    expect(formatUsage({})).toBe('Used 0 in / 0 out · 1 turn');
  });

  it('locale-formats large numbers', () => {
    const out = formatUsage({ input: 1234567, output: 89012, turns: 3 });
    expect(out).toContain('1,234,567');
    expect(out).toContain('89,012');
    expect(out).toContain('3 turns');
  });
});

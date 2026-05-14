import { describe, it, expect } from 'vitest';
import { formatTokens, usageToTokens } from '../src/lib/utils/formatTokens.js';

describe('formatTokens', () => {
  it('returns null for 0', () => {
    expect(formatTokens(0)).toBeNull();
  });

  it('returns null for negative values', () => {
    expect(formatTokens(-1)).toBeNull();
  });

  it('returns null for null', () => {
    expect(formatTokens(null)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(formatTokens(undefined)).toBeNull();
  });

  it('formats 999 as integer tokens (sub-thousand)', () => {
    expect(formatTokens(999)).toBe('999 tokens');
  });

  it('formats 1000 as "1k tokens" (exact thousand, no decimal)', () => {
    expect(formatTokens(1000)).toBe('1k tokens');
  });

  it('formats 1234 with one decimal place', () => {
    expect(formatTokens(1234)).toBe('1.2k tokens');
  });

  it('formats 12345 with one decimal place', () => {
    expect(formatTokens(12345)).toBe('12.3k tokens');
  });

  it('formats 123456 with one decimal place', () => {
    expect(formatTokens(123456)).toBe('123.5k tokens');
  });

  it('formats 1000000 (1M) as 1000k tokens', () => {
    expect(formatTokens(1_000_000)).toBe('1000k tokens');
  });
});

describe('usageToTokens', () => {
  it('sums input + output from normalized usage', () => {
    expect(usageToTokens({ input: 100, output: 200 })).toBe(300);
  });

  it('returns 0 for null usage', () => {
    expect(usageToTokens(null)).toBe(0);
  });

  it('returns 0 for undefined usage', () => {
    expect(usageToTokens(undefined)).toBe(0);
  });

  it('handles missing fields gracefully', () => {
    expect(usageToTokens({})).toBe(0);
    expect(usageToTokens({ input: 50 })).toBe(50);
    expect(usageToTokens({ output: 75 })).toBe(75);
  });
});

import { describe, it, expect } from 'vitest';
import { bookmarkRevertValue, normalizeStarred } from '../src/lib/utils/bookmarkToggle.js';

describe('normalizeStarred', () => {
  it('treats the YAML string "true" and boolean true as starred', () => {
    expect(normalizeStarred('true')).toBe(true);
    expect(normalizeStarred(true)).toBe(true);
  });
  it('treats everything else as not starred', () => {
    expect(normalizeStarred('false')).toBe(false);
    expect(normalizeStarred(false)).toBe(false);
    expect(normalizeStarred(undefined)).toBe(false);
    expect(normalizeStarred(null)).toBe(false);
  });
});

describe('bookmarkRevertValue', () => {
  it('reverts to the server-confirmed starred state, not a captured snapshot', () => {
    // Would have caught #493(b): the old code reverted to a `current` snapshot
    // captured before the optimistic flip. Under rapid double-toggle + failure
    // that snapshot is stale. Reverting to the confirmed value keeps the
    // override truthful regardless of intervening optimistic flips.
    expect(bookmarkRevertValue(true)).toBe(true);
    expect(bookmarkRevertValue(false)).toBe(false);
  });
  it('coerces truthy/falsy confirmed values to a boolean', () => {
    expect(bookmarkRevertValue('true')).toBe(true);
    expect(bookmarkRevertValue(undefined)).toBe(false);
  });
});

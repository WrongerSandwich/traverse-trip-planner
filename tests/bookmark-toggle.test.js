import { describe, it, expect } from 'vitest';
import { bookmarkRevertValue, normalizeStarred, confirmedStarredValue } from '../src/lib/utils/bookmarkToggle.js';

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

describe('confirmedStarredValue', () => {
  it('falls back to the page-load starred when the slug was never confirmed', () => {
    expect(confirmedStarredValue({}, 'a', 'true')).toBe(true);
    expect(confirmedStarredValue({}, 'a', false)).toBe(false);
    expect(confirmedStarredValue(undefined, 'a', true)).toBe(true);
  });

  it('prefers the last server-confirmed value over the stale page-load value', () => {
    // The residual half of #493(b), reproduced manually: page load says
    // starred=true, but a prior successful toggle confirmed it false on the
    // server. A later FAILED toggle must revert to false (server truth), not
    // the stale page-load true. Reverting to trip.starred alone got this wrong.
    expect(confirmedStarredValue({ a: false }, 'a', 'true')).toBe(false);
    expect(confirmedStarredValue({ a: true }, 'a', false)).toBe(true);
  });
});

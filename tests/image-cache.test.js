import { describe, it, expect } from 'vitest';
import {
  readImageCacheEntry,
  writeImageCacheEntry,
  IMAGE_CACHE_TTL_MS,
} from '../src/lib/server/data.js';

const NOW = 1_700_000_000_000; // arbitrary fixed timestamp

describe('readImageCacheEntry', () => {
  it('returns miss when the key is absent', () => {
    expect(readImageCacheEntry({}, 'q', NOW)).toEqual({ state: 'miss' });
  });

  it('returns a fresh new-style hit', () => {
    const cache = { q: { value: { medium: 'm' }, fetchedAt: NOW - 1000 } };
    expect(readImageCacheEntry(cache, 'q', NOW)).toEqual({ state: 'hit', value: { medium: 'm' } });
  });

  it('returns expired for new-style entries past the TTL', () => {
    const cache = { q: { value: { medium: 'm' }, fetchedAt: NOW - IMAGE_CACHE_TTL_MS - 1 } };
    expect(readImageCacheEntry(cache, 'q', NOW)).toEqual({ state: 'expired' });
  });

  it('returns hit for legacy bare object entries (no fetchedAt)', () => {
    const cache = { q: { medium: 'm', large: 'l' } };
    expect(readImageCacheEntry(cache, 'q', NOW)).toEqual({
      state: 'hit',
      value: { medium: 'm', large: 'l' },
    });
  });

  it('returns hit with null value for legacy null entries (cached misses never expire)', () => {
    const cache = { q: null };
    expect(readImageCacheEntry(cache, 'q', NOW)).toEqual({ state: 'hit', value: null });
  });

  it('returns hit for legacy entries even far in the past (no expiry)', () => {
    const cache = { q: { medium: 'm' } };
    const ancient = NOW - 365 * 24 * 60 * 60 * 1000 * 5;
    expect(readImageCacheEntry(cache, 'q', ancient).state).toBe('hit');
  });

  it('respects a custom ttlMs', () => {
    const cache = { q: { value: 'x', fetchedAt: NOW - 5000 } };
    expect(readImageCacheEntry(cache, 'q', NOW, 1000).state).toBe('expired');
    expect(readImageCacheEntry(cache, 'q', NOW, 10_000).state).toBe('hit');
  });
});

describe('writeImageCacheEntry', () => {
  it('wraps the value with fetchedAt', () => {
    const cache = {};
    writeImageCacheEntry(cache, 'q', { medium: 'm' }, NOW);
    expect(cache.q).toEqual({ value: { medium: 'm' }, fetchedAt: NOW });
  });

  it('stores null hits with a fetchedAt so they too expire', () => {
    const cache = {};
    writeImageCacheEntry(cache, 'q', null, NOW);
    expect(cache.q).toEqual({ value: null, fetchedAt: NOW });
    // And we can read it back cleanly
    expect(readImageCacheEntry(cache, 'q', NOW)).toEqual({ state: 'hit', value: null });
  });

  it('overwrites legacy bare entries on next write', () => {
    const cache = { q: { medium: 'old' } };
    writeImageCacheEntry(cache, 'q', { medium: 'new' }, NOW);
    expect(cache.q.fetchedAt).toBe(NOW);
    expect(cache.q.value).toEqual({ medium: 'new' });
  });
});

describe('TTL constant', () => {
  it('is 30 days', () => {
    expect(IMAGE_CACHE_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });
});

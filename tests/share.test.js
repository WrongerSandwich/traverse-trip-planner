import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeShareToken, verifyShareToken, shareEnabled } from '../src/lib/server/share.js';

describe('share token', () => {
  let originalSecret;

  beforeEach(() => {
    originalSecret = process.env.TRAVERSE_SHARE_SECRET;
    process.env.TRAVERSE_SHARE_SECRET = 'test-secret-please-change';
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.TRAVERSE_SHARE_SECRET;
    else process.env.TRAVERSE_SHARE_SECRET = originalSecret;
  });

  it('shareEnabled is true when secret is set', () => {
    expect(shareEnabled()).toBe(true);
  });

  it('makeShareToken returns null when secret is unset', () => {
    delete process.env.TRAVERSE_SHARE_SECRET;
    expect(makeShareToken('marfa-tx')).toBe(null);
  });

  it('round-trips a slug through token + verify', () => {
    const token = makeShareToken('marfa-tx');
    expect(token).toBeTruthy();
    expect(verifyShareToken(token)).toBe('marfa-tx');
  });

  it('produces deterministic tokens for the same slug + secret', () => {
    expect(makeShareToken('ozarks-backroads')).toBe(makeShareToken('ozarks-backroads'));
  });

  it('produces different tokens for different slugs', () => {
    expect(makeShareToken('a')).not.toBe(makeShareToken('b'));
  });

  it('rotates tokens when the secret changes', () => {
    const t1 = makeShareToken('marfa');
    process.env.TRAVERSE_SHARE_SECRET = 'different-secret';
    const t2 = makeShareToken('marfa');
    expect(t1).not.toBe(t2);
    expect(verifyShareToken(t1)).toBe(null); // old token no longer valid
    expect(verifyShareToken(t2)).toBe('marfa');
  });

  it('rejects tampered signatures', () => {
    const token = makeShareToken('marfa');
    // Flip a character in the signature portion (after the dot)
    const idx = token.lastIndexOf('.') + 1;
    const tampered = token.slice(0, idx) + (token[idx] === 'A' ? 'B' : 'A') + token.slice(idx + 1);
    expect(verifyShareToken(tampered)).toBe(null);
  });

  it('rejects tokens with the wrong shape', () => {
    expect(verifyShareToken('not-a-token')).toBe(null);
    expect(verifyShareToken('')).toBe(null);
    expect(verifyShareToken(null)).toBe(null);
    expect(verifyShareToken(undefined)).toBe(null);
    expect(verifyShareToken('only-one-segment.')).toBe(null);
    expect(verifyShareToken('.no-encoded-part')).toBe(null);
  });

  it('rejects tokens with invalid slug characters', () => {
    // Even if HMAC matched some weird payload, the slug shape check rejects it.
    const weirdSlug = 'a/b';
    const encoded = Buffer.from(weirdSlug).toString('base64url');
    const sig = makeShareToken('a').split('.')[1]; // any sig
    expect(verifyShareToken(`${encoded}.${sig}`)).toBe(null);
  });

  it('returns null from verifyShareToken when secret is unset', () => {
    const token = makeShareToken('marfa');
    delete process.env.TRAVERSE_SHARE_SECRET;
    expect(verifyShareToken(token)).toBe(null);
  });
});

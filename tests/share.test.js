import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeShareToken, verifyShareToken, shareEnabled, projectTripForShare } from '../src/lib/server/share.js';

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

describe('projectTripForShare (#274)', () => {
  const fullTrip = {
    // public-safe planning fields
    title: 'Ozarks Backroads',
    destination: 'Eureka Springs, AR',
    pitch: 'Three sentences.',
    vibe: 'quirky mountain town',
    image_query: 'Ozarks autumn',
    region: 'Midwest',
    duration_days: 3,
    target_date: '2026-10-15',
    best_seasons: ['fall'],
    avoid_months: ['jul', 'aug'],
    weekend_viable: true,
    tags: ['hiking', 'small-town'],
    waypoints: ['Springfield MO', 'Eureka Springs AR'],
    national_park: false,
    cost_tier: 'mid',
    status: 'planning',
    shared: true,
    // retro (completed-trip fields)
    rating: 4,
    would_repeat: true,
    date_completed: '2026-11-01',
    highlights: ['Bathhouse Row', 'Crystal Bridges'],
    // enrichment
    _slug: 'ozarks-backroads',
    _stage: 'planning',
    _coords: [36.4, -93.7],
    _image: { medium: 'https://...' },
    _has_route: true,
    _drive_hours: 6.2,
    // PRIVATE — must be stripped
    pet_sitter: 'Sarah next door, 555-1234',
    pet_sitter_needed: true,
    lodging: 'Crescent Hotel — booked confirmation #ABC123',
    reservations_needed: ['Crescent Hotel', 'Mount Magazine cabin'],
    cost_estimate_usd: 1450,
    home_distance_mi: 295,
    driving_hours: 5.4,
    ev_friendly: false,
    // arbitrary user-added field — also stripped
    private_notes: 'in-laws hate the south, don\'t mention',
  };

  it('keeps the allowlisted public fields', () => {
    const out = projectTripForShare(fullTrip);
    expect(out.title).toBe('Ozarks Backroads');
    expect(out.destination).toBe('Eureka Springs, AR');
    expect(out.vibe).toBe('quirky mountain town');
    expect(out.cost_tier).toBe('mid');
    expect(out.waypoints).toEqual(['Springfield MO', 'Eureka Springs AR']);
    expect(out._coords).toEqual([36.4, -93.7]);
    expect(out._has_route).toBe(true);
  });

  it('keeps retro fields (show-and-tell standard tier)', () => {
    const out = projectTripForShare(fullTrip);
    expect(out.rating).toBe(4);
    expect(out.would_repeat).toBe(true);
    expect(out.highlights).toEqual(['Bathhouse Row', 'Crystal Bridges']);
  });

  it('strips private planning fields', () => {
    const out = projectTripForShare(fullTrip);
    expect(out.pet_sitter).toBeUndefined();
    expect(out.pet_sitter_needed).toBeUndefined();
    expect(out.lodging).toBeUndefined();
    expect(out.reservations_needed).toBeUndefined();
    expect(out.cost_estimate_usd).toBeUndefined();
    expect(out.home_distance_mi).toBeUndefined();
    expect(out.driving_hours).toBeUndefined();
    expect(out.ev_friendly).toBeUndefined();
  });

  it('strips arbitrary user-added frontmatter', () => {
    const out = projectTripForShare(fullTrip);
    expect(out.private_notes).toBeUndefined();
  });

  it('handles null / non-object inputs', () => {
    expect(projectTripForShare(null)).toBe(null);
    expect(projectTripForShare(undefined)).toBe(undefined);
  });
});

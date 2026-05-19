import { createHmac, timingSafeEqual } from 'crypto';

const SIG_LEN = 16; // first 16 chars of base64url HMAC — ~96 bits, plenty for personal use

// Fields safe to include in the JSON payload shipped to /share/<token> and
// /share/<token>/brochure (#274). The full enriched trip object includes
// private planning fields (lodging, reservations_needed, pet_sitter,
// cost_estimate_usd, home_distance_mi, driving_hours) plus arbitrary
// user-added frontmatter that the share UI never renders. Anything not on
// this list stays on the server.
//
// Standard tier: planning context the recipient needs to understand the
// trip + retro impressions for show-and-tell sharing. Cost is tier-only,
// not dollars. Home-proximity fields stay private.
const SHARE_PUBLIC_FIELDS = [
  // Identity / display
  'title', 'destination', 'pitch', 'vibe', 'image_query', 'image_pick',
  // Planning context
  'region', 'duration_days', 'target_date',
  'best_seasons', 'avoid_months', 'weekend_viable',
  'tags', 'waypoints', 'national_park', 'cost_tier',
  // Retro (only present on completed trips)
  'rating', 'would_repeat', 'date_completed', 'highlights',
  // Status flags the renderer reads
  'status', 'shared',
  // Enrichment fields (synthetic, prefixed with `_`)
  '_slug', '_stage', '_coords', '_image', '_has_route', '_drive_hours',
];

/**
 * Project a fully-enriched trip object to the allowlisted public shape.
 * Use at every share-page server-load return so private frontmatter never
 * reaches the JSON payload shipped to the client.
 */
export function projectTripForShare(trip) {
  if (!trip || typeof trip !== 'object') return trip;
  const out = {};
  for (const k of SHARE_PUBLIC_FIELDS) {
    if (trip[k] !== undefined) out[k] = trip[k];
  }
  return out;
}

function getSecret() {
  return process.env.TRAVERSE_SHARE_SECRET || '';
}

export function shareEnabled() {
  return Boolean(getSecret());
}

/**
 * Produce a share token: base64url(slug) + "." + first 16 chars of HMAC.
 * Token is deterministic — same slug + secret always yields the same token.
 * Returns null if TRAVERSE_SHARE_SECRET is unset.
 */
export function makeShareToken(slug) {
  const secret = getSecret();
  if (!secret) return null;
  const hmac = createHmac('sha256', secret).update(slug).digest('base64url').slice(0, SIG_LEN);
  const encoded = Buffer.from(slug).toString('base64url');
  return `${encoded}.${hmac}`;
}

/**
 * Verify a share token. Returns the slug if valid, null otherwise.
 * Uses constant-time comparison on the HMAC portion to defeat timing attacks.
 */
export function verifyShareToken(token) {
  const secret = getSecret();
  if (!secret || typeof token !== 'string') return null;
  const dot = token.lastIndexOf('.');
  if (dot < 1) return null;
  const encoded = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (sig.length !== SIG_LEN) return null;

  let slug;
  try {
    slug = Buffer.from(encoded, 'base64url').toString();
  } catch {
    return null;
  }
  if (!slug || /[^a-z0-9-]/i.test(slug)) return null; // sanity: slug shape

  const expected = createHmac('sha256', secret).update(slug).digest('base64url').slice(0, SIG_LEN);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  return timingSafeEqual(a, b) ? slug : null;
}

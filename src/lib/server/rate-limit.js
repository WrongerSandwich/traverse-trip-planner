// In-process token-bucket rate limiter for AI-spending endpoints.
//
// Why: stable-release readiness implies "I can leave this running unattended."
// Without budget guards, one misconfigured share or one chatty client can
// produce a five-figure provider bill before anyone notices. This module is
// the cheap insurance — per-endpoint, per-IP token buckets that 429 a flood
// before it reaches `chat()`.
//
// Defaults are tuned for solo / household use: a small burst (capacity) and
// a slow refill (refillPerMinute). Override per-endpoint via env vars:
//   TRAVERSE_RATELIMIT_<ENDPOINT>_CAPACITY
//   TRAVERSE_RATELIMIT_<ENDPOINT>_REFILL_PER_MIN
// Where <ENDPOINT> is uppercased and dashes are replaced with underscores
// (e.g. TRAVERSE_RATELIMIT_DEEPEN_SECTION_CAPACITY).
//
// Buckets are keyed by `${endpoint}::${ip}` (or `${endpoint}::${ip}::${slug}`
// for trip-scoped endpoints). State is in-memory only — restarts reset all
// buckets, which is fine for the threat model (sustained abuse triggers
// limits within seconds anyway).
//
// Limitation: when running behind a reverse proxy (e.g. Caddy / nginx in front
// of the Docker container), `getClientAddress()` returns the proxy IP unless
// SvelteKit's address-handling config is updated. Document for users; the
// per-IP keying still degrades gracefully to a single shared bucket.

import { json } from '@sveltejs/kit';

// Per-endpoint defaults. Capacity = max immediate burst, refillPerMinute =
// sustained rate (tokens per minute). With capacity=5, refill=0.5/min, a user
// can fire 5 requests instantly then 1 every 2 minutes.
export const DEFAULT_LIMITS = {
  seed:             { capacity: 5,  refillPerMinute: 0.5 },
  add:              { capacity: 10, refillPerMinute: 1   },
  deepen:           { capacity: 3,  refillPerMinute: 0.25 },
  'deepen-section': { capacity: 5,  refillPerMinute: 0.5 },
  retro:            { capacity: 5,  refillPerMinute: 0.5 },
  receipts:         { capacity: 5,  refillPerMinute: 0.3 },
  chat:             { capacity: 30, refillPerMinute: 6   },
  // image-search burns Pexels API quota; per-IP (no slugKey) is the right
  // grain. capacity=10 allows a burst of manual image searches; refill=1/min
  // sustains up to 60/hour without overwhelming the free-tier quota.
  'image-search':   { capacity: 10, refillPerMinute: 1   },
  // geocode was falling back to the generic 10/min default, which is more
  // permissive than warranted for a Nominatim-backed endpoint (their ToS
  // asks for ≤1 req/s from a single IP). Keep capacity generous for the
  // legitimate re-geocode use-case but tighten the sustained rate.
  geocode:          { capacity: 10, refillPerMinute: 2   },
  // stadia-map proxies Stadia static-map requests so the key never reaches
  // the browser (#265). Per-IP. Generous capacity because the brochure
  // print page makes one request per visit and the image is browser-cached
  // for 24h, so legitimate users almost never re-hit. Tightish refill so a
  // misbehaving client can't drain the Stadia free-tier quota.
  'stadia-map':     { capacity: 30, refillPerMinute: 6   },
};

const buckets = new Map();

function envFor(endpoint) {
  const upper = endpoint.toUpperCase().replace(/-/g, '_');
  const cap = Number(process.env[`TRAVERSE_RATELIMIT_${upper}_CAPACITY`]);
  const refill = Number(process.env[`TRAVERSE_RATELIMIT_${upper}_REFILL_PER_MIN`]);
  const out = {};
  if (Number.isFinite(cap) && cap > 0) out.capacity = cap;
  if (Number.isFinite(refill) && refill > 0) out.refillPerMinute = refill;
  return out;
}

function getLimit(endpoint) {
  const base = DEFAULT_LIMITS[endpoint] ?? { capacity: 10, refillPerMinute: 1 };
  return { ...base, ...envFor(endpoint) };
}

/**
 * Consume one token from the bucket. Returns
 *   { ok: true, remaining }  — request allowed
 *   { ok: false, retryAfterSec } — denied; client should retry after N seconds.
 *
 * Exported for direct use in tests. Most callers want `rateLimitResponse()`.
 */
export function consume(endpoint, key, nowMs = Date.now()) {
  const limit = getLimit(endpoint);
  const id = `${endpoint}::${key}`;
  let b = buckets.get(id);
  if (!b) {
    b = { tokens: limit.capacity, lastRefillMs: nowMs };
    buckets.set(id, b);
  } else {
    const elapsedMin = (nowMs - b.lastRefillMs) / 60_000;
    b.tokens = Math.min(limit.capacity, b.tokens + elapsedMin * limit.refillPerMinute);
    b.lastRefillMs = nowMs;
  }
  if (b.tokens < 1) {
    const needed = 1 - b.tokens;
    const retryAfterSec = Math.max(1, Math.ceil((needed / limit.refillPerMinute) * 60));
    return { ok: false, retryAfterSec };
  }
  b.tokens -= 1;
  return { ok: true, remaining: Math.floor(b.tokens) };
}

/**
 * Return a 429 Response if the request should be denied, else null. Designed
 * to be called at the top of a handler:
 *
 *   const limited = rateLimitResponse({ event, endpoint: 'seed' });
 *   if (limited) return limited;
 *
 * `event` must expose `getClientAddress()` (SvelteKit's standard event). Pass
 * `slugKey` to add the trip slug to the bucket key — useful for trip-scoped
 * endpoints so a chatty share recipient can't burn budget across all trips.
 */
export function rateLimitResponse({ event, endpoint, slugKey }) {
  const ip = event?.getClientAddress?.() ?? 'unknown';
  const key = slugKey ? `${ip}::${slugKey}` : ip;
  const result = consume(endpoint, key);
  if (result.ok) return null;
  return json(
    {
      code: 'rate_limited',
      error: `Too many ${endpoint} requests. Try again in ${result.retryAfterSec}s.`,
      retryAfterSec: result.retryAfterSec,
    },
    { status: 429, headers: { 'Retry-After': String(result.retryAfterSec) } }
  );
}

// Test-only: clear all bucket state. Not exported to consumers.
export function _resetBucketsForTest() {
  buckets.clear();
}

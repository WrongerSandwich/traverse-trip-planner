import { json } from '@sveltejs/kit';
import { geocode, flushCaches } from '$lib/server/data.js';
import { rateLimitResponse } from '$lib/server/rate-limit.js';
import { TraverseError } from '$lib/server/errors.js';

/**
 * GET /api/geocode?q=<query>
 *
 * Wraps the existing Nominatim geocoder (disk-backed cache, rate-limited).
 * Returns { results: [{ label, lat, lon }] } — 0 or 1 entries depending on
 * whether the geocoder found a match.
 *
 * Returns 400 with { error, code: 'invalid_input' } for empty/missing q.
 * Returns 429 when the per-IP geocode bucket is exhausted.
 */
export async function GET(event) {
  const limited = rateLimitResponse({ event, endpoint: 'geocode' });
  if (limited) return limited;

  const { url } = event;
  const q = (url.searchParams.get('q') ?? '').trim();

  if (!q) {
    return json({ error: 'Query parameter "q" is required.', code: 'invalid_input' }, { status: 400 });
  }

  let coords = null;
  try {
    ({ coords } = await geocode(q));
  } catch (e) {
    // geocode() now re-throws geocode_quota (Nominatim 429) instead of
    // swallowing it (#488). Surface it as a 429 with the registry code so the
    // search box can show "rate-limited, try again" rather than 500-ing.
    if (e instanceof TraverseError && e.code === 'geocode_quota') {
      flushCaches();
      return json({ error: e.message, code: 'geocode_quota' }, { status: 429 });
    }
    throw e;
  }
  flushCaches();

  if (!coords) {
    return json({ results: [] });
  }

  const [lat, lon] = coords;
  return json({ results: [{ label: q, lat, lon }] });
}

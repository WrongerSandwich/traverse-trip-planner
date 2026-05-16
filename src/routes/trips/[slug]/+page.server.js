import { join } from 'path';
import { error } from '@sveltejs/kit';
import { enrichTrips, getHome, getTripFiles, isItineraryStale, isBrochureStale, ROOT } from '$lib/server/data.js';
import { makeShareToken } from '$lib/server/share.js';
import { readBrochure } from '$lib/server/brochure.js';

export async function load({ params }) {
  const { slug } = params;

  const [trips, home] = await Promise.all([enrichTrips(), Promise.resolve(getHome())]);
  const trip = trips.find(t => t._slug === slug);
  if (!trip) throw error(404, `Trip "${slug}" not found`);

  // If sharing is enabled and the trip is opted in, compute the public share URL
  // for the UI to display. Token is deterministic from slug + TRAVERSE_SHARE_SECRET.
  if (trip.shared === 'true') {
    const token = makeShareToken(slug);
    if (token) trip._shareUrl = `/share/${token}`;
  }

  const files = getTripFiles(slug);
  const resolvedStage = files?.stage || trip._stage;

  // Compute staleness for planning/completed trips that have generated artifacts.
  let itineraryStale = false;
  let brochureStale = false;
  if (resolvedStage === 'planning' || resolvedStage === 'completed') {
    const tripDir = join(ROOT, resolvedStage, slug);
    itineraryStale = isItineraryStale(tripDir);
    brochureStale = isBrochureStale(tripDir);
  }

  // Load brochure structured data so the detail page can render brochure.days
  // in the itinerary slot when available. Returns null when brochure.md is
  // absent or the YAML is invalid — the legacy itinerary.md fallback handles
  // both cases gracefully.
  let brochureData = null;
  try {
    const parsed = readBrochure(slug);
    brochureData = parsed?.data ?? null;
  } catch {
    // Malformed brochure.md — fall through to itinerary.md legacy rendering.
  }

  return { trip, home, files: files?.files || {}, stage: resolvedStage, itineraryStale, brochureStale, brochureData };
}

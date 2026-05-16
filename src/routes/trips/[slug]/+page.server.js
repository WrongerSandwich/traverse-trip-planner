import { join } from 'path';
import { error } from '@sveltejs/kit';
import { enrichTrips, getHome, getTripFiles, isItineraryStale, isBrochureStale, ROOT } from '$lib/server/data.js';
import { makeShareToken } from '$lib/server/share.js';

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

  return { trip, home, files: files?.files || {}, stage: resolvedStage, itineraryStale, brochureStale };
}

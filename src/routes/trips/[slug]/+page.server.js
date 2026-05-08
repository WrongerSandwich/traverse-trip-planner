import { error } from '@sveltejs/kit';
import { enrichTrips, getHome, getTripFiles } from '$lib/server/data.js';
import { makeShareToken } from '$lib/server/share.js';

export async function load({ params }) {
  const { slug } = params;

  const [trips, home] = await Promise.all([enrichTrips(), Promise.resolve(getHome())]);
  const trip = trips.find(t => t._slug === slug);
  if (!trip) throw error(404, `Trip "${slug}" not found`);

  // If sharing is enabled and the trip is opted in, compute the public share URL
  // for the UI to display. Token is deterministic from slug + ATLAS_SHARE_SECRET.
  if (trip.shared === 'true') {
    const token = makeShareToken(slug);
    if (token) trip._shareUrl = `/share/${token}`;
  }

  const files = getTripFiles(slug);

  return { trip, home, files: files?.files || {}, stage: files?.stage || trip._stage };
}

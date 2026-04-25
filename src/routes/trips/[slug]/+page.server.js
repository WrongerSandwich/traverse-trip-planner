import { error } from '@sveltejs/kit';
import { enrichTrips, getHome, getTripFiles } from '$lib/server/data.js';

export async function load({ params }) {
  const { slug } = params;

  const [trips, home] = await Promise.all([enrichTrips(), Promise.resolve(getHome())]);
  const trip = trips.find(t => t._slug === slug);
  if (!trip) throw error(404, `Trip "${slug}" not found`);

  const files = getTripFiles(slug);

  return { trip, home, files: files?.files || {}, stage: files?.stage || trip._stage };
}

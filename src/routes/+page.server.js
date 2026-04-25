import { enrichTrips, getHome } from '$lib/server/data.js';

export async function load() {
  const [trips, home] = await Promise.all([enrichTrips(), Promise.resolve(getHome())]);
  return { trips, home };
}

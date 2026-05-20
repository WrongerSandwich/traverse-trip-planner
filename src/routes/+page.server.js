import { redirect } from '@sveltejs/kit';
import { enrichTrips, getHome } from '$lib/server/data.js';

export async function load() {
  const [trips, home] = await Promise.all([enrichTrips(), Promise.resolve(getHome())]);
  // Fresh install: no home.md configured and no trips on disk → bounce to
  // the onboarding wizard. With nothing to show, the empty home page is a
  // dead end and the "Set up home base" CTA buries the intended next step.
  if (trips.length === 0 && (!home || !home.coords)) {
    throw redirect(303, '/onboarding');
  }
  return { trips, home };
}

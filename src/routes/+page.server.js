import { redirect } from '@sveltejs/kit';
import { enrichTrips, getHome, collectArchivedTrips } from '$lib/server/data.js';

export async function load({ url }) {
  const showArchived = url.searchParams.get('show_archived') === 'true';
  const [trips, home] = await Promise.all([enrichTrips(), Promise.resolve(getHome())]);
  // Fresh install: no home.md configured and no trips on disk → bounce to
  // the onboarding wizard. With nothing to show, the empty home page is a
  // dead end and the "Set up home base" CTA buries the intended next step.
  if (trips.length === 0 && (!home || !home.coords)) {
    throw redirect(303, '/onboarding');
  }

  // Always scan archived dirs to compute the count (drives the filter toggle label).
  // When the toggle is on, merge archived trips into the returned list so the home
  // page can render them inline with the muted treatment.
  const archivedTrips = collectArchivedTrips();
  const archivedCount = archivedTrips.length;

  const allTrips = showArchived ? [...trips, ...archivedTrips] : trips;

  return { trips: allTrips, home, showArchived, archivedCount };
}

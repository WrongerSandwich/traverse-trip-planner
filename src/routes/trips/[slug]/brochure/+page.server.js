import { error } from '@sveltejs/kit';
import { enrichTrips, getHome, getTripFiles, getTripRoute, geocode } from '$lib/server/data.js';
import { readBrochure } from '$lib/server/brochure.js';

export async function load({ params }) {
  const { slug } = params;

  const [trips, home] = await Promise.all([enrichTrips(), Promise.resolve(getHome())]);
  const trip = trips.find(t => t._slug === slug);
  if (!trip) throw error(404, `Trip "${slug}" not found`);

  const files = getTripFiles(slug);

  // Pre-load the route polyline + waypoint coords on the server so the inline
  // SVG paper-map renders without a client fetch — important for print, where
  // there's no chance to populate it after layout. The geocode cache is
  // already warm from enrichTrips() above, so these lookups are free.
  let route = null;
  let waypointCoords = [];
  if (trip._has_route && trip.waypoints) {
    try {
      route = await getTripRoute(slug);
      const wps = Array.isArray(trip.waypoints) ? trip.waypoints : [trip.waypoints];
      for (const wp of wps) {
        const coord = await geocode(wp);
        if (coord) waypointCoords.push({ label: wp, coord });
      }
    } catch { /* missing route → skip the map page */ }
  }

  // brochure.md if the user has run Prepare brochure. When present, the
  // brochure component renders against this structured data instead of
  // the raw planning markdown.
  let brochureData = null;
  try {
    const b = readBrochure(slug);
    if (b) brochureData = b.data;
  } catch (err) {
    console.warn(`brochure.md present but unreadable for ${slug}:`, err.message);
  }

  return {
    trip,
    home,
    files: files?.files || {},
    stage: files?.stage || trip._stage,
    route,
    waypointCoords,
    brochureData,
  };
}

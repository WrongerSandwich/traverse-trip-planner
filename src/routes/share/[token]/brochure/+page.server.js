import { error } from '@sveltejs/kit';
import { enrichTrips, getTripFiles, getTripRoute, geocode } from '$lib/server/data.js';
import { verifyShareToken, shareEnabled } from '$lib/server/share.js';
import { readBrochure } from '$lib/server/brochure.js';

export async function load({ params }) {
  if (!shareEnabled()) throw error(404, 'Sharing not configured');

  const slug = verifyShareToken(params.token);
  if (!slug) throw error(404, 'Invalid share link');

  const trips = await enrichTrips();
  const trip = trips.find(t => t._slug === slug);
  if (!trip) throw error(404, 'Trip not found');
  if (trip.shared !== 'true') throw error(404, 'Trip not shared');

  const files = getTripFiles(slug);

  // Pre-load route polyline + waypoint coords so the paper-map renders SSR
  // — identical to the /trips/[slug]/brochure load.
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

  let brochureData = null;
  try {
    const b = readBrochure(slug);
    if (b) brochureData = b.data;
  } catch (err) {
    console.warn(`brochure.md present but unreadable for ${slug}:`, err.message);
  }

  return {
    trip,
    files: files?.files || {},
    stage: files?.stage || trip._stage,
    route,
    waypointCoords,
    brochureData,
  };
}

import { error } from '@sveltejs/kit';
import { enrichTrips, getTripFiles, getTripRoute, geocode } from '$lib/server/data.js';
import { verifyShareToken, shareEnabled, projectTripForShare } from '$lib/server/share.js';
import { readBrochure } from '$lib/server/brochure.js';
import { stadiaStaticMapUrl } from '$lib/server/stadia.js';
import { chooseZoomForBbox } from '$lib/utils/projection.js';

function buildDestinationBaseMap(brochureData) {
  if (!brochureData?.stops) return null;
  const located = brochureData.stops.filter(
    s => Array.isArray(s.coords) && s.coords.length === 2,
  );
  if (located.length === 0) return null;

  const anchors = located.filter(s => s.must_see);
  const anchorSet = anchors.length > 0 ? anchors : located;
  const centerLat = anchorSet.reduce((s, p) => s + p.coords[0], 0) / anchorSet.length;
  const centerLon = anchorSet.reduce((s, p) => s + p.coords[1], 0) / anchorSet.length;

  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  for (const { coords: [lat, lon] } of anchorSet) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
  }
  if (minLat === maxLat) { minLat -= 0.01; maxLat += 0.01; }
  if (minLon === maxLon) { minLon -= 0.01; maxLon += 0.01; }

  const fitZoom = chooseZoomForBbox({
    bbox: { minLat, maxLat, minLon, maxLon },
    viewBoxW: 720,
    viewBoxH: 480,
    padding: 0.12,
  });
  const zoom = Math.max(11, Math.min(14, fitZoom));
  const url = stadiaStaticMapUrl({
    centerLat, centerLon, zoom, width: 720, height: 480, style: 'outdoors',
  });
  return url ? { url, centerLat, centerLon, zoom } : null;
}

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

  const destinationBaseMap = buildDestinationBaseMap(brochureData);

  return {
    trip: projectTripForShare(trip),
    files: files?.files || {},
    stage: files?.stage || trip._stage,
    route,
    waypointCoords,
    brochureData,
    destinationBaseMap,
  };
}

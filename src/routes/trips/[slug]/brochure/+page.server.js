import { error } from '@sveltejs/kit';
import { enrichTrips, getHome, getTripFiles, getTripRoute, geocode } from '$lib/server/data.js';
import { readBrochure } from '$lib/server/brochure.js';
import { stadiaStaticMapUrl } from '$lib/server/stadia.js';
import { chooseZoomForBbox } from '$lib/utils/projection.js';

// Compute a Stadia static-map URL for the destination map.
// Returns null when there are no geocoded stops or STADIA_API_KEY is unset
// (the DestinationMap component then falls back to its illustrative
// paper render).
function buildDestinationBaseMap(brochureData) {
  if (!brochureData?.stops) return null;
  const located = brochureData.stops.filter(
    s => Array.isArray(s.coords) && s.coords.length === 2,
  );
  if (located.length === 0) return null;

  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  for (const { coords: [lat, lon] } of located) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
  }

  // Synthesize a usable span when all stops happen to share coords.
  if (minLat === maxLat) { minLat -= 0.01; maxLat += 0.01; }
  if (minLon === maxLon) { minLon -= 0.01; maxLon += 0.01; }

  // Map view targets 720×480 viewBox at @2x retina. chooseZoomForBbox gives
  // the largest integer zoom that fits — cap at 13 so single-town clusters
  // don't render at building-block scale; floor at 9 so wide-spread trips
  // still show street structure.
  const fitZoom = chooseZoomForBbox({
    bbox: { minLat, maxLat, minLon, maxLon },
    viewBoxW: 720,
    viewBoxH: 480,
    padding: 0.12,
  });
  const zoom = Math.max(9, Math.min(13, fitZoom));

  const centerLat = (minLat + maxLat) / 2;
  const centerLon = (minLon + maxLon) / 2;

  const url = stadiaStaticMapUrl({
    centerLat,
    centerLon,
    zoom,
    width: 720,
    height: 480,
    style: 'outdoors',
  });
  if (!url) return null;

  return { url, centerLat, centerLon, zoom };
}

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

  const destinationBaseMap = buildDestinationBaseMap(brochureData);

  return {
    trip,
    home,
    files: files?.files || {},
    stage: files?.stage || trip._stage,
    route,
    waypointCoords,
    brochureData,
    destinationBaseMap,
  };
}

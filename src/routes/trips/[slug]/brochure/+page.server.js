import { error } from '@sveltejs/kit';
import { enrichTrips, getHome, getTripFiles, getTripRoute, geocode } from '$lib/server/data.js';
import { readBrochure } from '$lib/server/brochure.js';
import { stadiaStaticMapUrl } from '$lib/server/stadia.js';
import { chooseZoomForBbox } from '$lib/utils/projection.js';

// Compute a Stadia static-map URL for the destination map.
// Returns null when there are no geocoded stops or STADIA_API_KEY is unset
// (the DestinationMap component then falls back to its illustrative
// paper render).
//
// Center is the centroid of must_see stops when any exist (so the map
// focuses on the destination's anchors), falling back to the centroid
// of all geocoded stops. Outlying stops may fall outside the visible
// map; they're still listed in the Stops section so nothing is lost.
function buildDestinationBaseMap(brochureData) {
  if (!brochureData?.stops) return null;
  const located = brochureData.stops.filter(
    s => Array.isArray(s.coords) && s.coords.length === 2,
  );
  if (located.length === 0) return null;

  // Anchor centroid: must_see stops first, otherwise all located stops.
  const anchors = located.filter(s => s.must_see);
  const anchorSet = anchors.length > 0 ? anchors : located;
  const centerLat = anchorSet.reduce((s, p) => s + p.coords[0], 0) / anchorSet.length;
  const centerLon = anchorSet.reduce((s, p) => s + p.coords[1], 0) / anchorSet.length;

  // Bbox from anchor set, not all located stops — so a single Lexington
  // outlier doesn't drag the zoom way out. The unanchored stops still
  // appear in the brochure's Stops list with their addresses.
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
  // Range tuned for "destination area with surroundings" — zoom 11
  // (≈17-mi viewport) on the loose end, zoom 13 (≈4-mi viewport) when
  // anchors are tightly clustered. Zoom 14+ reads as village-roof scale
  // and loses the orientation context the brochure should provide.
  const zoom = Math.max(11, Math.min(13, fitZoom));

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

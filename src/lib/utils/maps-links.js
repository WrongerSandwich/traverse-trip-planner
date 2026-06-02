// Google Maps deep-link builders. Pure functions, no Svelte deps, no API key.
// Consumed by the kebab menu construction in the trip detail page.
//
// URL shape: https://www.google.com/maps/dir/?api=1&waypoints=<wp1>|<wp2>|...
// No origin/destination — Maps prompts the user for current location once
// the URL loads, which is the right shape for the in-trip use case.

/**
 * Resolve a stop to its waypoint string. Prefers exact coords, falls back to
 * the human-readable address, then the place name. Returns `null` when the
 * stop has none of the three (skip from URL).
 *
 * @param {object} stop  Candidate stop projection — { name, address, coords }
 * @returns {string | null}
 */
export function stopToWaypoint(stop) {
  if (!stop || typeof stop !== 'object') return null;
  if (Array.isArray(stop.coords) && stop.coords.length === 2) {
    const [lat, lng] = stop.coords;
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return `${lat},${lng}`;
    }
  }
  if (typeof stop.address === 'string' && stop.address.trim()) {
    return stop.address.trim();
  }
  if (typeof stop.name === 'string' && stop.name.trim()) {
    return stop.name.trim();
  }
  return null;
}

const MAPS_BASE = 'https://www.google.com/maps/dir/?api=1';

// Google Maps URL API allows up to 9 waypoints + origin + destination. With
// no origin/destination specified, all 11 slots are available for waypoints.
const MAX_WAYPOINTS = 11;

/**
 * Build a Google Maps directions URL from an ordered list of stops. Encodes
 * coords / address / name per `stopToWaypoint`. Stops that yield no usable
 * waypoint are skipped; only after that filtering is the 11-waypoint cap
 * applied. Returns `null` when no stop yields a usable waypoint.
 *
 * @param {object[]} stops
 * @param {{ travelMode?: string }} [opts]
 * @returns {string | null}
 */
export function mapsDirectionsUrl(stops, opts = {}) {
  if (!Array.isArray(stops) || stops.length === 0) return null;
  const usable = [];
  for (const s of stops) {
    const wp = stopToWaypoint(s);
    if (wp) usable.push(wp);
    if (usable.length >= MAX_WAYPOINTS) break;
  }
  if (usable.length === 0) return null;
  const waypoints = usable.map(encodeURIComponent).join(encodeURIComponent('|'));
  const travelMode = opts.travelMode || 'driving';
  return `${MAPS_BASE}&waypoints=${waypoints}&travelmode=${encodeURIComponent(travelMode)}`;
}

/**
 * Build a `{ url, waypointCount, truncated }` summary for the kebab menu.
 * `truncated` is true when the input had more usable stops than the URL cap.
 * Returns `null` when no usable waypoints resolve (same as `mapsDirectionsUrl`).
 *
 * @param {object[]} stops
 * @returns {{ url: string, waypointCount: number, truncated: boolean } | null}
 */
export function mapsDeepLinkSummary(stops) {
  if (!Array.isArray(stops) || stops.length === 0) return null;
  let usableCount = 0;
  for (const s of stops) {
    if (stopToWaypoint(s)) usableCount++;
  }
  if (usableCount === 0) return null;
  const url = mapsDirectionsUrl(stops);
  if (!url) return null;
  const waypointCount = Math.min(usableCount, MAX_WAYPOINTS);
  return {
    url,
    waypointCount,
    truncated: usableCount > MAX_WAYPOINTS,
  };
}

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

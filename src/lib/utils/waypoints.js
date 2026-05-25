/**
 * Validate a parsed `waypoints` value from AI-generated frontmatter.
 *
 * Valid: a real Array of at least 2 non-empty strings.
 * Returns true when valid, false for any other shape (not an array,
 * fewer than 2 entries, any entry that's not a non-whitespace string).
 *
 * Exported from a utility module (not from the route file) so the test
 * suite can import it without SvelteKit's route-export restrictions.
 *
 * @param {unknown} value - Raw waypoints value from parsed frontmatter.
 * @returns {boolean}
 */
export function isValidWaypoints(value) {
  if (!Array.isArray(value)) return false;
  if (value.length < 2) return false;
  return value.every((wp) => typeof wp === 'string' && wp.trim().length > 0);
}

/**
 * Returns true when a trip object has usable waypoints — i.e. when the
 * route line can draw. Treats missing, null, and empty-array as the same
 * "no waypoints" state so callers don't have to repeat the check.
 *
 * Accepts any object with an optional `waypoints` field (idea, planning,
 * or completed trip shape). Returns false for falsy trip.
 *
 * @param {{ waypoints?: unknown } | null | undefined} trip
 * @returns {boolean}
 */
export function hasWaypoints(trip) {
  if (!trip) return false;
  return isValidWaypoints(trip.waypoints);
}

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

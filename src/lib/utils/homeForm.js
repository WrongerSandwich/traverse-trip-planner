/**
 * Utilities for the Home base settings form.
 *
 * Exported as pure functions so they can be unit-tested without a DOM.
 */

/**
 * Serialize a travelers array to a comma-separated display string.
 *
 * @param {string[]} arr - e.g. ["evan", "erika"]
 * @returns {string} - e.g. "evan, erika"
 */
export function travelersToString(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return '';
  return arr.join(', ');
}

/**
 * Parse a comma-separated string back to a trimmed, non-empty array of names.
 *
 * @param {string} str - e.g. "evan, erika"
 * @returns {string[]} - e.g. ["evan", "erika"]
 */
export function stringToTravelers(str) {
  if (!str || !str.trim()) return [];
  return str
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

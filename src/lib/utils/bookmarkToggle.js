/**
 * Resolve the bookmark override value to restore when a bookmark toggle
 * request fails, given the override map at failure time.
 *
 * The bug (#493): the old code captured `current` (the pre-flip value) at the
 * START of the request and reverted to it on failure. With rapid double-toggles
 * against a slow/failing network, the stale capture can land the override on
 * the wrong value — e.g. toggle on (req A) → toggle off (req B) → req A fails
 * and reverts to the value it captured, fighting req B's optimistic state.
 *
 * Reverting to the last server-confirmed `starred` instead of a captured
 * snapshot keeps the optimistic override truthful: clear the override entirely
 * so `isStarred()` falls back to the server-loaded `trip.starred`.
 *
 * @param {boolean} confirmedStarred - the trip's last server-confirmed starred state.
 * @returns {boolean} the value to restore the override to on failure.
 */
export function bookmarkRevertValue(confirmedStarred) {
  return !!confirmedStarred;
}

/**
 * Normalize a trip's `starred` frontmatter (which may be the string "true"/
 * "false" from YAML or a real boolean) into a boolean.
 *
 * @param {unknown} starred
 * @returns {boolean}
 */
export function normalizeStarred(starred) {
  return starred === 'true' || starred === true;
}

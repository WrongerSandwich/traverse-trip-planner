/**
 * Serialize / parse the home-page filter state for localStorage persistence.
 *
 * A schema-version key ("v") guards against breakage if filter fields are
 * added or renamed in the future — unknown versions are silently ignored and
 * the caller falls back to defaults.
 */

export const FILTER_STORAGE_KEY = 'traverse:home-filters';
const SCHEMA_VERSION = 1;

const VALID_FILTER  = new Set(['all', 'idea', 'planning', 'completed']);
const VALID_DIST    = new Set(['any', 'u3', '3-6', '6plus']);
const VALID_COST    = new Set(['any', 'budget', 'mid', 'splurge']);
const VALID_SORT    = new Set(['modified', 'name', 'distance', 'duration']);

/**
 * Serialize the active filter set to a JSON string for localStorage.
 *
 * @param {{
 *   activeFilter: string,
 *   activeSort:   string,
 *   activeDist:   string,
 *   activeCost:   string,
 *   activeNPS:    boolean,
 *   activeStarred: boolean,
 * }} state
 * @returns {string}
 */
export function serializeFilters(state) {
  return JSON.stringify({
    v:             SCHEMA_VERSION,
    activeFilter:  state.activeFilter,
    activeSort:    state.activeSort,
    activeDist:    state.activeDist,
    activeCost:    state.activeCost,
    activeNPS:     state.activeNPS,
    activeStarred: state.activeStarred,
  });
}

/**
 * Parse a localStorage value back to filter state.
 *
 * Returns `null` when the value is absent, unparseable, or from an
 * incompatible schema version — callers should fall back to defaults.
 *
 * @param {string | null} raw  — the raw string from localStorage.getItem()
 * @returns {{
 *   activeFilter: string,
 *   activeSort:   string,
 *   activeDist:   string,
 *   activeCost:   string,
 *   activeNPS:    boolean,
 *   activeStarred: boolean,
 * } | null}
 */
export function parseFilters(raw) {
  if (!raw) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  if (parsed.v !== SCHEMA_VERSION) return null;

  // Validate each field; fall back to null for the whole object if
  // a required field is missing or has an unrecognised value.
  const activeFilter  = VALID_FILTER.has(parsed.activeFilter)  ? parsed.activeFilter  : null;
  const activeSort    = VALID_SORT.has(parsed.activeSort)       ? parsed.activeSort    : null;
  const activeDist    = VALID_DIST.has(parsed.activeDist)       ? parsed.activeDist    : null;
  const activeCost    = VALID_COST.has(parsed.activeCost)       ? parsed.activeCost    : null;

  if (!activeFilter || !activeSort || !activeDist || !activeCost) return null;

  return {
    activeFilter,
    activeSort,
    activeDist,
    activeCost,
    activeNPS:     Boolean(parsed.activeNPS),
    activeStarred: Boolean(parsed.activeStarred),
  };
}

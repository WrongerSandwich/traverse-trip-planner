// Pure builders for the planning-page meta pill row. Order is fixed
// (destination → drive → nights → cost); absent fields are dropped so the row
// never shows empty pills. Presentation-only — these mirror the values the
// detail page already rendered in its old `.trip-meta` strip.

/**
 * Format the enriched `_drive_hours` value the same way the detail page used to
 * inline: whole hours render without a decimal, fractional hours with one.
 * Returns null when drive hours aren't available.
 * @param {{ _drive_hours?: number | null }} trip
 * @returns {string | null}
 */
export function driveLabel(trip = {}) {
  const h = trip?._drive_hours;
  if (h == null || !Number.isFinite(h)) return null;
  return `${h % 1 === 0 ? h : h.toFixed(1)} hr`;
}

/**
 * Derive lodging nights from `duration_days` (the same source the cost
 * estimator uses). A trip of N days spans N-1 nights. `duration_days` may be a
 * scalar or an array (first element wins); returns null when not derivable.
 * @param {{ duration_days?: number | string | (number | string)[] }} trip
 * @returns {number | null}
 */
function lodgingNights(trip = {}) {
  let raw = trip?.duration_days;
  if (Array.isArray(raw)) raw = raw[0];
  const days = Number(raw);
  if (!Number.isFinite(days) || days <= 1) return null;
  return days - 1;
}

/**
 * Build the meta pill row from the enriched trip object. Fixed order; absent
 * fields are dropped. Output shape: `{ kind, text }[]`.
 * @param {object} trip
 * @returns {{ kind: string, text: string }[]}
 */
export function metaPills(trip = {}) {
  const pills = [];
  if (trip?.destination) pills.push({ kind: 'destination', text: trip.destination });
  const drive = driveLabel(trip);
  if (drive) pills.push({ kind: 'drive', text: drive });
  const nights = lodgingNights(trip);
  if (Number.isFinite(nights) && nights > 0) {
    pills.push({ kind: 'nights', text: `${nights} night${nights === 1 ? '' : 's'}` });
  }
  if (trip?._cost) pills.push({ kind: 'cost', text: trip._cost });
  return pills;
}

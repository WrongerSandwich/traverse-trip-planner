// Pure helpers for the desktop trip rail.
// No DOM here — the component measures section offsets and passes them in.
// driveLabel and lodgingNights logic are re-used from trip-meta.js so the
// rail stats can't drift from the meta strip.

import { driveLabel } from './trip-meta.js';

/**
 * Derive lodging nights from `duration_days` (same logic as trip-meta.js's
 * lodgingNights, mirrored here so trip-rail stays DOM-free without an internal
 * export dance). A trip of N days spans N-1 nights.
 * @param {{ duration_days?: number | string | (number|string)[] }} trip
 * @returns {number|null}
 */
function lodgingNights(trip = {}) {
  let raw = trip?.duration_days;
  if (Array.isArray(raw)) raw = raw[0];
  const days = Number(raw);
  if (!Number.isFinite(days) || days <= 1) return null;
  return days - 1;
}

/**
 * Build the quick-stats row for the desktop trip rail. Fixed order:
 * Distance → Drive → Nights → Days planned. Absent fields are dropped.
 *
 * @param {object} trip - Enriched trip object (same as the page's `data.trip`).
 * @param {number|null} [planDaysCount] - Number of planned days (from
 *   `data.plan?.days?.length`); not on the trip object itself.
 * @returns {{ label: string, value: string }[]}
 */
export function tripQuickStats(trip = {}, planDaysCount = null) {
  const rows = [];

  if (Number.isFinite(Number(trip?.home_distance_mi)) && trip.home_distance_mi != null) {
    rows.push({ label: 'Distance', value: `${Math.round(Number(trip.home_distance_mi))} mi` });
  }

  const drive = driveLabel(trip);
  if (drive) rows.push({ label: 'Drive', value: drive });

  const nights = lodgingNights(trip);
  if (Number.isFinite(nights) && nights > 0) {
    rows.push({ label: 'Nights', value: `${nights}` });
  }

  const days = Number(planDaysCount);
  if (Number.isFinite(days) && days > 0) {
    rows.push({ label: 'Days planned', value: `${days}` });
  }

  return rows;
}

/**
 * Scroll-spy: given each section's top offset (px from the top of the document)
 * and the current scroll position, return the id of the section currently in
 * view — the last section whose top has been scrolled past.
 *
 * @param {{ id: string, top: number }[]} positions - Sections in document order.
 * @param {number} scrollY - Current vertical scroll position (adjusted for header).
 * @returns {string|null}
 */
export function activeSection(positions = [], scrollY = 0) {
  if (!positions.length) return null;
  let current = positions[0].id;
  for (const p of positions) {
    if (p.top <= scrollY) current = p.id;
    else break;
  }
  return current;
}

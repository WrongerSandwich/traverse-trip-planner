// Pure helpers for the "Today" in-trip view.
// No DOM, no Svelte, no server imports — fully unit-testable.

/**
 * Format a Date as a local-timezone YYYY-MM-DD string.
 *
 * @param {Date} d
 * @returns {string}
 */
function localDateString(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Resolve which 1-based day number to show by default.
 *
 * - A day whose `date` equals today's local YYYY-MM-DD → that day's number.
 * - Today before the first dated day → 1.
 * - Today after the last dated day → days.length.
 * - No dated days at all → 1.
 *
 * Clamping is always correct: result is always in [1, days.length].
 * Caller guarantees days is non-empty.
 *
 * @param {Array<{date?: string|null}>} days
 * @param {Date} today
 * @returns {number}
 */
export function resolveCurrentDay(days, today) {
  const todayStr = localDateString(today);

  // Try an exact match first.
  for (let i = 0; i < days.length; i++) {
    if (days[i].date === todayStr) return i + 1;
  }

  // Collect dated days to decide before/after.
  const dated = days
    .map((d, i) => ({ date: d.date, index: i }))
    .filter((d) => d.date);

  if (dated.length === 0) return 1;

  // Sort by date string (ISO lexicographic order is chronological).
  dated.sort((a, b) => (a.date < b.date ? -1 : 1));

  if (todayStr < dated[0].date) return 1;
  if (todayStr > dated[dated.length - 1].date) return days.length;

  // Shouldn't reach here in normal use, but clamp to 1 as a safe fallback.
  return 1;
}

const MAPS_BASE = 'https://www.google.com/maps/dir/?api=1&destination=';

/**
 * Build a Google Maps universal navigation URL for a stop.
 *
 * Precedence:
 *   1. stop.coords ({lat, lng}) → lat,lng pair.
 *   2. stop.address → URL-encoded address.
 *   3. fallback → URL-encoded "<stop.name>, <destination>".
 *
 * @param {{ coords?: {lat: number, lng: number}|null, address?: string, name?: string }} stop
 * @param {string} [destination]  Trip destination, used only for the name fallback.
 * @returns {string}
 */
export function navUrl(stop, destination) {
  if (stop.coords) {
    return `${MAPS_BASE}${stop.coords.lat},${stop.coords.lng}`;
  }
  if (stop.address) {
    return `${MAPS_BASE}${encodeURIComponent(stop.address)}`;
  }
  return `${MAPS_BASE}${encodeURIComponent(`${stop.name}, ${destination}`)}`;
}

/**
 * Strip all non-digit characters from a phone string and return a tel: href.
 *
 * @param {string} phone
 * @returns {string}
 */
export function telHref(phone) {
  return `tel:${String(phone).replace(/\D/g, '')}`;
}

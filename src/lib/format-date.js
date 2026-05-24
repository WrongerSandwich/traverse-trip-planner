// Shared date-formatting helpers for the planning surfaces. Extracted
// from PlanSection so adjacent sections (CandidatesSection's day picker,
// LodgingCard's in-plan tag, future brochure / retro surfaces) can speak
// the same day vocabulary — "Wednesday · Jul 15 · Day 1" rather than the
// engineer-coded "Day 1 / 2026-07-15".
//
// All parsing is local-timezone-safe: an ISO YYYY-MM-DD string is read
// as a calendar date in the local zone, never as midnight UTC. That
// matters because UTC midnight in a western timezone displays as the
// previous day's weekday — the kind of bug that's invisible until your
// trip lands a day off.

export const WEEKDAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
export const WEEKDAYS_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
export const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

/**
 * Parse a "YYYY-MM-DD" string as a local-zone Date. Returns null on bad
 * input. Used inside the format helpers so we don't accidentally treat
 * an ISO date as midnight UTC.
 *
 * @param {string|null|undefined} iso
 * @returns {Date | null}
 */
export function parseISODate(iso) {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Headline format used at the top of a planning day-card and in any
 * "which day?" picker. Returns the editorial primary (weekday + short
 * date) and a demoted secondary (`Day N`) when a date exists; falls
 * back to bare `Day N` as the primary when the date is empty.
 *
 * @param {{ number: number, date?: string|null }} day
 * @returns {{ primary: string, secondary: string | null }}
 */
export function formatDayHeader(day) {
  if (!day?.date) return { primary: `Day ${day?.number ?? '?'}`, secondary: null };
  const d = parseISODate(day.date);
  if (!d) return { primary: `Day ${day.number}`, secondary: String(day.date) };
  const wd = WEEKDAYS[d.getDay()];
  const mo = MONTHS[d.getMonth()];
  return { primary: `${wd} · ${mo} ${d.getDate()}`, secondary: `Day ${day.number}` };
}

/**
 * Compact day reference for space-constrained surfaces (e.g. the
 * `in-plan` tag on a candidate LodgingCard, which currently renders
 * `Day 1, 2`). Returns the three-letter weekday when a date exists,
 * else `Day N`.
 *
 * @param {{ number: number, date?: string|null }} day
 * @returns {string}
 */
export function formatDayShort(day) {
  if (!day?.date) return `Day ${day?.number ?? '?'}`;
  const d = parseISODate(day.date);
  if (!d) return `Day ${day.number}`;
  return WEEKDAYS_SHORT[d.getDay()];
}

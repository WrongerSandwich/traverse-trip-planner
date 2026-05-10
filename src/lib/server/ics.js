// Tiny ICS generator for Traverse planning-stage trips.
//
// Emits an all-day VEVENT per trip with a target_date. Multi-day trips
// (duration_days > 1) get DTEND set to start + N (DTEND is exclusive in ICS).
// Trips without target_date are skipped — no synthetic dates.

const CRLF = '\r\n';

function escapeText(s) {
  return String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

function dateToICalDate(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

function nowToICalStamp(now = new Date()) {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  const h = String(now.getUTCHours()).padStart(2, '0');
  const mi = String(now.getUTCMinutes()).padStart(2, '0');
  const s = String(now.getUTCSeconds()).padStart(2, '0');
  return `${y}${m}${day}T${h}${mi}${s}Z`;
}

function durationDays(trip) {
  const v = trip.duration_days;
  if (!v) return 1;
  const n = Array.isArray(v) ? Number(v[0]) : Number(v);
  return !isNaN(n) && n > 0 ? n : 1;
}

/**
 * Build a single VEVENT block from a trip object.
 * Returns null if the trip lacks a target_date (no event to emit).
 */
export function tripToVEvent(trip, now = new Date()) {
  if (!trip.target_date) return null;
  const start = new Date(`${trip.target_date}T00:00:00Z`);
  if (isNaN(start.getTime())) return null;

  const days = durationDays(trip);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + days); // DTEND is exclusive in ICS

  const lines = [
    'BEGIN:VEVENT',
    `UID:${trip._slug}@traverse`,
    `DTSTAMP:${nowToICalStamp(now)}`,
    `DTSTART;VALUE=DATE:${dateToICalDate(start)}`,
    `DTEND;VALUE=DATE:${dateToICalDate(end)}`,
    `SUMMARY:${escapeText(trip.title || trip._slug)}`,
  ];
  if (trip.destination) lines.push(`LOCATION:${escapeText(trip.destination)}`);
  if (trip.pitch) lines.push(`DESCRIPTION:${escapeText(trip.pitch)}`);
  lines.push('END:VEVENT');
  return lines.join(CRLF);
}

export function tripsToIcs(trips, now = new Date()) {
  const events = trips.map(t => tripToVEvent(t, now)).filter(Boolean);
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Traverse//Trip Planner//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    ...events,
    'END:VCALENDAR',
    '', // trailing newline per RFC
  ].join(CRLF);
}

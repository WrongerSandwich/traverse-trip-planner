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

/**
 * Build one VEVENT per dated day of a trip's plan (#405).
 *
 * Returns an array of VEVENT strings, or `null` when no day has a `date`
 * field. Days without dates are skipped (not synthesized).
 *
 * @param {object} trip            — trip frontmatter projection ({ _slug, title })
 * @param {object} plan            — parsed plan.yaml
 * @param {object} candidates      — parsed candidates.yaml ({ stops, lodging })
 * @param {Date}   [now]
 * @returns {string[] | null}
 */
export function tripToDailyVEvents(trip, plan, candidates, now = new Date()) {
  if (!plan || !Array.isArray(plan.days)) return null;
  const datedDays = plan.days.filter((d) => typeof d?.date === 'string' && d.date.trim());
  if (datedDays.length === 0) return null;

  const stopsById = new Map();
  for (const s of candidates?.stops ?? []) {
    if (s?.id) stopsById.set(s.id, s);
  }
  const lodgingById = new Map();
  for (const l of candidates?.lodging ?? []) {
    if (l?.id) lodgingById.set(l.id, l);
  }

  const title = trip.title || trip._slug;
  const dtstamp = nowToICalStamp(now);

  const events = [];
  for (const day of datedDays) {
    const start = new Date(`${day.date}T00:00:00Z`);
    if (isNaN(start.getTime())) continue;
    const end = new Date(start);
    end.setUTCDate(start.getUTCDate() + 1); // all-day events: DTEND = DTSTART + 1, exclusive

    // Resolve referenced candidates (skip dangling IDs silently).
    const dayStops = (day.stops ?? [])
      .map((id) => stopsById.get(id))
      .filter(Boolean);
    const dayLodging = day.lodging_id ? lodgingById.get(day.lodging_id) : null;

    // DESCRIPTION sections — each rendered only when its source data exists.
    const descParts = [];
    if (dayStops.length > 0) {
      const stopLines = dayStops.map((s) => `• ${s.name}${s.category ? ` (${s.category})` : ''}`).join('\n');
      descParts.push(`Stops:\n${stopLines}`);
    }
    if (dayLodging) {
      const lodgingLine = dayLodging.address
        ? `Lodging: ${dayLodging.name} — ${dayLodging.address}`
        : `Lodging: ${dayLodging.name}`;
      descParts.push(lodgingLine);
    }
    if (typeof day.notes === 'string' && day.notes.trim()) {
      descParts.push(day.notes.trim());
    }

    // LOCATION — lodging name+address, else first stop's address, else omitted.
    let location = '';
    if (dayLodging) {
      location = dayLodging.address
        ? `${dayLodging.name} — ${dayLodging.address}`
        : dayLodging.name;
    } else if (dayStops[0]?.address) {
      location = dayStops[0].address;
    }

    const lines = [
      'BEGIN:VEVENT',
      `UID:${trip._slug}-day${day.number}@traverse`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART;VALUE=DATE:${dateToICalDate(start)}`,
      `DTEND;VALUE=DATE:${dateToICalDate(end)}`,
      `SUMMARY:${escapeText(title)} · Day ${day.number}`,
    ];
    if (location) lines.push(`LOCATION:${escapeText(location)}`);
    if (descParts.length > 0) lines.push(`DESCRIPTION:${escapeText(descParts.join('\n\n'))}`);
    lines.push('END:VEVENT');
    events.push(lines.join(CRLF));
  }

  return events.length > 0 ? events : null;
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

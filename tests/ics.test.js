import { describe, it, expect, test } from 'vitest';
import { tripToVEvent, tripsToIcs, tripToDailyVEvents, tripToIcs, foldLine } from '../src/lib/server/ics.js';

const FIXED_NOW = new Date('2026-01-15T10:30:00Z');

describe('tripToVEvent', () => {
  it('returns null when target_date is missing', () => {
    expect(tripToVEvent({ _slug: 'x', title: 'T' }, FIXED_NOW)).toBe(null);
  });

  it('returns null when target_date is not parseable', () => {
    expect(tripToVEvent({ _slug: 'x', title: 'T', target_date: 'not-a-date' }, FIXED_NOW)).toBe(null);
  });

  it('emits a single-day VEVENT when duration_days is missing', () => {
    const out = tripToVEvent({
      _slug: 'marfa', title: 'Marfa', destination: 'Marfa, TX',
      target_date: '2026-06-15',
    }, FIXED_NOW);
    expect(out).toContain('BEGIN:VEVENT');
    expect(out).toContain('END:VEVENT');
    expect(out).toContain('UID:marfa@traverse');
    expect(out).toContain('DTSTART;VALUE=DATE:20260615');
    expect(out).toContain('DTEND;VALUE=DATE:20260616'); // exclusive
    expect(out).toContain('SUMMARY:Marfa');
    expect(out).toContain('LOCATION:Marfa\\, TX');
  });

  it('honors numeric duration_days for multi-day events', () => {
    const out = tripToVEvent({
      _slug: 'oz', title: 'Ozarks', target_date: '2026-09-20', duration_days: '3',
    }, FIXED_NOW);
    expect(out).toContain('DTSTART;VALUE=DATE:20260920');
    expect(out).toContain('DTEND;VALUE=DATE:20260923'); // start + 3 days
  });

  it('uses first element when duration_days is a range array', () => {
    const out = tripToVEvent({
      _slug: 't', title: 'T', target_date: '2026-04-01', duration_days: ['2', '4'],
    }, FIXED_NOW);
    expect(out).toContain('DTEND;VALUE=DATE:20260403'); // 2 days
  });

  it('escapes commas, semicolons, backslashes in text fields', () => {
    const out = tripToVEvent({
      _slug: 't', title: 'A, B; C\\D',
      target_date: '2026-04-01', destination: 'Foo, ST',
      pitch: 'Line 1\nLine 2',
    }, FIXED_NOW);
    expect(out).toContain('SUMMARY:A\\, B\\; C\\\\D');
    expect(out).toContain('LOCATION:Foo\\, ST');
    expect(out).toContain('DESCRIPTION:Line 1\\nLine 2');
  });

  it('falls back to slug when title is missing', () => {
    const out = tripToVEvent({ _slug: 'fallback-slug', target_date: '2026-04-01' }, FIXED_NOW);
    expect(out).toContain('SUMMARY:fallback-slug');
  });

  it('omits optional LOCATION and DESCRIPTION when fields are absent', () => {
    const out = tripToVEvent({
      _slug: 't', title: 'T', target_date: '2026-04-01',
    }, FIXED_NOW);
    expect(out).not.toContain('LOCATION:');
    expect(out).not.toContain('DESCRIPTION:');
  });
});

describe('tripsToIcs', () => {
  it('wraps events in VCALENDAR scaffolding', () => {
    const ics = tripsToIcs([
      { _slug: 'a', title: 'Trip A', target_date: '2026-05-01' },
    ], FIXED_NOW);
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('VERSION:2.0');
    expect(ics).toContain('PRODID:-//Traverse//Trip Planner//EN');
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('UID:a@traverse');
  });

  it('uses CRLF line endings (RFC 5545)', () => {
    const ics = tripsToIcs([
      { _slug: 'a', title: 'A', target_date: '2026-05-01' },
    ], FIXED_NOW);
    expect(ics).toMatch(/\r\n/);
    expect(ics).not.toMatch(/[^\r]\n/);
  });

  it('skips trips without target_date silently', () => {
    const ics = tripsToIcs([
      { _slug: 'a', title: 'A', target_date: '2026-05-01' },
      { _slug: 'b', title: 'B' }, // no target_date
      { _slug: 'c', title: 'C', target_date: 'invalid' },
    ], FIXED_NOW);
    const events = ics.match(/BEGIN:VEVENT/g) || [];
    expect(events).toHaveLength(1);
    expect(ics).toContain('UID:a@traverse');
    expect(ics).not.toContain('UID:b@');
    expect(ics).not.toContain('UID:c@');
  });

  it('returns a valid empty calendar when no trips have target_date', () => {
    const ics = tripsToIcs([{ _slug: 'a', title: 'A' }], FIXED_NOW);
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('END:VCALENDAR');
    expect(ics).not.toContain('BEGIN:VEVENT');
  });
});

// ── tripToDailyVEvents — per-day expansion (#405) ──────────────────────────

describe('tripToDailyVEvents', () => {
  const FROZEN = new Date('2026-06-02T12:00:00Z');

  const baseTrip = {
    _slug: 'lakeshore-loop',
    title: 'Lakeshore Loop',
  };

  test('returns null when no day has a date', () => {
    const plan = { days: [{ number: 1, stops: ['a'] }, { number: 2, stops: ['b'] }] };
    const candidates = { stops: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], lodging: [] };
    expect(tripToDailyVEvents(baseTrip, plan, candidates, FROZEN)).toBeNull();
  });

  test('returns null when plan is null or undefined', () => {
    expect(tripToDailyVEvents(baseTrip, null, null, FROZEN)).toBeNull();
    expect(tripToDailyVEvents(baseTrip, undefined, undefined, FROZEN)).toBeNull();
  });

  test('emits one VEVENT per dated day, skipping undated days', () => {
    const plan = {
      days: [
        { number: 1, date: '2026-07-04', stops: ['a'] },
        { number: 2, stops: ['b'] },
        { number: 3, date: '2026-07-06', stops: ['c'] },
      ],
    };
    const candidates = {
      stops: [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
        { id: 'c', name: 'C' },
      ],
      lodging: [],
    };

    const events = tripToDailyVEvents(baseTrip, plan, candidates, FROZEN);
    expect(events).toHaveLength(2);
    expect(events[0]).toContain('UID:lakeshore-loop-day1@traverse');
    expect(events[0]).toContain('DTSTART;VALUE=DATE:20260704');
    expect(events[0]).toContain('DTEND;VALUE=DATE:20260705');
    expect(events[1]).toContain('UID:lakeshore-loop-day3@traverse');
    expect(events[1]).toContain('DTSTART;VALUE=DATE:20260706');
    expect(events[1]).toContain('DTEND;VALUE=DATE:20260707');
  });

  test('SUMMARY uses "<title> · Day N" format', () => {
    const plan = { days: [{ number: 2, date: '2026-07-04', stops: [] }] };
    const events = tripToDailyVEvents(baseTrip, plan, { stops: [], lodging: [] }, FROZEN);
    expect(events[0]).toContain('SUMMARY:Lakeshore Loop · Day 2');
  });

  test('falls back to slug when title is absent', () => {
    const plan = { days: [{ number: 1, date: '2026-07-04', stops: [] }] };
    const trip = { _slug: 'no-title' };
    const events = tripToDailyVEvents(trip, plan, { stops: [], lodging: [] }, FROZEN);
    expect(events[0]).toContain('SUMMARY:no-title · Day 1');
  });

  test('DESCRIPTION lists stops with categories', () => {
    const plan = {
      days: [
        { number: 1, date: '2026-07-04', stops: ['a', 'b'] },
      ],
    };
    const candidates = {
      stops: [
        { id: 'a', name: 'Sleeping Bear Dunes', category: 'outdoors' },
        { id: 'b', name: 'Dune Climb', category: 'view' },
      ],
      lodging: [],
    };
    const events = tripToDailyVEvents(baseTrip, plan, candidates, FROZEN);
    // Unfold (strip CRLF + leading-space sequences) before matching — the DESCRIPTION line
    // exceeds 75 octets and is folded per RFC 5545 §3.1.
    const unfolded = events[0].replace(/\r\n /g, '');
    expect(unfolded).toMatch(/DESCRIPTION:[^\r\n]*Stops:\\n• Sleeping Bear Dunes \(outdoors\)\\n• Dune Climb \(view\)/);
  });

  test('DESCRIPTION includes lodging and notes when present', () => {
    const plan = {
      days: [
        {
          number: 1,
          date: '2026-07-04',
          stops: ['a'],
          lodging_id: 'inn',
          notes: 'Sunset is the move tonight.',
        },
      ],
    };
    const candidates = {
      stops: [{ id: 'a', name: 'A', category: 'misc' }],
      lodging: [{ id: 'inn', name: 'Riverbend Inn', address: '9922 Front St, Empire MI' }],
    };
    const events = tripToDailyVEvents(baseTrip, plan, candidates, FROZEN);
    // Unfold before asserting — the DESCRIPTION line exceeds 75 octets and is folded per RFC 5545 §3.1.
    const unfolded = events[0].replace(/\r\n /g, '');
    expect(unfolded).toContain('Lodging: Riverbend Inn — 9922 Front St\\, Empire MI');
    expect(unfolded).toContain('Sunset is the move tonight.');
  });

  test('DESCRIPTION omits empty sections rather than rendering empty headings', () => {
    const plan = {
      days: [{ number: 1, date: '2026-07-04', stops: [] }],
    };
    const events = tripToDailyVEvents(baseTrip, plan, { stops: [], lodging: [] }, FROZEN);
    expect(events[0]).not.toMatch(/DESCRIPTION:/);
  });

  test('LOCATION resolves from lodging when present', () => {
    const plan = {
      days: [{ number: 1, date: '2026-07-04', stops: ['a'], lodging_id: 'inn' }],
    };
    const candidates = {
      stops: [{ id: 'a', name: 'A', address: '1 First St' }],
      lodging: [{ id: 'inn', name: 'Inn', address: '99 Inn Rd' }],
    };
    const events = tripToDailyVEvents(baseTrip, plan, candidates, FROZEN);
    expect(events[0]).toContain('LOCATION:Inn — 99 Inn Rd');
  });

  test('LOCATION falls back to first stop address when no lodging', () => {
    const plan = { days: [{ number: 1, date: '2026-07-04', stops: ['a'] }] };
    const candidates = {
      stops: [{ id: 'a', name: 'A', address: '1 First St' }],
      lodging: [],
    };
    const events = tripToDailyVEvents(baseTrip, plan, candidates, FROZEN);
    expect(events[0]).toContain('LOCATION:1 First St');
  });

  test('LOCATION is omitted when neither lodging nor first stop has address', () => {
    const plan = { days: [{ number: 1, date: '2026-07-04', stops: ['a'] }] };
    const candidates = {
      stops: [{ id: 'a', name: 'A' }],
      lodging: [],
    };
    const events = tripToDailyVEvents(baseTrip, plan, candidates, FROZEN);
    expect(events[0]).not.toMatch(/LOCATION:/);
  });

  test('UID stability: same input produces same UIDs', () => {
    const plan = { days: [{ number: 1, date: '2026-07-04', stops: [] }, { number: 2, date: '2026-07-05', stops: [] }] };
    const cands = { stops: [], lodging: [] };
    const a = tripToDailyVEvents(baseTrip, plan, cands, FROZEN);
    const b = tripToDailyVEvents(baseTrip, plan, cands, FROZEN);
    expect(a[0]).toContain('UID:lakeshore-loop-day1@traverse');
    expect(b[0]).toContain('UID:lakeshore-loop-day1@traverse');
    expect(a[1]).toContain('UID:lakeshore-loop-day2@traverse');
  });

  test('skips promoted stop IDs that have no matching candidate', () => {
    const plan = { days: [{ number: 1, date: '2026-07-04', stops: ['a', 'ghost', 'b'] }] };
    const candidates = {
      stops: [{ id: 'a', name: 'A', category: 'misc' }, { id: 'b', name: 'B', category: 'misc' }],
      lodging: [],
    };
    const events = tripToDailyVEvents(baseTrip, plan, candidates, FROZEN);
    expect(events[0]).toContain('• A (misc)');
    expect(events[0]).toContain('• B (misc)');
    expect(events[0]).not.toContain('ghost');
  });

  test('escapes special chars in description', () => {
    const plan = {
      days: [{ number: 1, date: '2026-07-04', stops: ['a'], notes: 'Watch out; mind the gap, and the rain.' }],
    };
    const candidates = {
      stops: [{ id: 'a', name: 'A', category: 'misc' }],
      lodging: [],
    };
    const events = tripToDailyVEvents(baseTrip, plan, candidates, FROZEN);
    // ICS escaping: ; → \;, , → \,, newline → \n
    // Unfold before asserting — the DESCRIPTION line exceeds 75 octets and is folded per RFC 5545 §3.1.
    const unfolded = events[0].replace(/\r\n /g, '');
    expect(unfolded).toContain('Watch out\\; mind the gap\\, and the rain.');
  });
});

// ── tripToIcs dispatcher (#405) ───────────────────────────────────────────

describe('tripToIcs dispatcher', () => {
  const FROZEN = new Date('2026-06-02T12:00:00Z');

  test('returns null when neither per-day dates nor target_date are present', () => {
    const trip = { _slug: 't', title: 'T' };
    const plan = { days: [{ number: 1, stops: [] }] };
    const candidates = { stops: [], lodging: [] };
    expect(tripToIcs(trip, { plan, candidates }, FROZEN)).toBeNull();
  });

  test('emits per-day calendar when plan has any dated day', () => {
    const trip = { _slug: 't', title: 'T' };
    const plan = { days: [{ number: 1, date: '2026-07-04', stops: [] }] };
    const ics = tripToIcs(trip, { plan, candidates: { stops: [], lodging: [] } }, FROZEN);
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('UID:t-day1@traverse');
    expect(ics).toContain('END:VCALENDAR');
    // No trip-level UID (the bare slug@traverse) must appear.
    expect(ics).not.toMatch(/UID:t@traverse/);
  });

  test('falls back to trip-level VEVENT when no per-day dates but target_date present', () => {
    const trip = { _slug: 't', title: 'T', target_date: '2026-07-04', duration_days: 3 };
    const plan = { days: [{ number: 1, stops: [] }] };  // no day.date
    const ics = tripToIcs(trip, { plan, candidates: { stops: [], lodging: [] } }, FROZEN);
    expect(ics).toContain('UID:t@traverse');
    expect(ics).toContain('DTSTART;VALUE=DATE:20260704');
    expect(ics).toContain('DTEND;VALUE=DATE:20260707');
  });

  test('per-day path wins over trip-level fallback when both are available', () => {
    const trip = { _slug: 't', title: 'T', target_date: '2026-07-04', duration_days: 3 };
    const plan = { days: [{ number: 1, date: '2026-07-04', stops: [] }] };
    const ics = tripToIcs(trip, { plan, candidates: { stops: [], lodging: [] } }, FROZEN);
    expect(ics).toContain('UID:t-day1@traverse');
    expect(ics).not.toMatch(/UID:t@traverse[\r\n]/);
  });

  test('returns full ICS scaffold (BEGIN:VCALENDAR, METHOD, etc)', () => {
    const trip = { _slug: 't', title: 'T', target_date: '2026-07-04', duration_days: 1 };
    const ics = tripToIcs(trip, { plan: null, candidates: null }, FROZEN);
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('VERSION:2.0');
    expect(ics).toContain('PRODID:-//Traverse//Trip Planner//EN');
    expect(ics).toContain('CALSCALE:GREGORIAN');
    expect(ics).toContain('METHOD:PUBLISH');
    expect(ics).toContain('END:VCALENDAR');
  });

  test('omits options gracefully (plan / candidates may be missing)', () => {
    const trip = { _slug: 't', title: 'T', target_date: '2026-07-04', duration_days: 1 };
    expect(tripToIcs(trip, {}, FROZEN)).toContain('UID:t@traverse');
  });
});

// ── RFC 5545 §3.1 line folding (#441) ─────────────────────────────────────

describe('foldLine', () => {
  test('returns input unchanged when ≤ 75 octets', () => {
    const short = 'SUMMARY:Hello';
    expect(foldLine(short)).toBe(short);
  });

  test('returns input unchanged at exactly 75 octets', () => {
    const exact = 'X'.repeat(75);
    expect(foldLine(exact)).toBe(exact);
  });

  test('folds ASCII line longer than 75 octets at the 75-byte boundary', () => {
    const line = 'X'.repeat(200);
    const folded = foldLine(line);
    // First segment: 75 chars, then "\r\n " + 74 chars, then "\r\n " + 74 chars, then "\r\n " + remainder
    const segments = folded.split('\r\n');
    // First segment 75, continuations each start with a space and are at most 75 octets total (74 chars + leading space)
    expect(segments[0]).toHaveLength(75);
    for (let i = 1; i < segments.length; i++) {
      expect(segments[i].startsWith(' ')).toBe(true);
      expect(segments[i].length).toBeLessThanOrEqual(75);
    }
    // Unfolding (strip CRLF + leading-space sequences) recovers the original line
    const unfolded = folded.replace(/\r\n /g, '');
    expect(unfolded).toBe(line);
  });

  test('folds at byte boundary for multi-byte UTF-8 characters', () => {
    // Each "•" is 3 UTF-8 bytes; pack 30 of them (90 bytes) so we exceed 75.
    const line = '•'.repeat(30);
    const folded = foldLine(line);
    const segments = folded.split('\r\n');
    // No segment should exceed 75 octets
    for (const seg of segments) {
      expect(Buffer.byteLength(seg, 'utf8')).toBeLessThanOrEqual(75);
    }
    // Unfolding recovers the original line
    const unfolded = folded.replace(/\r\n /g, '');
    expect(unfolded).toBe(line);
  });

  test('produces valid continuation lines (each non-first segment starts with single space)', () => {
    const line = 'DESCRIPTION:' + 'A'.repeat(300);
    const folded = foldLine(line);
    const segments = folded.split('\r\n');
    expect(segments.length).toBeGreaterThan(1);
    for (let i = 1; i < segments.length; i++) {
      expect(segments[i][0]).toBe(' ');
    }
  });
});

describe('VEVENT folding integration (#441)', () => {
  const FROZEN = new Date('2026-06-02T12:00:00Z');

  test('tripToVEvent folds long DESCRIPTION', () => {
    const trip = {
      _slug: 'long-desc',
      title: 'Long',
      target_date: '2026-07-04',
      duration_days: 1,
      pitch: 'A '.repeat(100), // ~200 octets
    };
    const ev = tripToVEvent(trip, FROZEN);
    // Every line should be ≤ 75 octets
    for (const seg of ev.split('\r\n')) {
      expect(Buffer.byteLength(seg, 'utf8')).toBeLessThanOrEqual(75);
    }
  });

  test('tripToDailyVEvents folds long per-day DESCRIPTION (multi-byte chars)', () => {
    const trip = { _slug: 't', title: 'Trip' };
    const plan = {
      days: [{
        number: 1,
        date: '2026-07-04',
        stops: ['a', 'b', 'c', 'd'],
        notes: 'A long note — describing the day with em-dashes and bullets, several sentences in.',
      }],
    };
    const candidates = {
      stops: [
        { id: 'a', name: 'Some Very Long Stop Name in Michigan', category: 'outdoors' },
        { id: 'b', name: 'Another Place — With An Em-Dash', category: 'view' },
        { id: 'c', name: 'Yet Another Spot', category: 'food' },
        { id: 'd', name: 'Closing Place', category: 'misc' },
      ],
      lodging: [],
    };
    const events = tripToDailyVEvents(trip, plan, candidates, FROZEN);
    expect(events).toHaveLength(1);
    for (const seg of events[0].split('\r\n')) {
      expect(Buffer.byteLength(seg, 'utf8')).toBeLessThanOrEqual(75);
    }
  });
});

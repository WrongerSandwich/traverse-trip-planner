import { describe, it, expect, test } from 'vitest';
import { tripToVEvent, tripsToIcs, tripToDailyVEvents } from '../src/lib/server/ics.js';

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
    expect(events[0]).toMatch(/DESCRIPTION:[^\r\n]*Stops:\\n• Sleeping Bear Dunes \(outdoors\)\\n• Dune Climb \(view\)/);
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
    expect(events[0]).toContain('Lodging: Riverbend Inn — 9922 Front St\\, Empire MI');
    expect(events[0]).toContain('Sunset is the move tonight.');
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
    expect(events[0]).toContain('Watch out\\; mind the gap\\, and the rain.');
  });
});

import { describe, it, expect } from 'vitest';
import { tripToVEvent, tripsToIcs } from '../src/lib/server/ics.js';

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

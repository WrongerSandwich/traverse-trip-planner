import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

let ROOT;
vi.mock('$lib/server/data.js', async () => {
  const actual = await vi.importActual('$lib/server/data.js');
  return {
    ...actual,
    findTripLocation: (slug) => {
      const path = join(ROOT, 'planning', slug);
      return existsSync(path) ? { kind: 'dir', path, stage: 'planning' } : null;
    },
  };
});

import { emptyPlan, writePlan, readPlan, addDay, removeDay, addStopToDay, removeStopFromDay, moveStopToDay, reorderStops, setDayMetadata, setLodgingForDay, promoteCandidateToDay, unPromoteCandidate, isCandidatePromoted, findDanglingCandidateIds } from '../src/lib/server/plan.js';
import { writeCandidates, emptyCandidates } from '../src/lib/server/candidates.js';

describe('plan mutations', () => {
  beforeEach(() => {
    ROOT = mkdtempSync(join(tmpdir(), 'plan-mut-'));
    mkdirSync(join(ROOT, 'planning', 't'), { recursive: true });
    writePlan('t', emptyPlan());
    writeCandidates('t', { stops: [{ id: 'a', name: 'A', user_added: false }, { id: 'b', name: 'B', user_added: false }], lodging: [{ id: 'inn', name: 'Inn', user_added: false }] });
  });
  afterEach(() => { rmSync(ROOT, { recursive: true, force: true }); });

  it('addDay appends a new day with the next number', () => {
    addDay('t');
    addDay('t');
    expect(readPlan('t').days.map((d) => d.number)).toEqual([1, 2]);
  });

  it('removeDay throws if the day still has stops', () => {
    addDay('t');
    addStopToDay('t', 1, 'a');
    expect(() => removeDay('t', 1)).toThrow(/has assigned stops/);
  });

  it('removeDay succeeds when empty and renumbers subsequent days', () => {
    addDay('t'); addDay('t'); addDay('t');
    removeDay('t', 2);
    expect(readPlan('t').days.map((d) => d.number)).toEqual([1, 2]);
  });

  it('removeDay throws if the day has lodging assigned', () => {
    addDay('t');
    setLodgingForDay('t', 1, 'inn');
    expect(() => removeDay('t', 1)).toThrow(/has assigned lodging/);
  });

  it('removeDay drops date on renumbered days but preserves stops/notes/drive_distance', () => {
    addDay('t'); addDay('t'); addDay('t');
    setDayMetadata('t', 1, { date: '2026-07-15', notes: 'Day 1 notes', drive_distance_mi: 100 });
    setDayMetadata('t', 3, { date: '2026-07-17', notes: 'Day 3 notes', drive_distance_mi: 200 });
    removeDay('t', 2);
    const days = readPlan('t').days;
    // Day 1 is unchanged
    expect(days[0]).toMatchObject({ number: 1, date: '2026-07-15', notes: 'Day 1 notes', drive_distance_mi: 100 });
    // Old day 3 became day 2: date dropped, but notes + drive_distance preserved
    expect(days[1]).toMatchObject({ number: 2, notes: 'Day 3 notes', drive_distance_mi: 200 });
    expect(days[1].date).toBeUndefined();
  });

  it('parsePlanFile normalizes missing day.stops to an empty array', () => {
    // Simulate a hand-edited plan.md missing a stops key on day 2.
    addDay('t'); addDay('t');
    const raw = readPlan('t');
    delete raw.days[1].stops;
    writePlan('t', raw);
    // Re-read — normalization should produce a stops array.
    const re = readPlan('t');
    expect(re.days[1].stops).toEqual([]);
    // And mutators should not crash.
    expect(() => addStopToDay('t', 2, 'a')).not.toThrow();
  });

  it('addStopToDay appends a candidate id to the day', () => {
    addDay('t');
    addStopToDay('t', 1, 'a');
    addStopToDay('t', 1, 'b');
    expect(readPlan('t').days[0].stops).toEqual(['a', 'b']);
  });

  it('addStopToDay rejects unknown candidate ids', () => {
    addDay('t');
    expect(() => addStopToDay('t', 1, 'nope')).toThrow(/not a stop candidate/);
  });

  it('addStopToDay rejects lodging ids (kind guard)', () => {
    addDay('t');
    expect(() => addStopToDay('t', 1, 'inn')).toThrow(/not a stop candidate/);
  });

  it('setLodgingForDay rejects stop ids (kind guard)', () => {
    addDay('t');
    expect(() => setLodgingForDay('t', 1, 'a')).toThrow(/not a lodging candidate/);
  });

  it('removeStopFromDay removes by id', () => {
    addDay('t'); addStopToDay('t', 1, 'a'); addStopToDay('t', 1, 'b');
    removeStopFromDay('t', 1, 'a');
    expect(readPlan('t').days[0].stops).toEqual(['b']);
  });

  it('moveStopToDay moves between days', () => {
    addDay('t'); addDay('t'); addStopToDay('t', 1, 'a');
    moveStopToDay('t', 1, 2, 'a');
    expect(readPlan('t').days[0].stops).toEqual([]);
    expect(readPlan('t').days[1].stops).toEqual(['a']);
  });

  it('reorderStops swaps positions', () => {
    addDay('t'); addStopToDay('t', 1, 'a'); addStopToDay('t', 1, 'b');
    reorderStops('t', 1, ['b', 'a']);
    expect(readPlan('t').days[0].stops).toEqual(['b', 'a']);
  });

  it('reorderStops rejects sets that do not match the day', () => {
    addDay('t'); addStopToDay('t', 1, 'a');
    expect(() => reorderStops('t', 1, ['a', 'b'])).toThrow(/mismatch/);
  });

  it('setDayMetadata updates date, drive_distance_mi, notes', () => {
    addDay('t');
    setDayMetadata('t', 1, { date: '2026-07-15', drive_distance_mi: 240, notes: 'Pack lunch.' });
    expect(readPlan('t').days[0]).toMatchObject({ number: 1, date: '2026-07-15', drive_distance_mi: 240, notes: 'Pack lunch.' });
  });

  it('setLodgingForDay sets / clears the lodging_id', () => {
    addDay('t');
    setLodgingForDay('t', 1, 'inn');
    expect(readPlan('t').days[0].lodging_id).toBe('inn');
    setLodgingForDay('t', 1, null);
    expect(readPlan('t').days[0].lodging_id).toBeUndefined();
  });

  it('promoteCandidateToDay creates day 1 if none exists', () => {
    promoteCandidateToDay('t', 'a', null);
    const p = readPlan('t');
    expect(p.days.length).toBe(1);
    expect(p.days[0].stops).toEqual(['a']);
  });

  it('promoteCandidateToDay assigns to the requested day', () => {
    addDay('t'); addDay('t');
    promoteCandidateToDay('t', 'a', 2);
    expect(readPlan('t').days[1].stops).toEqual(['a']);
  });

  it('isCandidatePromoted reflects plan membership', () => {
    addDay('t'); addStopToDay('t', 1, 'a');
    expect(isCandidatePromoted('t', 'a')).toBe(true);
    expect(isCandidatePromoted('t', 'b')).toBe(false);
  });

  it('unPromoteCandidate removes from all days', () => {
    addDay('t'); addDay('t');
    addStopToDay('t', 1, 'a'); addStopToDay('t', 2, 'a');
    unPromoteCandidate('t', 'a');
    expect(isCandidatePromoted('t', 'a')).toBe(false);
  });

  it('findDanglingCandidateIds returns ids referenced in plan but missing from candidates', () => {
    addDay('t');
    const p = readPlan('t');
    p.days[0].stops = ['a', 'ghost'];
    p.days[0].lodging_id = 'gone';
    writePlan('t', p);
    expect(findDanglingCandidateIds('t').sort()).toEqual(['ghost', 'gone']);
  });
});

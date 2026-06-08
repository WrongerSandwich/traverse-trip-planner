import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

let ROOT;

const mockGeocode = vi.hoisted(() => vi.fn());

vi.mock('$lib/server/data.js', async () => {
  const actual = await vi.importActual('$lib/server/data.js');
  return {
    ...actual,
    findTripLocation: (slug) => {
      const path = join(ROOT, 'planning', slug);
      return existsSync(path) ? { kind: 'dir', path, stage: 'planning' } : null;
    },
    geocode: mockGeocode,
  };
});

import { readCandidates, writeCandidates, emptyCandidates, makeCandidateId, addCandidateStop, addCandidateLodging, deleteCandidate, deleteCandidateStop, deleteCandidateLodging, setCandidateHidden, setTodoDone, setStopCapture } from '../src/lib/server/candidates.js';
import { writePlan, emptyPlan } from '../src/lib/server/plan.js';
import { TraverseError } from '../src/lib/server/errors.js';

describe('candidates.js', () => {
  beforeEach(() => {
    ROOT = mkdtempSync(join(tmpdir(), 'cand-test-'));
    mkdirSync(join(ROOT, 'planning', 'mytrip'), { recursive: true });
  });

  afterEach(() => {
    rmSync(ROOT, { recursive: true, force: true });
  });

  it('returns null when candidates.md is absent', () => {
    expect(readCandidates('mytrip')).toBeNull();
  });

  it('returns empty candidates defaults when frontmatter is empty', () => {
    writeFileSync(join(ROOT, 'planning', 'mytrip', 'candidates.md'), '---\n---\n');
    expect(readCandidates('mytrip')).toEqual({ stops: [], lodging: [] });
  });

  it('round-trips full candidates', () => {
    const cands = {
      stops: [
        { id: 'lake-mcdonald', name: 'Lake McDonald', category: 'outdoors', description: 'Glacial lake.', why_recommended: 'Iconic shoreline.', source_url: 'https://nps.gov', coords: { lat: 48.5, lng: -113.9 }, user_added: false },
      ],
      lodging: [
        { id: 'whitefish-inn', name: 'Whitefish Inn', description: '...', price_tier: 'mid', nights: 2, booking_url: 'https://...', user_added: false },
      ],
    };
    writeCandidates('mytrip', cands);
    expect(readCandidates('mytrip')).toEqual(cands);
  });

  it('emptyCandidates() returns fresh empty lists', () => {
    expect(emptyCandidates()).toEqual({ stops: [], lodging: [] });
  });

  it('makeCandidateId slugs the name', () => {
    expect(makeCandidateId('Lake McDonald', [])).toBe('lake-mcdonald');
    expect(makeCandidateId("Going-to-the-Sun Road!", [])).toBe('going-to-the-sun-road');
  });

  it('makeCandidateId appends -2, -3 on collision', () => {
    expect(makeCandidateId('Lake', ['lake'])).toBe('lake-2');
    expect(makeCandidateId('Lake', ['lake', 'lake-2'])).toBe('lake-3');
  });

  it('throws TraverseError on malformed YAML', () => {
    writeFileSync(join(ROOT, 'planning', 'mytrip', 'candidates.yaml'), ': : invalid yaml\n');
    let caught;
    try { readCandidates('mytrip'); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(TraverseError);
    expect(caught.code).toBe('model_returned_invalid_yaml');
  });

  it('addCandidateStop clamps invalid category to "misc"', () => {
    const id = addCandidateStop('mytrip', { name: 'Weird Place', category: 'bogus-category' });
    const cands = readCandidates('mytrip');
    const stop = cands.stops.find((s) => s.id === id);
    expect(stop.category).toBe('misc');
  });

  it('addCandidateStop preserves valid category', () => {
    const id = addCandidateStop('mytrip', { name: 'A Park', category: 'outdoors' });
    const cands = readCandidates('mytrip');
    expect(cands.stops.find((s) => s.id === id).category).toBe('outdoors');
  });

  it('addCandidateLodging clamps invalid price_tier to "mid"', () => {
    const id = addCandidateLodging('mytrip', { name: 'Ultra Inn', price_tier: 'ultra-luxe' });
    const cands = readCandidates('mytrip');
    expect(cands.lodging.find((l) => l.id === id).price_tier).toBe('mid');
  });

  it('deleteCandidate is a no-op when neither file exists', () => {
    // No plan.md or candidates.md — should not throw or create files.
    expect(() => deleteCandidate('mytrip', 'ghost')).not.toThrow();
    expect(readCandidates('mytrip')).toBeNull();
  });

  it('deleteCandidate is a no-op when id matches nothing in candidates.md', () => {
    writeCandidates('mytrip', { stops: [{ id: 'a', name: 'A', user_added: false }], lodging: [] });
    deleteCandidate('mytrip', 'nonexistent');
    // 'a' should still be there
    expect(readCandidates('mytrip').stops).toHaveLength(1);
  });

  it('deleteCandidateStop removes only from stops array and does not touch lodging', () => {
    writePlan('mytrip', emptyPlan());
    writeCandidates('mytrip', {
      stops: [{ id: 's1', name: 'S1', user_added: false }],
      lodging: [{ id: 'l1', name: 'L1', user_added: false }],
    });
    deleteCandidateStop('mytrip', 's1');
    const cands = readCandidates('mytrip');
    expect(cands.stops).toHaveLength(0);
    expect(cands.lodging).toHaveLength(1); // lodging untouched
  });

  it('deleteCandidateStop is a no-op when id is a lodging id', () => {
    writePlan('mytrip', emptyPlan());
    writeCandidates('mytrip', {
      stops: [],
      lodging: [{ id: 'l1', name: 'L1', user_added: false }],
    });
    deleteCandidateStop('mytrip', 'l1');
    const cands = readCandidates('mytrip');
    expect(cands.lodging).toHaveLength(1); // lodging untouched
  });

  it('deleteCandidateLodging removes only from lodging array and does not touch stops', () => {
    writePlan('mytrip', emptyPlan());
    writeCandidates('mytrip', {
      stops: [{ id: 's1', name: 'S1', user_added: false }],
      lodging: [{ id: 'l1', name: 'L1', user_added: false }],
    });
    deleteCandidateLodging('mytrip', 'l1');
    const cands = readCandidates('mytrip');
    expect(cands.lodging).toHaveLength(0);
    expect(cands.stops).toHaveLength(1); // stops untouched
  });

  it('deleteCandidateLodging is a no-op when id is a stop id', () => {
    writePlan('mytrip', emptyPlan());
    writeCandidates('mytrip', {
      stops: [{ id: 's1', name: 'S1', user_added: false }],
      lodging: [],
    });
    deleteCandidateLodging('mytrip', 's1');
    const cands = readCandidates('mytrip');
    expect(cands.stops).toHaveLength(1); // stops untouched
  });

  // ── setCandidateHidden ──────────────────────────────────────────────────

  it('setCandidateHidden(true) writes hidden: true on a stop', () => {
    writePlan('mytrip', emptyPlan());
    writeCandidates('mytrip', {
      stops: [{ id: 's1', name: 'S1', user_added: false }],
      lodging: [],
    });
    const updated = setCandidateHidden('mytrip', 's1', true);
    expect(updated).toMatchObject({ id: 's1', hidden: true });
    const cands = readCandidates('mytrip');
    expect(cands.stops[0].hidden).toBe(true);
  });

  it('setCandidateHidden(true) writes hidden: true on a lodging', () => {
    writePlan('mytrip', emptyPlan());
    writeCandidates('mytrip', {
      stops: [],
      lodging: [{ id: 'l1', name: 'L1', user_added: false }],
    });
    const updated = setCandidateHidden('mytrip', 'l1', true);
    expect(updated).toMatchObject({ id: 'l1', hidden: true });
    const cands = readCandidates('mytrip');
    expect(cands.lodging[0].hidden).toBe(true);
  });

  it('setCandidateHidden(false) removes the hidden field', () => {
    writePlan('mytrip', emptyPlan());
    writeCandidates('mytrip', {
      stops: [{ id: 's1', name: 'S1', hidden: true, user_added: false }],
      lodging: [],
    });
    const updated = setCandidateHidden('mytrip', 's1', false);
    expect(updated.id).toBe('s1');
    expect('hidden' in updated).toBe(false);
    const cands = readCandidates('mytrip');
    expect('hidden' in cands.stops[0]).toBe(false);
  });

  it('setCandidateHidden returns null when id matches nothing', () => {
    writePlan('mytrip', emptyPlan());
    writeCandidates('mytrip', { stops: [], lodging: [] });
    expect(setCandidateHidden('mytrip', 'no-such-id', true)).toBeNull();
  });

  it('hiding a promoted candidate un-promotes it from the plan', async () => {
    writePlan('mytrip', {
      days: [
        { number: 1, stops: ['s1'], lodging_id: null, notes: '', gotchas: '' },
      ],
    });
    writeCandidates('mytrip', {
      stops: [{ id: 's1', name: 'S1', user_added: false }],
      lodging: [],
    });
    setCandidateHidden('mytrip', 's1', true);
    const { readPlan } = await import('../src/lib/server/plan.js');
    const plan = readPlan('mytrip');
    expect(plan.days[0].stops).not.toContain('s1');
  });

  it('round-trips address, hours, website, phone on stop candidates', () => {
    writeCandidates('mytrip', {
      stops: [{
        id: 'sleeping-bear',
        name: 'Sleeping Bear Dunes',
        category: 'outdoors',
        description: 'Sand dunes on Lake Michigan.',
        why_recommended: 'Park-leaning vibe',
        source_url: 'https://www.nps.gov/slbe/',
        coords: { lat: 44.88, lng: -86.05 },
        address: '9922 Front St, Empire, MI 49630',
        hours: 'Visitor Center 9am-4pm daily; park 24/7',
        website: 'https://www.nps.gov/slbe',
        phone: '(231) 326-4700',
        user_added: false,
      }],
      lodging: [],
    });

    const round = readCandidates('mytrip');
    expect(round.stops[0].address).toBe('9922 Front St, Empire, MI 49630');
    expect(round.stops[0].hours).toBe('Visitor Center 9am-4pm daily; park 24/7');
    expect(round.stops[0].website).toBe('https://www.nps.gov/slbe');
    expect(round.stops[0].phone).toBe('(231) 326-4700');
  });

  it('omitted metadata fields stay undefined after round-trip', () => {
    writeCandidates('mytrip', {
      stops: [{
        id: 'x',
        name: 'Plain Stop',
        category: 'misc',
        description: '',
        user_added: false,
      }],
      lodging: [],
    });

    const round = readCandidates('mytrip');
    expect(round.stops[0].address).toBeUndefined();
    expect(round.stops[0].hours).toBeUndefined();
    expect(round.stops[0].website).toBeUndefined();
    expect(round.stops[0].phone).toBeUndefined();
  });

  describe('setStopCapture', () => {
    const seed = (stops) => writeCandidates('mytrip', { stops, lodging: [] });

    it('sets status and note on a stop', () => {
      seed([{ id: 'main-st', name: 'Main St' }]);
      const out = setStopCapture('mytrip', 'main-st', { status: 'visited', note: 'Loved it' });
      expect(out.status).toBe('visited');
      expect(out.note).toBe('Loved it');
      expect(readCandidates('mytrip').stops[0]).toMatchObject({ status: 'visited', note: 'Loved it' });
    });

    it('clears status when status is null, leaving note untouched', () => {
      seed([{ id: 'main-st', name: 'Main St' }]);
      setStopCapture('mytrip', 'main-st', { status: 'visited', note: 'hi' });
      const out = setStopCapture('mytrip', 'main-st', { status: null });
      expect('status' in out).toBe(false);
      expect(out.note).toBe('hi');
    });

    it('clears note when note is empty string', () => {
      seed([{ id: 'main-st', name: 'Main St' }]);
      setStopCapture('mytrip', 'main-st', { note: 'hi' });
      const out = setStopCapture('mytrip', 'main-st', { note: '' });
      expect('note' in out).toBe(false);
    });

    it('only touches the field that is provided', () => {
      seed([{ id: 'main-st', name: 'Main St' }]);
      setStopCapture('mytrip', 'main-st', { status: 'skipped' });
      const out = setStopCapture('mytrip', 'main-st', { note: 'later' });
      expect(out.status).toBe('skipped');
      expect(out.note).toBe('later');
    });

    it('returns null for an unknown stop', () => {
      seed([{ id: 'main-st', name: 'Main St' }]);
      expect(setStopCapture('mytrip', 'nope', { status: 'visited' })).toBe(null);
    });
  });
});

describe('tips/todos round-trip + setTodoDone', () => {
  beforeEach(() => {
    ROOT = mkdtempSync(join(tmpdir(), 'cand-test-'));
    mkdirSync(join(ROOT, 'planning', 'prep-roundtrip'), { recursive: true });
    mkdirSync(join(ROOT, 'planning', 'prep-toggle'), { recursive: true });
    mkdirSync(join(ROOT, 'planning', 'prep-missing'), { recursive: true });
  });

  afterEach(() => {
    rmSync(ROOT, { recursive: true, force: true });
  });

  it('preserves tips and todos (with done flags) through write/read', () => {
    const slug = 'prep-roundtrip';
    writeCandidates(slug, {
      stops: [
        {
          id: 'a',
          name: 'Place A',
          category: 'misc',
          tips: ['Arrive before 9am', 'Bring cash'],
          todos: [
            { id: 't1', text: 'Book timed-entry ticket', done: false },
            { id: 't2', text: 'Download offline map', done: true },
          ],
        },
      ],
      lodging: [],
    });

    const back = readCandidates(slug);
    expect(back.stops[0].tips).toEqual(['Arrive before 9am', 'Bring cash']);
    expect(back.stops[0].todos).toEqual([
      { id: 't1', text: 'Book timed-entry ticket', done: false },
      { id: 't2', text: 'Download offline map', done: true },
    ]);
  });

  it('setTodoDone flips a todo and returns the stop', () => {
    const slug = 'prep-toggle';
    writeCandidates(slug, {
      stops: [
        { id: 'a', name: 'A', category: 'misc', todos: [{ id: 't1', text: 'x', done: false }] },
      ],
      lodging: [],
    });

    const updated = setTodoDone(slug, 'a', 't1', true);
    expect(updated).toBeTruthy();
    expect(updated.todos[0].done).toBe(true);
    expect(readCandidates(slug).stops[0].todos[0].done).toBe(true);

    setTodoDone(slug, 'a', 't1', false);
    expect(readCandidates(slug).stops[0].todos[0].done).toBe(false);
  });

  it('setTodoDone returns null for unknown stop or todo', () => {
    const slug = 'prep-missing';
    writeCandidates(slug, {
      stops: [{ id: 'a', name: 'A', category: 'misc', todos: [{ id: 't1', text: 'x', done: false }] }],
      lodging: [],
    });

    expect(setTodoDone(slug, 'nope', 't1', true)).toBeNull();
    expect(setTodoDone(slug, 'a', 'nope', true)).toBeNull();
  });
});

describe('geocodeCandidate', () => {
  beforeEach(() => {
    mockGeocode.mockReset();
    mockGeocode.mockResolvedValue({ coords: null, fromCache: true });
  });

  it('returns scoped result when within MAX_CANDIDATE_DISTANCE_MI of refCoords', async () => {
    const { geocodeCandidate } = await import('$lib/server/candidates.js');
    // Scoped query returns a result near the destination; bare query returns null.
    mockGeocode.mockImplementation(async (query) => {
      if (query === 'Mound City Group, Chillicothe OH') return { coords: [39.37, -83.0], fromCache: true };
      return { coords: null, fromCache: true };
    });
    const result = await geocodeCandidate('Mound City Group', 'Chillicothe OH', [39.33, -82.98]);
    expect(result).toEqual([39.37, -83.0]);
  });

  it('rejects a scoped result more than MAX_CANDIDATE_DISTANCE_MI away and falls back to bare query', async () => {
    const { geocodeCandidate, MAX_CANDIDATE_DISTANCE_MI } = await import('$lib/server/candidates.js');
    // Scoped query returns a result that is far from refCoords (simulate a same-name
    // collision with a distant place). Bare query also returns a far result.
    // The scoped result is 300+ mi from the ref point, so it should be rejected.
    // refCoords = Chillicothe OH area; far result = somewhere in Texas (~1200 mi away).
    const farCoords = [31.0, -100.0]; // central Texas
    const refCoords = [39.33, -82.98]; // Chillicothe OH
    mockGeocode.mockImplementation(async (query) => {
      if (query === 'Mound City Group, Chillicothe OH') return { coords: farCoords, fromCache: true };
      if (query === 'Mound City Group') return { coords: farCoords, fromCache: true };
      return { coords: null, fromCache: true };
    });
    const result = await geocodeCandidate('Mound City Group', 'Chillicothe OH', refCoords);
    // Both scoped and bare results are far away, so null is returned.
    expect(result).toBeNull();
    expect(MAX_CANDIDATE_DISTANCE_MI).toBeGreaterThan(0);
  });

  it('geocodes a provided address first and skips name lookups when it pins (Bug 4)', async () => {
    const { geocodeCandidate } = await import('$lib/server/candidates.js');
    const refCoords = [39.33, -82.98]; // Chillicothe OH
    mockGeocode.mockImplementation(async (query) => {
      if (query === '16062 OH-104, Chillicothe, OH 45601') return { coords: [39.37, -83.0], fromCache: true };
      // Name-based queries would resolve elsewhere, but must not be consulted.
      return { coords: [10, 10], fromCache: true };
    });
    const result = await geocodeCandidate(
      'Mound City Group',
      'Chillicothe OH',
      refCoords,
      '16062 OH-104, Chillicothe, OH 45601',
    );
    expect(result).toEqual([39.37, -83.0]);
    // Address pinned, so neither the scoped nor bare name query ran.
    expect(mockGeocode).toHaveBeenCalledTimes(1);
    expect(mockGeocode).toHaveBeenCalledWith('16062 OH-104, Chillicothe, OH 45601');
  });

  it('rejects a provided address more than MAX_CANDIDATE_DISTANCE_MI away and falls back to name (Bug 4)', async () => {
    const { geocodeCandidate } = await import('$lib/server/candidates.js');
    const refCoords = [39.33, -82.98]; // Chillicothe OH
    mockGeocode.mockImplementation(async (query) => {
      if (query === 'Bad Address, Texas') return { coords: [31.0, -100.0], fromCache: true }; // ~1200 mi away
      if (query === 'Mound City Group, Chillicothe OH') return { coords: [39.37, -83.0], fromCache: true };
      return { coords: null, fromCache: true };
    });
    const result = await geocodeCandidate(
      'Mound City Group',
      'Chillicothe OH',
      refCoords,
      'Bad Address, Texas',
    );
    // Address result was rejected on distance; scoped name query won.
    expect(result).toEqual([39.37, -83.0]);
  });
});

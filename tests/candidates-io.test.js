import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
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

import { readCandidates, writeCandidates, emptyCandidates, makeCandidateId, addCandidateStop, addCandidateLodging, deleteCandidate, deleteCandidateStop, deleteCandidateLodging, setCandidateHidden } from '../src/lib/server/candidates.js';
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
    writeFileSync(join(ROOT, 'planning', 'mytrip', 'candidates.md'), '---\n: : invalid yaml\n---\n');
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
});

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

import { writeCandidates, readCandidates, emptyCandidates, addCandidateStop, addCandidateLodging, deleteCandidate } from '../src/lib/server/candidates.js';
import { emptyPlan, writePlan, readPlan, addDay, addStopToDay, setLodgingForDay } from '../src/lib/server/plan.js';

describe('candidate mutations', () => {
  beforeEach(() => {
    ROOT = mkdtempSync(join(tmpdir(), 'cand-mut-'));
    mkdirSync(join(ROOT, 'planning', 't'), { recursive: true });
    writePlan('t', emptyPlan());
    writeCandidates('t', emptyCandidates());
  });
  afterEach(() => { rmSync(ROOT, { recursive: true, force: true }); });

  it('addCandidateStop assigns a slug id and marks user_added: true', () => {
    const id = addCandidateStop('t', { name: 'Lake McDonald', category: 'outdoors', description: 'd', why_recommended: 'w' });
    expect(id).toBe('lake-mcdonald');
    const c = readCandidates('t');
    expect(c.stops).toHaveLength(1);
    expect(c.stops[0]).toMatchObject({ id: 'lake-mcdonald', user_added: true });
  });

  it('addCandidateStop handles id collisions', () => {
    addCandidateStop('t', { name: 'Lake', category: 'outdoors', description: '', why_recommended: '' });
    const id2 = addCandidateStop('t', { name: 'Lake', category: 'outdoors', description: '', why_recommended: '' });
    expect(id2).toBe('lake-2');
  });

  it('addCandidateLodging assigns id and marks user_added', () => {
    const id = addCandidateLodging('t', { name: 'Whitefish Inn', price_tier: 'mid' });
    expect(id).toBe('whitefish-inn');
    expect(readCandidates('t').lodging[0]).toMatchObject({ id, user_added: true });
  });

  it('deleteCandidate removes the candidate from candidates.md', () => {
    const id = addCandidateStop('t', { name: 'A', category: 'outdoors', description: '', why_recommended: '' });
    deleteCandidate('t', id);
    expect(readCandidates('t').stops).toHaveLength(0);
  });

  it('deleteCandidate removes references from plan.md', () => {
    const id = addCandidateStop('t', { name: 'A', category: 'outdoors', description: '', why_recommended: '' });
    addDay('t'); addStopToDay('t', 1, id);
    deleteCandidate('t', id);
    expect(readPlan('t').days[0].stops).toEqual([]);
  });

  it('deleteCandidate clears lodging_id references', () => {
    const id = addCandidateLodging('t', { name: 'Inn', price_tier: 'mid' });
    addDay('t'); setLodgingForDay('t', 1, id);
    deleteCandidate('t', id);
    expect(readPlan('t').days[0].lodging_id).toBeUndefined();
  });
});

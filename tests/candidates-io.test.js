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

import { readCandidates, writeCandidates, emptyCandidates, makeCandidateId } from '../src/lib/server/candidates.js';
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
});

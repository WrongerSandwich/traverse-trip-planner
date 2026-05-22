import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from 'fs';
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

import { readPlan, writePlan, emptyPlan } from '../src/lib/server/plan.js';

describe('plan.js', () => {
  beforeEach(() => {
    ROOT = mkdtempSync(join(tmpdir(), 'plan-test-'));
    mkdirSync(join(ROOT, 'planning', 'mytrip'), { recursive: true });
  });

  it('returns null when plan.md is absent', () => {
    expect(readPlan('mytrip')).toBeNull();
  });

  it('returns empty plan defaults when plan.md is empty frontmatter', () => {
    writeFileSync(join(ROOT, 'planning', 'mytrip', 'plan.md'), '---\n---\n');
    const plan = readPlan('mytrip');
    expect(plan).toEqual({ cover_query: '', field_guide_notes: '', gotchas: '', days: [] });
  });

  it('round-trips a full plan', () => {
    const plan = {
      cover_query: 'Glacier mountains',
      field_guide_notes: 'Park entry: Going-to-the-Sun closes after Logan Pass at sunset.',
      gotchas: 'Cell coverage is non-existent past Apgar.',
      days: [
        { number: 1, date: '2026-07-15', lodging_id: 'whitefish-inn', stops: ['lake-mcdonald', 'avalanche-creek'], drive_distance_mi: 95, notes: '' },
        { number: 2, lodging_id: 'whitefish-inn', stops: ['logan-pass'], notes: 'Pack lunch.' },
      ],
    };
    writePlan('mytrip', plan);
    expect(readPlan('mytrip')).toEqual(plan);
  });

  it('emptyPlan() returns a fresh empty plan object', () => {
    expect(emptyPlan()).toEqual({ cover_query: '', field_guide_notes: '', gotchas: '', days: [] });
  });

  it('throws when writing for a non-folder trip', () => {
    expect(() => writePlan('nonexistent', emptyPlan())).toThrow(/no folder stage/);
  });
});

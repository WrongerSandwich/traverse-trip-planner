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

import { readPlan, writePlan, emptyPlan, parsePlanFile } from '../src/lib/server/plan.js';
import { TraverseError } from '../src/lib/server/errors.js';

describe('plan.js', () => {
  beforeEach(() => {
    ROOT = mkdtempSync(join(tmpdir(), 'plan-test-'));
    mkdirSync(join(ROOT, 'planning', 'mytrip'), { recursive: true });
  });

  afterEach(() => {
    rmSync(ROOT, { recursive: true, force: true });
  });

  it('returns null when plan.yaml is absent', () => {
    expect(readPlan('mytrip')).toBeNull();
  });

  it('returns empty plan defaults when plan.yaml is empty', () => {
    writeFileSync(join(ROOT, 'planning', 'mytrip', 'plan.yaml'), 'cover_query: ~\nfield_guide_notes: []\ngotchas: []\ndays: []\n');
    const plan = readPlan('mytrip');
    expect(plan).toEqual({ cover_query: null, field_guide_notes: [], gotchas: [], days: [] });
  });

  it('round-trips a full plan', () => {
    const plan = {
      cover_query: 'Glacier mountains',
      field_guide_notes: ['Park entry: Going-to-the-Sun closes after Logan Pass at sunset.'],
      gotchas: ['Cell coverage is non-existent past Apgar.'],
      days: [
        { number: 1, date: '2026-07-15', lodging_id: 'whitefish-inn', stops: ['lake-mcdonald', 'avalanche-creek'], drive_distance_mi: 95, notes: '' },
        { number: 2, lodging_id: 'whitefish-inn', stops: ['logan-pass'], notes: 'Pack lunch.' },
      ],
    };
    writePlan('mytrip', plan);
    expect(readPlan('mytrip')).toEqual(plan);
  });

  it('emptyPlan() returns a fresh empty plan object', () => {
    expect(emptyPlan()).toEqual({ cover_query: null, field_guide_notes: [], gotchas: [], days: [] });
  });

  it('parsePlanFile coerces missing/empty cover_query to null', () => {
    writeFileSync(join(ROOT, 'planning', 'mytrip', 'plan.yaml'), 'field_guide_notes: []\ngotchas: []\ndays: []\n');
    const plan = readPlan('mytrip');
    expect(plan.cover_query).toBeNull();
  });

  it('parsePlanFile trims and stores a non-empty cover_query', () => {
    writeFileSync(join(ROOT, 'planning', 'mytrip', 'plan.yaml'), 'cover_query: "  Glacier mountains  "\nfield_guide_notes: []\ngotchas: []\ndays: []\n');
    const plan = readPlan('mytrip');
    expect(plan.cover_query).toBe('Glacier mountains');
  });

  it('throws when writing for a non-folder trip', () => {
    expect(() => writePlan('nonexistent', emptyPlan())).toThrow(/no folder stage/);
  });

  it('throws TraverseError on malformed YAML in plan.yaml', () => {
    writeFileSync(join(ROOT, 'planning', 'mytrip', 'plan.yaml'), ': : invalid yaml\n');
    let caught;
    try { readPlan('mytrip'); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(TraverseError);
    expect(caught.code).toBe('model_returned_invalid_yaml');
  });

  // ── Array coercion for field_guide_notes / gotchas ────────────────────────

  it('parsePlanFile coerces block-string field_guide_notes to array (legacy migration)', () => {
    const content = parsePlanFile('---\nfield_guide_notes: |\n  Park entry: Go early.\n  Watch for wildlife.\ngotchas: ""\ndays: []\n---\n');
    expect(content.field_guide_notes).toEqual(['Park entry: Go early.', 'Watch for wildlife.']);
    expect(content.gotchas).toEqual([]);
  });

  it('parsePlanFile passes through array field_guide_notes unchanged', () => {
    writeFileSync(join(ROOT, 'planning', 'mytrip', 'plan.yaml'), 'field_guide_notes:\n  - Note one\n  - Note two\ngotchas:\n  - Gotcha one\ndays: []\n');
    const plan = readPlan('mytrip');
    expect(plan.field_guide_notes).toEqual(['Note one', 'Note two']);
    expect(plan.gotchas).toEqual(['Gotcha one']);
  });

  it('parsePlanFile strips bullet markers from legacy block-string gotchas', () => {
    const content = parsePlanFile('---\nfield_guide_notes: ""\ngotchas: |\n  - Permit required\n  - Cell dead zone\ndays: []\n---\n');
    expect(content.gotchas).toEqual(['Permit required', 'Cell dead zone']);
  });

  // ── Migration: plan.md → plan.yaml ───────────────────────────────────────

  it('migrates legacy plan.md to plan.yaml on first read', () => {
    const legacyContent = '---\ncover_query: Glacier mountains\nfield_guide_notes: "Park note."\ngotchas: "Gotcha."\ndays: []\n---\n';
    writeFileSync(join(ROOT, 'planning', 'mytrip', 'plan.md'), legacyContent);

    const plan = readPlan('mytrip');
    expect(plan).not.toBeNull();
    expect(plan.cover_query).toBe('Glacier mountains');
    // field_guide_notes and gotchas coerced to arrays during migration
    expect(plan.field_guide_notes).toEqual(['Park note.']);
    expect(plan.gotchas).toEqual(['Gotcha.']);

    // plan.yaml written, plan.md deleted
    expect(existsSync(join(ROOT, 'planning', 'mytrip', 'plan.yaml'))).toBe(true);
    expect(existsSync(join(ROOT, 'planning', 'mytrip', 'plan.md'))).toBe(false);
  });

  it('migration is idempotent — does not re-run when plan.yaml already exists', () => {
    writeFileSync(join(ROOT, 'planning', 'mytrip', 'plan.yaml'), 'cover_query: ~\nfield_guide_notes: []\ngotchas: []\ndays: []\n');
    // Also write a plan.md to ensure it is NOT migrated (yaml wins)
    writeFileSync(join(ROOT, 'planning', 'mytrip', 'plan.md'), '---\ncover_query: "old"\nfield_guide_notes: "old"\ngotchas: "old"\ndays: []\n---\n');

    const plan = readPlan('mytrip');
    // Should read from plan.yaml, not plan.md
    expect(plan.cover_query).toBeNull();
    // plan.md should still be there (not deleted when yaml exists)
    expect(existsSync(join(ROOT, 'planning', 'mytrip', 'plan.md'))).toBe(true);
  });
});

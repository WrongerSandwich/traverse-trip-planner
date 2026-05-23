import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
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

import { writePlan, emptyPlan, addDay, addStopToDay, setLodgingForDay } from '../src/lib/server/plan.js';
import { writeCandidates } from '../src/lib/server/candidates.js';
import { deriveBrochure } from '../src/lib/server/derive-brochure.js';

describe('deriveBrochure', () => {
  beforeEach(() => {
    ROOT = mkdtempSync(join(tmpdir(), 'derive-'));
    mkdirSync(join(ROOT, 'planning', 't'), { recursive: true });
    writeFileSync(join(ROOT, 'planning', 't', 'overview.md'), '---\ntitle: My Trip\nvibe: scenic byway\ntarget_date: 2026-07-15\nduration_days: 2\n---\nProse.\n');
    writeCandidates('t', {
      stops: [
        { id: 'a', name: 'A', category: 'outdoors', description: 'Place A', coords: { lat: 1, lng: 1 }, user_added: false },
        { id: 'b', name: 'B', category: 'food', description: 'Place B', user_added: false },
      ],
      lodging: [{ id: 'inn', name: 'Inn', price_tier: 'mid', nights: 2, user_added: false }],
    });
    const plan = emptyPlan();
    plan.cover_query = 'Glacier mountains';
    plan.field_guide_notes = 'Notes.';
    plan.gotchas = 'Gotchas.';
    writePlan('t', plan);
    addDay('t');
    addStopToDay('t', 1, 'a');
    addStopToDay('t', 1, 'b');
    setLodgingForDay('t', 1, 'inn');
  });
  afterEach(() => { rmSync(ROOT, { recursive: true, force: true }); });

  it('produces a brochure-shaped object derived from plan + candidates', () => {
    const b = deriveBrochure('t');
    expect(b.title).toBe('My Trip');
    expect(b.cover_query).toBe('Glacier mountains');
    expect(b.field_guide_notes).toEqual(['Notes.']);
    expect(b.gotchas).toEqual(['Gotchas.']);
    expect(b.days).toHaveLength(1);
    expect(b.days[0].stops.map((s) => s.name)).toEqual(['A', 'B']);
    expect(b.days[0].lodging.name).toBe('Inn');
    expect(b.stops.map((s) => s.name)).toEqual(['A', 'B']);
    expect(b.lodging.map((l) => l.name)).toEqual(['Inn']);
    // nights survives the projection so the brochure can render the badge
    expect(b.lodging[0].nights).toBe(2);
    // synthetic block.period is null so BrochureDayBlocks skips rendering a heading
    expect(b.days[0].blocks[0].period).toBeNull();
  });

  it('returns null when plan.md or candidates.md absent', () => {
    rmSync(join(ROOT, 'planning', 't', 'plan.md'));
    expect(deriveBrochure('t')).toBeNull();
  });

  it('skips dangling candidate references in days output and reports them via danglings array', () => {
    const plan = { cover_query: null, field_guide_notes: '', gotchas: '', days: [{ number: 1, stops: ['a', 'ghost'] }] };
    writePlan('t', plan);
    const b = deriveBrochure('t');
    expect(b.days[0].stops.map((s) => s.name)).toEqual(['A']);
    expect(b.danglings).toContain('ghost');
  });
});

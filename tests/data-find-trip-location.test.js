/**
 * Tests for findTripLocation() — the canonical "where does this trip live"
 * helper used by planPath / candidatesPath / archive / deepen-section.
 *
 * Mocks node:fs at the module boundary so we can construct the precise
 * transient state that triggered the post-#380 deepen bug: an idea file
 * and a planning folder coexisting briefly while realizePlan() runs.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { join } from 'node:path';

const fsState = { files: {} };

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal();
  const isDir = (p) => Object.keys(fsState.files).some(k => k.startsWith(p + '/'));
  return {
    ...actual,
    existsSync: (p) => p in fsState.files || isDir(p),
    statSync: (p) => ({ isDirectory: () => isDir(p) }),
  };
});

const { findTripLocation } = await import('../src/lib/server/data.js');

const DATA = join(process.cwd(), 'data');
const ideaPath = (slug) => join(DATA, 'ideas', `${slug}.md`);
const overviewPath = (slug, stage = 'planning') => join(DATA, stage, slug, 'overview.md');

beforeEach(() => { fsState.files = {}; });

describe('findTripLocation', () => {
  it('returns null when the trip exists in no stage', () => {
    expect(findTripLocation('ghost')).toBeNull();
  });

  it('finds an idea-stage trip', () => {
    fsState.files[ideaPath('marfa')] = '---\ntitle: Marfa\n---\n';
    expect(findTripLocation('marfa')).toEqual({
      kind: 'file',
      path: ideaPath('marfa'),
      stage: 'ideas',
    });
  });

  it('finds a planning-stage trip', () => {
    fsState.files[overviewPath('ozarks')] = '---\ntitle: Ozarks\n---\n';
    expect(findTripLocation('ozarks')).toEqual({
      kind: 'dir',
      path: join(DATA, 'planning', 'ozarks'),
      stage: 'planning',
    });
  });

  it('finds a completed-stage trip', () => {
    fsState.files[overviewPath('big-bend', 'completed')] = '---\ntitle: Big Bend\n---\n';
    expect(findTripLocation('big-bend')).toEqual({
      kind: 'dir',
      path: join(DATA, 'completed', 'big-bend'),
      stage: 'completed',
    });
  });

  it('returns the planning folder when both an idea file and a planning folder exist for the same slug', () => {
    // This is the transient state the deepen handler creates: mkdirSync
    // planning/<slug>/ and rename overview.md.tmp into place BEFORE
    // unlinking ideas/<slug>.md (so a mid-flow crash leaves the idea
    // intact, per #380). realizePlan() runs in that window and needs
    // findTripLocation to point at the planning folder so planPath() /
    // candidatesPath() can write plan.yaml + candidates.yaml. Returning
    // the idea here is what threw "no folder stage found" in production.
    fsState.files[ideaPath('brown-county-folklore')] = '---\ntitle: BC Folklore\n---\n';
    fsState.files[overviewPath('brown-county-folklore')] = '---\ntitle: BC Folklore\n---\n';

    const loc = findTripLocation('brown-county-folklore');
    expect(loc?.kind).toBe('dir');
    expect(loc?.stage).toBe('planning');
  });

  it('prefers completed over ideas when both exist (defensive — same precedence rule)', () => {
    fsState.files[ideaPath('legacy-trip')] = '---\ntitle: Legacy\n---\n';
    fsState.files[overviewPath('legacy-trip', 'completed')] = '---\ntitle: Legacy\n---\n';
    expect(findTripLocation('legacy-trip')?.stage).toBe('completed');
  });
});

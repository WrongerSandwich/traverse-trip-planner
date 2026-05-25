import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync,
  renameSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { migrateRootDataToDataDir } from '../src/lib/server/migrate-to-data-dir.js';

// Helper: build a "pre-reorg" repo root with a handful of files at known paths
// so each assertion is about the shape of what was moved, not about parsing
// markdown.
function seedLegacyTree(root, { withCache = true } = {}) {
  mkdirSync(join(root, 'ideas'), { recursive: true });
  writeFileSync(join(root, 'ideas', 'glacier.md'), '---\ntitle: Glacier\n---\n');
  writeFileSync(join(root, 'ideas', '.gitkeep'), '');

  mkdirSync(join(root, 'planning', 'ozarks'), { recursive: true });
  writeFileSync(join(root, 'planning', 'ozarks', 'overview.md'), 'planning body\n');
  writeFileSync(join(root, 'planning', 'ozarks', 'plan.yaml'), 'days: []\n');

  mkdirSync(join(root, 'completed', 'badlands'), { recursive: true });
  writeFileSync(join(root, 'completed', 'badlands', 'overview.md'), 'completed body\n');

  mkdirSync(join(root, 'archived', 'ideas'), { recursive: true });
  writeFileSync(join(root, 'archived', 'ideas', 'abandoned.md'), '---\ntitle: Old\n---\n');

  writeFileSync(join(root, 'home.md'), '---\nhome_city: Test\n---\nprose\n');
  writeFileSync(join(root, 'settings.json'), '{"keys":{}}\n');

  if (withCache) {
    mkdirSync(join(root, '.cache'), { recursive: true });
    writeFileSync(join(root, '.cache', '.geocode-cache.json'), '{}');
    writeFileSync(join(root, '.cache', '.jobs.json'), '[]');
  }
}

describe('migrateRootDataToDataDir', () => {
  let root;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'traverse-migrate-'));
  });
  afterEach(() => {
    try { rmSync(root, { recursive: true, force: true }); } catch {}
  });

  it('returns { migrated: false } and is a no-op when nothing legacy exists', () => {
    const result = migrateRootDataToDataDir(root);
    expect(result.migrated).toBe(false);
    expect(existsSync(join(root, 'data'))).toBe(false);
  });

  it('moves all legacy stage dirs into data/', () => {
    seedLegacyTree(root);
    const result = migrateRootDataToDataDir(root);

    expect(result.migrated).toBe(true);
    expect(result.moves.length).toBeGreaterThan(0);

    // Stage dirs landed under data/.
    expect(existsSync(join(root, 'data', 'ideas', 'glacier.md'))).toBe(true);
    expect(existsSync(join(root, 'data', 'planning', 'ozarks', 'overview.md'))).toBe(true);
    expect(existsSync(join(root, 'data', 'planning', 'ozarks', 'plan.yaml'))).toBe(true);
    expect(existsSync(join(root, 'data', 'completed', 'badlands', 'overview.md'))).toBe(true);
    expect(existsSync(join(root, 'data', 'archived', 'ideas', 'abandoned.md'))).toBe(true);

    // ... and the legacy locations no longer exist at the root.
    expect(existsSync(join(root, 'ideas'))).toBe(false);
    expect(existsSync(join(root, 'planning'))).toBe(false);
    expect(existsSync(join(root, 'completed'))).toBe(false);
    expect(existsSync(join(root, 'archived'))).toBe(false);
  });

  it('moves home.md and settings.json into data/', () => {
    seedLegacyTree(root);
    migrateRootDataToDataDir(root);

    expect(existsSync(join(root, 'data', 'home.md'))).toBe(true);
    expect(existsSync(join(root, 'data', 'settings.json'))).toBe(true);
    expect(readFileSync(join(root, 'data', 'home.md'), 'utf8')).toContain('home_city: Test');
    expect(readFileSync(join(root, 'data', 'settings.json'), 'utf8')).toBe('{"keys":{}}\n');

    expect(existsSync(join(root, 'home.md'))).toBe(false);
    expect(existsSync(join(root, 'settings.json'))).toBe(false);
  });

  it('moves .cache/ into data/.cache/ with contents intact', () => {
    seedLegacyTree(root);
    migrateRootDataToDataDir(root);

    expect(existsSync(join(root, 'data', '.cache', '.geocode-cache.json'))).toBe(true);
    expect(existsSync(join(root, 'data', '.cache', '.jobs.json'))).toBe(true);
    expect(existsSync(join(root, '.cache'))).toBe(false);
  });

  it('is idempotent across restarts — skips silently when data/ already exists', () => {
    mkdirSync(join(root, 'data'), { recursive: true });
    // Pre-existing files inside data/ must not be touched.
    writeFileSync(join(root, 'data', 'home.md'), 'already migrated\n');
    // And anything still at the root must be left alone (manual state we don't
    // want to clobber on the second run).
    mkdirSync(join(root, 'ideas'), { recursive: true });
    writeFileSync(join(root, 'ideas', 'stray.md'), 'do not move\n');

    const result = migrateRootDataToDataDir(root);

    expect(result.migrated).toBe(false);
    expect(readFileSync(join(root, 'data', 'home.md'), 'utf8')).toBe('already migrated\n');
    expect(existsSync(join(root, 'ideas', 'stray.md'))).toBe(true);
  });

  it('handles a partial legacy tree (only some dirs / files present)', () => {
    // Only ideas/ and home.md — no planning, completed, archived, settings, cache.
    mkdirSync(join(root, 'ideas'), { recursive: true });
    writeFileSync(join(root, 'ideas', 'a.md'), 'x\n');
    writeFileSync(join(root, 'home.md'), 'home\n');

    const result = migrateRootDataToDataDir(root);

    expect(result.migrated).toBe(true);
    expect(existsSync(join(root, 'data', 'ideas', 'a.md'))).toBe(true);
    expect(existsSync(join(root, 'data', 'home.md'))).toBe(true);
    expect(existsSync(join(root, 'data', 'planning'))).toBe(false);
  });

  it('skips an empty .cache/ directory if the gitkeep is the only thing in it', () => {
    // A fresh clone has .cache/.gitkeep but no real cache files. We still want
    // to migrate that directory rather than leave it dangling at the root.
    mkdirSync(join(root, '.cache'), { recursive: true });
    writeFileSync(join(root, '.cache', '.gitkeep'), '');
    writeFileSync(join(root, 'home.md'), 'home\n');

    migrateRootDataToDataDir(root);

    expect(existsSync(join(root, 'data', '.cache'))).toBe(true);
    expect(existsSync(join(root, '.cache'))).toBe(false);
  });

  it('reports each move via the moves array', () => {
    seedLegacyTree(root);
    const result = migrateRootDataToDataDir(root);
    const names = result.moves.map((m) => m.name).sort();
    expect(names).toEqual(['.cache', 'archived', 'completed', 'home.md', 'ideas', 'planning', 'settings.json']);
  });

  describe('partial-failure recovery', () => {
    // Inject a rename that throws on a specific name (simulating a per-entry
    // EACCES or similar mid-migration failure) and otherwise delegates to the
    // production crossMountRename.
    function failingRename(failingName) {
      return (src, dst) => {
        if (src.endsWith(`/${failingName}`)) {
          throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
        }
        return renameSync(src, dst);
      };
    }

    it('writes a .migration-incomplete marker when any move fails', () => {
      seedLegacyTree(root);
      migrateRootDataToDataDir(root, { rename: failingRename('settings.json') });

      // data/ exists and partially-migrated state is visible on disk.
      expect(existsSync(join(root, 'data'))).toBe(true);
      // The marker survives so a future boot knows the migration was incomplete.
      expect(existsSync(join(root, 'data', '.migration-incomplete'))).toBe(true);
    });

    it('a follow-up boot retries the unmoved entries and clears the marker', () => {
      seedLegacyTree(root);
      migrateRootDataToDataDir(root, { rename: failingRename('settings.json') });
      // settings.json should still be at root because the first attempt failed.
      expect(existsSync(join(root, 'settings.json'))).toBe(true);

      // Second boot: no injected failure; the shim must notice the marker,
      // resume, move the stranded settings.json, and clear the marker.
      const result = migrateRootDataToDataDir(root);
      expect(result.migrated).toBe(true);
      expect(result.moves.map((m) => m.name)).toContain('settings.json');
      expect(existsSync(join(root, 'data', 'settings.json'))).toBe(true);
      expect(existsSync(join(root, 'settings.json'))).toBe(false);
      expect(existsSync(join(root, 'data', '.migration-incomplete'))).toBe(false);
    });

    it('clean follow-up boot (no legacy state left) clears the marker', () => {
      // Marker present but nothing legacy to move — shim should clean up the
      // marker and report a no-op rather than spin forever.
      mkdirSync(join(root, 'data'), { recursive: true });
      writeFileSync(join(root, 'data', '.migration-incomplete'), '');

      const result = migrateRootDataToDataDir(root);
      expect(result.migrated).toBe(false);
      expect(existsSync(join(root, 'data', '.migration-incomplete'))).toBe(false);
    });

    it('happy path does NOT leave a marker behind', () => {
      seedLegacyTree(root);
      migrateRootDataToDataDir(root);
      expect(existsSync(join(root, 'data', '.migration-incomplete'))).toBe(false);
    });

    it('without the marker, data/ existing is still a hard no-op (do not touch user state)', () => {
      // Defense in depth: if a user manually created data/ without going
      // through the shim, we must not start moving root-level dirs into it
      // — that would be hostile and unpredictable. The marker is the ONLY
      // signal that says "yes, the shim owns this".
      mkdirSync(join(root, 'data'), { recursive: true });
      writeFileSync(join(root, 'data', 'home.md'), 'user-curated\n');
      mkdirSync(join(root, 'ideas'), { recursive: true });
      writeFileSync(join(root, 'ideas', 'stray.md'), 'do not touch\n');

      const result = migrateRootDataToDataDir(root);

      expect(result.migrated).toBe(false);
      expect(existsSync(join(root, 'ideas', 'stray.md'))).toBe(true);
      expect(readFileSync(join(root, 'data', 'home.md'), 'utf8')).toBe('user-curated\n');
    });
  });
});

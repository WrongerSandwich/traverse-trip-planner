/**
 * Verifies collectLiveCacheKeys() picks up the new plan.md + candidates.md
 * cache contributions so the enrichTrips GC sweep doesn't delete them.
 *
 * Uses the same fs-mock + process.cwd override pattern as
 * data-enrich-prune-guard.test.js so we control the filesystem layout before
 * data.js is imported (ROOT is set at module init from process.cwd()).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── fs mock ─────────────────────────────────────────────────────────────────

const fsState = {
  files: /** @type {Record<string, string>} */ ({}),
  dirs: /** @type {Set<string>} */ (new Set()),
};

function ensureDir(p) {
  let cur = p;
  while (cur && cur !== '/' && cur !== '.') {
    fsState.dirs.add(cur);
    const slash = cur.lastIndexOf('/');
    if (slash <= 0) break;
    cur = cur.slice(0, slash);
  }
}

function seedFile(p, content) {
  fsState.files[p] = content;
  const slash = p.lastIndexOf('/');
  if (slash > 0) ensureDir(p.slice(0, slash));
}

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    existsSync: (p) => (p in fsState.files) || fsState.dirs.has(p),
    readFileSync: (p) => {
      if (!(p in fsState.files)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return fsState.files[p];
    },
    writeFileSync: (p, content) => { fsState.files[p] = content; },
    renameSync: (src, dst) => {
      if (!(src in fsState.files)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      fsState.files[dst] = fsState.files[src];
      delete fsState.files[src];
    },
    readdirSync: (dir, opts) => {
      if (!fsState.dirs.has(dir)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      const prefix = dir.endsWith('/') ? dir : `${dir}/`;
      const names = new Set();
      for (const p of Object.keys(fsState.files)) {
        if (p.startsWith(prefix)) names.add(p.slice(prefix.length).split('/')[0]);
      }
      for (const d of fsState.dirs) {
        if (!d.startsWith(prefix)) continue;
        const rest = d.slice(prefix.length);
        if (rest && !rest.includes('/')) names.add(rest);
      }
      const arr = [...names];
      if (opts?.withFileTypes) {
        return arr.map((name) => {
          const full = `${prefix}${name}`;
          const isDir = fsState.dirs.has(full);
          return { name, isFile: () => !isDir, isDirectory: () => isDir };
        });
      }
      return arr;
    },
    statSync: (p) => {
      if (p in fsState.files) return { isFile: () => true, isDirectory: () => false, mtimeMs: Date.now() };
      if (fsState.dirs.has(p)) return { isFile: () => false, isDirectory: () => true, mtimeMs: Date.now() };
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    },
    mkdirSync: (p) => { ensureDir(p); },
  };
});

vi.mock('../src/lib/server/settings.js', () => ({
  resolveEnv: () => null,
}));

const ROOT = '/plan-candidates-test-root';
const ORIGINAL_CWD = process.cwd;

process.cwd = () => ROOT;

const { collectLiveCacheKeys } = await import('../src/lib/server/data.js');

beforeEach(() => {
  fsState.files = {};
  fsState.dirs = new Set();
  ensureDir(ROOT);
  ensureDir(`${ROOT}/ideas`);
  ensureDir(`${ROOT}/planning`);
  ensureDir(`${ROOT}/completed`);
  process.cwd = () => ROOT;
});

afterEach(() => {
  process.cwd = ORIGINAL_CWD;
  vi.restoreAllMocks();
});

describe('collectLiveCacheKeys: plan.md + candidates.md', () => {
  it('picks up cover_query from plan.md as an image key', () => {
    ensureDir(`${ROOT}/planning/t`);
    seedFile(`${ROOT}/planning/t/overview.md`,
      '---\ntitle: T\nstatus: planning\ndestination: Whitefish MT\nwaypoints: [Whitefish MT]\n---\n');
    seedFile(`${ROOT}/planning/t/plan.md`,
      '---\ncover_query: Glacier mountains\ndays: []\n---\n');

    const keys = collectLiveCacheKeys();
    expect(keys.images.has('Glacier mountains')).toBe(true);
  });

  it('picks up candidate stop and lodging names as geocode keys', () => {
    ensureDir(`${ROOT}/planning/t`);
    seedFile(`${ROOT}/planning/t/overview.md`,
      '---\ntitle: T\nstatus: planning\ndestination: Whitefish MT\n---\n');
    seedFile(`${ROOT}/planning/t/candidates.md`,
      '---\nstops:\n  - id: lm\n    name: Lake McDonald\n    coords:\n      lat: 48.5\n      lng: -113.9\nlodging:\n  - id: wf\n    name: Whitefish Inn\n    coords:\n      lat: 48.4\n      lng: -114.3\n---\n');

    const keys = collectLiveCacheKeys();
    expect(keys.geocodes.has('Lake McDonald')).toBe(true);
    expect(keys.geocodes.has('Whitefish Inn')).toBe(true);
  });

  it('still picks up overview-level keys (destination, image_query)', () => {
    seedFile(`${ROOT}/ideas/i.md`,
      '---\ntitle: Idea\nstatus: idea\ndestination: Bend OR\nimage_query: Cascades pines\n---\n');

    const keys = collectLiveCacheKeys();
    expect(keys.geocodes.has('Bend OR')).toBe(true);
    expect(keys.images.has('Cascades pines')).toBe(true);
  });

  it('handles trips without plan.md or candidates.md gracefully', () => {
    seedFile(`${ROOT}/ideas/i.md`,
      '---\ntitle: Idea\nstatus: idea\ndestination: Reno NV\n---\n');

    expect(() => collectLiveCacheKeys()).not.toThrow();
    const keys = collectLiveCacheKeys();
    expect(keys.geocodes.has('Reno NV')).toBe(true);
  });

  it('scans completed/ folders too', () => {
    ensureDir(`${ROOT}/completed/done`);
    seedFile(`${ROOT}/completed/done/overview.md`,
      '---\ntitle: Done\nstatus: completed\ndestination: Moab UT\n---\n');
    seedFile(`${ROOT}/completed/done/plan.md`,
      '---\ncover_query: Arches red rock\n---\n');
    seedFile(`${ROOT}/completed/done/candidates.md`,
      '---\nstops:\n  - id: dg\n    name: Delicate Arch\n    coords:\n      lat: 38.7\n      lng: -109.5\nlodging: []\n---\n');

    const keys = collectLiveCacheKeys();
    expect(keys.images.has('Arches red rock')).toBe(true);
    expect(keys.geocodes.has('Delicate Arch')).toBe(true);
  });
});

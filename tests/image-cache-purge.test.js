/**
 * Contract for purgeNullImageEntries() in src/lib/server/data.js.
 *
 * Background: when Pexels was unconfigured, fetchImage() wrote
 * `{ value: null, fetchedAt }` (or, in the legacy bare form, `null`)
 * to the image cache so subsequent requests didn't hammer the unconfigured
 * endpoint. Once a real key is added, those cached null entries would still
 * be treated as fresh hits — trips that were enriched while the key was
 * missing would stay imageless forever. This helper drops only the null
 * entries so the next enrich pass refetches them with the live key.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFileSync, readFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let workdir;
let originalCwd;

beforeEach(() => {
  vi.resetModules();
  workdir = mkdtempSync(join(tmpdir(), 'traverse-image-purge-'));
  originalCwd = process.cwd();
  process.chdir(workdir);
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(workdir, { recursive: true, force: true });
});

describe('purgeNullImageEntries', () => {
  it('drops entries with { value: null } and keeps real entries', async () => {
    writeFileSync(join(workdir, '.image-cache.json'), JSON.stringify({
      'good query': { value: { medium: 'm', large: 'l' }, fetchedAt: 1 },
      'bad query 1': { value: null, fetchedAt: 2 },
      'bad query 2': { value: null, fetchedAt: 3 },
    }));

    const { purgeNullImageEntries } = await import('../src/lib/server/data.js');
    const dropped = purgeNullImageEntries();

    expect(dropped).toBe(2);
    const onDisk = JSON.parse(readFileSync(join(workdir, '.image-cache.json'), 'utf8'));
    expect(Object.keys(onDisk)).toEqual(['good query']);
  });

  it('drops legacy bare-null entries (pre-wrapped format)', async () => {
    writeFileSync(join(workdir, '.image-cache.json'), JSON.stringify({
      'legacy real': { medium: 'm' },
      'legacy null': null,
    }));

    const { purgeNullImageEntries } = await import('../src/lib/server/data.js');
    const dropped = purgeNullImageEntries();

    expect(dropped).toBe(1);
    const onDisk = JSON.parse(readFileSync(join(workdir, '.image-cache.json'), 'utf8'));
    expect(Object.keys(onDisk)).toEqual(['legacy real']);
  });

  it('returns 0 and writes nothing when there are no null entries', async () => {
    const initial = {
      'good 1': { value: { medium: 'm1' }, fetchedAt: 1 },
      'good 2': { value: { medium: 'm2' }, fetchedAt: 2 },
    };
    writeFileSync(join(workdir, '.image-cache.json'), JSON.stringify(initial));

    const { purgeNullImageEntries } = await import('../src/lib/server/data.js');
    const dropped = purgeNullImageEntries();

    expect(dropped).toBe(0);
    const onDisk = JSON.parse(readFileSync(join(workdir, '.image-cache.json'), 'utf8'));
    expect(onDisk).toEqual(initial);
  });

  it('returns 0 on an empty cache file', async () => {
    writeFileSync(join(workdir, '.image-cache.json'), '{}');

    const { purgeNullImageEntries } = await import('../src/lib/server/data.js');
    expect(purgeNullImageEntries()).toBe(0);
  });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';

const fsState = { files: {} };

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal();
  const isDir = (p) => Object.keys(fsState.files).some(k => k.startsWith(p + '/'));
  return {
    ...actual,
    // `findTripLocation` calls existsSync on directory paths (e.g.
    // planning/<slug>) as well as file paths, so we report a directory
    // as "existing" whenever any seeded file lives under it.
    existsSync: (p) => p in fsState.files || isDir(p),
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
    readdirSync: () => [],
    statSync: (p) => ({ isDirectory: () => isDir(p) }),
  };
});

const { updateImageMeta } = await import('../src/lib/server/data.js');

// data.js builds paths via `join(DATA_DIR, 'ideas', `${slug}.md`)` or
// `join(DATA_DIR, 'planning', slug, 'overview.md')` where DATA_DIR is
// `join(process.cwd(), 'data')`. We seed both locations using the same join
// logic so findTripFile() resolves them.
import { join } from 'node:path';
const DATA = join(process.cwd(), 'data');

function seedIdea(slug, content) {
  fsState.files[join(DATA, 'ideas', `${slug}.md`)] = content;
}
function seedPlanning(slug, content) {
  fsState.files[join(DATA, 'planning', slug, 'overview.md')] = content;
}
function readBack(path) {
  return fsState.files[path];
}

beforeEach(() => { fsState.files = {}; });

describe('updateImageMeta', () => {
  it('writes image_query to an idea-stage trip', () => {
    const path = join(DATA, 'ideas', 'demo.md');
    seedIdea('demo', `---
title: Demo
status: idea
destination: Demo, KS
image_query: old query
---

body
`);
    const result = updateImageMeta('demo', { image_query: 'new query' });
    expect(result).toEqual({ ok: true });
    expect(readBack(path)).toMatch(/^image_query: new query$/m);
  });

  it('writes image_pick when value is a positive integer', () => {
    const path = join(DATA, 'ideas', 'demo.md');
    seedIdea('demo', `---
title: Demo
status: idea
destination: Demo, KS
---

body
`);
    updateImageMeta('demo', { image_pick: 2 });
    expect(readBack(path)).toMatch(/^image_pick: 2$/m);
  });

  it('removes image_pick when value is 0', () => {
    const path = join(DATA, 'ideas', 'demo.md');
    seedIdea('demo', `---
title: Demo
status: idea
destination: Demo, KS
image_pick: 2
---

body
`);
    updateImageMeta('demo', { image_pick: 0 });
    expect(readBack(path)).not.toMatch(/image_pick/);
  });

  it('writes both fields in one call (planning stage)', () => {
    const path = join(DATA, 'planning', 'demo', 'overview.md');
    seedPlanning('demo', `---
title: Demo
status: planning
destination: Demo, KS
---

body
`);
    updateImageMeta('demo', { image_query: 'mountains', image_pick: 1 });
    const out = readBack(path);
    expect(out).toMatch(/^image_query: mountains$/m);
    expect(out).toMatch(/^image_pick: 1$/m);
  });

  it('returns null when the trip does not exist', () => {
    expect(updateImageMeta('missing', { image_query: 'x' })).toBe(null);
  });

  it('rejects an image_pick outside 0..2', () => {
    seedIdea('demo', `---
title: Demo
status: idea
destination: Demo, KS
---
`);
    expect(() => updateImageMeta('demo', { image_pick: 3 })).toThrow(/image_pick/);
    expect(() => updateImageMeta('demo', { image_pick: -1 })).toThrow(/image_pick/);
    expect(() => updateImageMeta('demo', { image_pick: 'oops' })).toThrow(/image_pick/);
  });

  it('rejects image_query containing newlines or carriage returns', () => {
    seedIdea('demo', `---
title: Demo
status: idea
destination: Demo, KS
---
`);
    expect(() => updateImageMeta('demo', { image_query: 'multi\nline' })).toThrow(/image_query/);
  });
});

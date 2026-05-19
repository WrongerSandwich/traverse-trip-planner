import { describe, it, expect, vi, beforeEach } from 'vitest';

// Stub the fs module so we don't touch the real filesystem.
const fsState = { files: {} };

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    existsSync: (p) => p in fsState.files,
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
    statSync: () => ({ isDirectory: () => false }),
  };
});

const { appendToNotes } = await import('../src/lib/server/data.js');

// Derive the path the function would write to (mirrors its join(ROOT, 'completed', slug, 'notes.md')).
// We just look up the key that was set in fsState.
function notesKey(slug) {
  return Object.keys(fsState.files).find(k => k.includes(`completed/${slug}/notes.md`)) ?? '';
}

beforeEach(() => {
  fsState.files = {};
});

describe('appendToNotes', () => {
  it('creates notes.md when it does not exist', () => {
    appendToNotes('my-trip', '## Receipts\n\n- 2024-06-01 · Blue Moon Cafe · $18.50 · food');
    const key = notesKey('my-trip');
    expect(key).toBeTruthy();
    expect(fsState.files[key]).toContain('Blue Moon Cafe');
  });

  it('appends to existing notes.md with a blank line separator', () => {
    // Seed an existing notes file.
    const slug = 'existing-trip';
    // We need to figure out what path appendToNotes will use.
    // Write once to discover the path, then reset and re-seed.
    appendToNotes(slug, 'Initial content.');
    const key = notesKey(slug);
    fsState.files[key] = '---\nrating: 4\n---\n\nGreat trip overall.';

    appendToNotes(slug, '## Receipts\n\n- 2024-06-01 · Waffle House · $9.75 · food');

    const content = fsState.files[key];
    expect(content).toContain('Great trip overall.');
    expect(content).toContain('Waffle House');
    // separator: two newlines between old and new
    expect(content).toMatch(/Great trip overall\.\n\n## Receipts/);
  });

  it('does not add extra blank lines when existing file ends with newline', () => {
    const slug = 'clean-trip';
    appendToNotes(slug, 'First block.');
    const key = notesKey(slug);
    fsState.files[key] = 'Existing.\n';

    appendToNotes(slug, 'Second block.');

    expect(fsState.files[key]).toBe('Existing.\n\nSecond block.\n');
  });
});

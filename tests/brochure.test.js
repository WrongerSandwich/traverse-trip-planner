import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ── writeBrochure crash-safety test ────────────────────────────────────────
// Mocks must be declared before any module imports that transitively load them.

// Mock data.js so we can point brochurePath() at a temp dir without needing a
// real planning folder on disk.
const mockFindTripLocation = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/server/data.js', () => ({
  findTripLocation: mockFindTripLocation,
  // stub remaining named exports brochure.js uses at the top level
  geocode: vi.fn(),
  getTripFiles: vi.fn(),
  readHomeMd: vi.fn(),
  parseFrontmatter: vi.fn(),
  flushCaches: vi.fn(),
}));

// Mock atomic-write.js so we can intercept the rename step in the crash test.
const mockAtomicWrite = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/server/atomic-write.js', () => ({
  atomicWrite: mockAtomicWrite,
}));

// Also stub the modules brochure.js imports that have side effects.
vi.mock('../src/lib/server/ai.js', () => ({ chat: vi.fn() }));
vi.mock('../src/lib/server/config.js', () => ({ getEffectiveConfig: vi.fn(() => ({ modelDefault: {} })) }));

import { parseBrochureFile, serializeBrochureFile, writeBrochure } from '../src/lib/server/brochure.js';

describe('parseBrochureFile', () => {
  it('parses YAML frontmatter and prose body', () => {
    const file = `---
title: Arrow Rock
subtitle: A frontier path
duration_days: 3
stops:
  - name: "Old Tavern"
    category: historic
---

Optional Field guide letter goes here.`;
    const parsed = parseBrochureFile(file);
    expect(parsed.data.title).toBe('Arrow Rock');
    expect(parsed.data.duration_days).toBe(3);
    expect(parsed.data.stops).toEqual([{ name: 'Old Tavern', category: 'historic' }]);
    expect(parsed.prose).toBe('Optional Field guide letter goes here.');
  });

  it('handles brochure with no prose body', () => {
    const file = `---
title: Marfa
---`;
    const parsed = parseBrochureFile(file);
    expect(parsed.data.title).toBe('Marfa');
    expect(parsed.prose).toBe('');
  });

  it('returns null when frontmatter fences are missing', () => {
    expect(parseBrochureFile('just prose, no fence')).toBe(null);
  });

  it('handles deeply nested arrays', () => {
    const file = `---
days:
  - n: 1
    blocks:
      - period: morning
        items:
          - time: "8:00 AM"
            activity: "Depart Cleveland"
          - time: "10:00 AM"
            activity: "Coffee in Sandusky"
---`;
    const { data } = parseBrochureFile(file);
    expect(data.days[0].blocks[0].items).toHaveLength(2);
    expect(data.days[0].blocks[0].items[1].activity).toBe('Coffee in Sandusky');
  });

  it('preserves list-typed top-level fields', () => {
    const file = `---
gotchas:
  - "Cell coverage drops along the river"
  - "Hwy 41 has a one-lane bridge"
field_guide_notes:
  - "Wildflowers should be in bloom."
---`;
    const { data } = parseBrochureFile(file);
    expect(data.gotchas).toHaveLength(2);
    expect(data.field_guide_notes[0]).toContain('Wildflowers');
  });

  it('throws a clear error on malformed YAML', () => {
    const file = `---
title: "unterminated
---`;
    expect(() => parseBrochureFile(file)).toThrow(/YAML parse failed/);
  });
});

describe('serializeBrochureFile', () => {
  it('round-trips through parseBrochureFile cleanly', () => {
    const original = {
      data: {
        title: 'Arrow Rock',
        duration_days: 3,
        stops: [
          { name: 'Old Tavern', category: 'historic', must_see: true },
          { name: 'Riverwalk', category: 'outdoors' },
        ],
        gotchas: ['Cell coverage spotty'],
      },
      prose: 'Field guide editor note here.',
    };
    const serialized = serializeBrochureFile(original);
    const parsed = parseBrochureFile(serialized);
    expect(parsed.data).toEqual(original.data);
    expect(parsed.prose).toBe(original.prose);
  });

  it('omits prose section when empty', () => {
    const out = serializeBrochureFile({ data: { title: 'X' } });
    expect(out).not.toContain('\n\n'); // no blank line for empty body
    expect(out.trim().endsWith('---')).toBe(true);
  });

  it('includes prose with a blank line separator when present', () => {
    const out = serializeBrochureFile({ data: { title: 'X' }, prose: 'Hello.' });
    expect(out).toContain('---\n\nHello.');
  });

  it('writes lists in YAML block style (not inline)', () => {
    const out = serializeBrochureFile({
      data: { gotchas: ['First', 'Second', 'Third'] },
    });
    // Block-style lists have each item on its own line prefixed with "- "
    expect(out).toMatch(/gotchas:\s*\n\s*- /);
  });
});

// ── writeBrochure ──────────────────────────────────────────────────────────
describe('writeBrochure', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'traverse-brochure-'));
    mockAtomicWrite.mockReset();
    mockFindTripLocation.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('delegates to atomicWrite (not writeFileSync directly)', () => {
    const brochureMd = join(tmpDir, 'brochure.md');
    mockFindTripLocation.mockReturnValue({ kind: 'dir', path: tmpDir, stage: 'planning' });
    // Use a passthrough so atomicWrite actually writes to disk
    mockAtomicWrite.mockImplementation((path, data) => writeFileSync(path, data));

    writeBrochure('my-trip', { data: { title: 'Test' }, prose: '' });

    expect(mockAtomicWrite).toHaveBeenCalledOnce();
    expect(mockAtomicWrite.mock.calls[0][0]).toBe(brochureMd);
    expect(readFileSync(brochureMd, 'utf8')).toContain('title: Test');
  });

  it('leaves the canonical file untouched when atomicWrite (rename step) throws', () => {
    // Simulate an existing canonical brochure.md with valid content.
    const brochureMd = join(tmpDir, 'brochure.md');
    const goodContent = '---\ntitle: Original\n---\n';
    writeFileSync(brochureMd, goodContent);

    mockFindTripLocation.mockReturnValue({ kind: 'dir', path: tmpDir, stage: 'planning' });

    // Simulate a crash between the temp-file write and the rename: atomicWrite
    // writes the .tmp successfully but renameSync throws (e.g. SIGTERM).
    // We replicate that by writing the .tmp ourselves then throwing.
    mockAtomicWrite.mockImplementation((path, data) => {
      writeFileSync(`${path}.tmp`, data); // temp write succeeds
      throw new Error('Simulated SIGTERM during rename'); // rename never happens
    });

    expect(() => writeBrochure('my-trip', { data: { title: 'New' }, prose: '' })).toThrow(
      'Simulated SIGTERM during rename',
    );

    // Canonical file must be intact — never overwritten by the failed rename.
    expect(readFileSync(brochureMd, 'utf8')).toBe(goodContent);
    // The orphaned .tmp may exist on disk (that's expected crash residue).
    expect(existsSync(`${brochureMd}.tmp`)).toBe(true);
  });

  it('throws when no folder-stage trip is found', () => {
    mockFindTripLocation.mockReturnValue(null);
    expect(() => writeBrochure('ghost-trip', { data: {}, prose: '' })).toThrow(
      /Cannot write brochure/,
    );
    expect(mockAtomicWrite).not.toHaveBeenCalled();
  });
});

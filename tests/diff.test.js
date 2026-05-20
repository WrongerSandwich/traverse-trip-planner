import { describe, it, expect } from 'vitest';
import { diffArrays, diffLines, diffBlocks, summarizeDiff } from '../src/lib/utils/diff.js';

describe('diffArrays', () => {
  it('operates on arbitrary string arrays', () => {
    const out = diffArrays(['a', 'b', 'c'], ['a', 'X', 'c']);
    expect(out.filter(r => r.type === 'del').map(r => r.line)).toEqual(['b']);
    expect(out.filter(r => r.type === 'add').map(r => r.line)).toEqual(['X']);
    expect(out.filter(r => r.type === 'eq').map(r => r.line)).toEqual(['a', 'c']);
  });
});

describe('diffBlocks', () => {
  it('splits on blank-line paragraph breaks', () => {
    const before = 'First paragraph.\n\nSecond paragraph.';
    const after  = 'First paragraph.\n\nReplaced paragraph.';
    const out = diffBlocks(before, after);
    expect(out.filter(r => r.type === 'eq').map(r => r.line)).toEqual(['First paragraph.']);
    expect(out.filter(r => r.type === 'del').map(r => r.line)).toEqual(['Second paragraph.']);
    expect(out.filter(r => r.type === 'add').map(r => r.line)).toEqual(['Replaced paragraph.']);
  });

  it('treats multi-line blocks as single units', () => {
    const before = '## Heading\nBody line 1\nBody line 2';
    const after  = '## Heading\nBody line 1\nBody line 2';
    const out = diffBlocks(before, after);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('eq');
    expect(out[0].line).toBe(before);
  });

  it('drops empty trailing blocks from a final blank line', () => {
    const out = diffBlocks('one\n\ntwo\n\n', 'one\n\ntwo');
    // No spurious del — both sides parsed to the same two blocks.
    expect(out.every(r => r.type === 'eq')).toBe(true);
    expect(out.map(r => r.line)).toEqual(['one', 'two']);
  });

  it('handles null / undefined as empty', () => {
    expect(diffBlocks(null, 'x').map(r => r.line)).toEqual(['x']);
    expect(diffBlocks('x', undefined).map(r => r.line)).toEqual(['x']);
  });
});

describe('diffLines', () => {
  it('returns all eq rows when before === after', () => {
    const out = diffLines('one\ntwo\nthree', 'one\ntwo\nthree');
    expect(out.every(r => r.type === 'eq')).toBe(true);
    expect(out.map(r => r.line)).toEqual(['one', 'two', 'three']);
  });

  it('marks pure insertions', () => {
    const out = diffLines('one\ntwo', 'one\ntwo\nthree');
    expect(out).toEqual([
      { type: 'eq', line: 'one' },
      { type: 'eq', line: 'two' },
      { type: 'add', line: 'three' },
    ]);
  });

  it('marks pure deletions', () => {
    const out = diffLines('one\ntwo\nthree', 'one\nthree');
    expect(out).toEqual([
      { type: 'eq', line: 'one' },
      { type: 'del', line: 'two' },
      { type: 'eq', line: 'three' },
    ]);
  });

  it('detects line-level replacement (del followed by add for the same slot)', () => {
    const out = diffLines('first\nold\nlast', 'first\nnew\nlast');
    // The exact ordering of del-then-add vs add-then-del is implementation
    // defined; assert that the set of changes is correct.
    const dels = out.filter(r => r.type === 'del').map(r => r.line);
    const adds = out.filter(r => r.type === 'add').map(r => r.line);
    const eqs = out.filter(r => r.type === 'eq').map(r => r.line);
    expect(dels).toEqual(['old']);
    expect(adds).toEqual(['new']);
    expect(eqs).toEqual(['first', 'last']);
  });

  it('handles empty before string (full insertion)', () => {
    const out = diffLines('', 'a\nb');
    // Empty string splits to [''] so the first entry is an eq for the empty line.
    expect(out.filter(r => r.type === 'add').map(r => r.line)).toEqual(['a', 'b']);
  });

  it('handles empty after string (full deletion)', () => {
    const out = diffLines('a\nb', '');
    expect(out.filter(r => r.type === 'del').map(r => r.line)).toEqual(['a', 'b']);
  });

  it('treats null / undefined as empty', () => {
    expect(diffLines(null, 'x').filter(r => r.type === 'add').map(r => r.line)).toEqual(['x']);
    expect(diffLines('x', undefined).filter(r => r.type === 'del').map(r => r.line)).toEqual(['x']);
    expect(diffLines(undefined, null)).toEqual([{ type: 'eq', line: '' }]);
  });
});

describe('summarizeDiff', () => {
  it('returns visible rows unchanged when nothing exceeds maxLines', () => {
    const rows = diffLines('a\nb\nc', 'a\nB\nc');
    const { visible, hiddenChanges } = summarizeDiff(rows);
    expect(hiddenChanges).toBe(0);
    expect(visible.some(r => r.type === 'del' && r.line === 'b')).toBe(true);
    expect(visible.some(r => r.type === 'add' && r.line === 'B')).toBe(true);
  });

  it('emits an ellipsis between non-adjacent change windows', () => {
    // Build a diff with two separate change regions, padded by enough eq
    // lines to keep them from merging at contextLines=1.
    const before = 'a\nb\nc\nd\ne\nf\ng\nh\ni\nj\nk';
    const after  = 'a\nb\nX\nd\ne\nf\ng\nh\nY\nj\nk';
    const rows = diffLines(before, after);
    const { visible } = summarizeDiff(rows, { contextLines: 1, maxLines: 50 });
    const types = visible.map(r => r.type);
    expect(types).toContain('ellipsis');
  });

  it('caps emitted rows at maxLines and reports hiddenChanges', () => {
    // 30 line replacements; with maxLines=10, most of the changes should be hidden.
    const before = Array.from({ length: 30 }, (_, i) => `before-${i}`).join('\n');
    const after  = Array.from({ length: 30 }, (_, i) => `after-${i}`).join('\n');
    const rows = diffLines(before, after);
    const { visible, hiddenChanges } = summarizeDiff(rows, { contextLines: 0, maxLines: 10 });
    expect(visible.length).toBeLessThanOrEqual(10);
    expect(hiddenChanges).toBeGreaterThan(0);
  });

  it('returns empty visible when input is empty', () => {
    expect(summarizeDiff([])).toEqual({ visible: [], hiddenChanges: 0 });
  });
});

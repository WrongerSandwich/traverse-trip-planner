import { describe, it, expect } from 'vitest';
import { parseBrochureFile, serializeBrochureFile } from '../src/lib/server/brochure.js';

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
            activity: "Depart Overland Park"
          - time: "10:00 AM"
            activity: "Coffee in Lexington"
---`;
    const { data } = parseBrochureFile(file);
    expect(data.days[0].blocks[0].items).toHaveLength(2);
    expect(data.days[0].blocks[0].items[1].activity).toBe('Coffee in Lexington');
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

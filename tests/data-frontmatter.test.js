import { describe, it, expect } from 'vitest';
import { parseFrontmatter, parseFrontmatterFields } from '../src/lib/server/data.js';

describe('parseFrontmatter', () => {
  it('parses a standard idea-stage frontmatter', () => {
    const md = `---
title: Marfa Texas
status: idea
destination: Marfa, TX
created: 2026-01-15
---

Body prose here.`;
    const fm = parseFrontmatter(md);
    expect(fm).toEqual({
      title: 'Marfa Texas',
      status: 'idea',
      destination: 'Marfa, TX',
      created: '2026-01-15',
    });
  });

  it('returns null when no frontmatter is present', () => {
    expect(parseFrontmatter('Just a body, no frontmatter.')).toBe(null);
  });

  it('returns null when closing --- is missing', () => {
    const md = `---
title: Broken
status: idea
`;
    expect(parseFrontmatter(md)).toBe(null);
  });

  it('parses inline list values', () => {
    const md = `---
waypoints: [Overland Park KS, Leavenworth KS, Atchison KS]
tags: [scenic-drive, small-town]
---`;
    const fm = parseFrontmatter(md);
    expect(fm.waypoints).toEqual(['Overland Park KS', 'Leavenworth KS', 'Atchison KS']);
    expect(fm.tags).toEqual(['scenic-drive', 'small-town']);
  });

  it('handles values containing colons', () => {
    const md = `---
pitch: Three sentences: with colons. And more.
---`;
    const fm = parseFrontmatter(md);
    expect(fm.pitch).toBe('Three sentences: with colons. And more.');
  });

  it('skips lines without colons', () => {
    const md = `---
title: Trip
some random line
status: idea
---`;
    const fm = parseFrontmatter(md);
    expect(fm.title).toBe('Trip');
    expect(fm.status).toBe('idea');
  });

  it('handles empty frontmatter block (blank line between fences)', () => {
    const md = `---

---

body`;
    expect(parseFrontmatter(md)).toEqual({});
  });

  it('returns null for adjacent fences with no separator', () => {
    // Documenting current behavior: ---\n--- doesn't satisfy the regex.
    expect(parseFrontmatter('---\n---\n\nbody')).toBe(null);
  });

  it('parses boolean-like and numeric values as strings', () => {
    const md = `---
fly_in: true
home_distance_mi: 420
locked: false
---`;
    const fm = parseFrontmatter(md);
    expect(fm.fly_in).toBe('true');
    expect(fm.home_distance_mi).toBe('420');
    expect(fm.locked).toBe('false');
  });

  it('treats single-bracket values as lists even when empty', () => {
    const md = `---
waypoints: []
---`;
    expect(parseFrontmatter(md).waypoints).toEqual(['']);
  });
});

describe('parseFrontmatterFields', () => {
  it('parses raw key:value lines without requiring fences', () => {
    const text = `region: Ozarks
home_distance_mi: 420
weekend_viable: true`;
    expect(parseFrontmatterFields(text)).toEqual({
      region: 'Ozarks',
      home_distance_mi: '420',
      weekend_viable: 'true',
    });
  });

  it('still recognizes inline list values', () => {
    const text = `waypoints: [Overland Park KS, Leavenworth KS, Atchison KS]`;
    expect(parseFrontmatterFields(text).waypoints)
      .toEqual(['Overland Park KS', 'Leavenworth KS', 'Atchison KS']);
  });

  it('returns an empty object for empty input', () => {
    expect(parseFrontmatterFields('')).toEqual({});
  });

  it('skips lines without colons', () => {
    const text = `not a kv line
title: Trip
also not`;
    expect(parseFrontmatterFields(text)).toEqual({ title: 'Trip' });
  });

  it('parseFrontmatter delegates to parseFrontmatterFields with same array semantics', () => {
    const md = `---
tags: [a, b]
---`;
    expect(parseFrontmatter(md).tags).toEqual(parseFrontmatterFields('tags: [a, b]').tags);
  });
});

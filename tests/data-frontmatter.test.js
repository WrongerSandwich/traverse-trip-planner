import { describe, it, expect } from 'vitest';
import { parseFrontmatter, parseFrontmatterFields, setFrontmatterField, removeFrontmatterField, imageQuery } from '../src/lib/server/data.js';

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

  it('parses boolean-like and numeric values as their YAML types (#275)', () => {
    const md = `---
weekend_viable: true
home_distance_mi: 420
locked: false
---`;
    const fm = parseFrontmatter(md);
    expect(fm.weekend_viable).toBe(true);
    expect(fm.home_distance_mi).toBe(420);
    expect(fm.locked).toBe(false);
  });

  it('parses empty inline array [] as []', () => {
    const md = `---
waypoints: []
---`;
    expect(parseFrontmatter(md).waypoints).toEqual([]);
  });

  it('parses block-style home_coords as [number, number] (#275, folds in #283)', () => {
    const md = `---
home_coords:
  - 38.98
  - -94.67
---`;
    expect(parseFrontmatter(md).home_coords).toEqual([38.98, -94.67]);
  });

  it('handles quoted commas inside inline arrays (#275)', () => {
    const md = `---
tags: [hiking, "scenic, drive", waterfalls]
---`;
    expect(parseFrontmatter(md).tags).toEqual(['hiking', 'scenic, drive', 'waterfalls']);
  });

  it('returns {} for malformed YAML rather than throwing', () => {
    // The fence regex captures the inner block; yaml.parse fails on the
    // colon-without-key shape, and we expect a graceful empty object.
    const md = `---
: bad
---`;
    expect(parseFrontmatter(md)).toEqual({});
  });
});

describe('parseFrontmatterFields', () => {
  it('parses raw key:value lines without requiring fences (yaml-typed since #275)', () => {
    const text = `region: Ozarks
home_distance_mi: 420
weekend_viable: true`;
    expect(parseFrontmatterFields(text)).toEqual({
      region: 'Ozarks',
      home_distance_mi: 420,
      weekend_viable: true,
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

describe('setFrontmatterField', () => {
  const base = `---\ntitle: Marfa Texas\nstatus: idea\n---\n\nBody prose.`;

  it('updates an existing field in place', () => {
    const result = setFrontmatterField(base, 'status', 'exploring');
    expect(result).toContain('status: exploring');
    expect(result).not.toContain('status: idea');
  });

  it('inserts a new field before the closing fence', () => {
    const result = setFrontmatterField(base, 'locked', true);
    expect(result).toContain('locked: true');
    expect(parseFrontmatter(result)?.locked).toBe(true);
  });

  it('does not duplicate an existing field when updating', () => {
    const result = setFrontmatterField(base, 'title', 'New Title');
    const matches = result.match(/^title:/gm);
    expect(matches).toHaveLength(1);
  });

  it('preserves body prose after mutation', () => {
    const result = setFrontmatterField(base, 'starred', true);
    expect(result).toContain('Body prose.');
  });

  it('handles a field whose name is a prefix of another field', () => {
    // 'star' must not accidentally match 'starred'
    const md = `---\nstarred: false\nstar_rating: 4\n---\n`;
    const result = setFrontmatterField(md, 'starred', true);
    expect(result).toContain('starred: true');
    expect(result).toContain('star_rating: 4');
  });

  it('does not rewrite a body line starting with the field name when field is absent from frontmatter', () => {
    // A route.md body line like "starred: yes, this is the route…" must not
    // be mutated when starred is not declared in the frontmatter at all.
    const md = `---\ntitle: Ozarks\nstatus: planning\n---\n\nstarred: yes, this is the route we've all been waiting for.`;
    const result = setFrontmatterField(md, 'starred', true);
    expect(parseFrontmatter(result)?.starred).toBe(true);
    expect(result).toContain("starred: yes, this is the route we've all been waiting for.");
  });

  it('does not rewrite a body line starting with the field name when field is present in frontmatter', () => {
    // Even when frontmatter already has the field, the body prose line must be untouched.
    const md = `---\ntitle: Ozarks\nstatus: planning\nstarred: false\n---\n\nstarred: yes, this is the route we've all been waiting for.`;
    const result = setFrontmatterField(md, 'starred', true);
    expect(parseFrontmatter(result)?.starred).toBe(true);
    expect(result).toContain("starred: yes, this is the route we've all been waiting for.");
    // The frontmatter line should appear exactly once
    const fmMatches = result.match(/^starred:/gm);
    expect(fmMatches).toHaveLength(2); // one in frontmatter, one in body
    expect(parseFrontmatter(result)?.starred).toBe(true);
  });

  it('collapses duplicate status lines to exactly one canonical line (#278)', () => {
    // Simulate frontmatter with a pre-existing duplicate key (the latent footgun).
    const md = `---\ntitle: Test Trip\nstatus: idea\nstatus: planning\n---\n\nBody.`;
    const result = setFrontmatterField(md, 'status', 'completed');
    const matches = result.match(/^status:/gm);
    expect(matches).toHaveLength(1);
    expect(result).toContain('status: completed');
    expect(parseFrontmatter(result)?.status).toBe('completed');
  });
});

describe('removeFrontmatterField', () => {
  const base = `---\ntitle: Marfa Texas\nresearching: true\nstatus: idea\n---\n\nBody prose.`;

  it('removes an existing field and its line', () => {
    const result = removeFrontmatterField(base, 'researching');
    expect(result).not.toContain('researching');
    expect(parseFrontmatter(result)?.researching).toBeUndefined();
  });

  it('leaves other fields and body intact', () => {
    const result = removeFrontmatterField(base, 'researching');
    expect(parseFrontmatter(result)?.title).toBe('Marfa Texas');
    expect(parseFrontmatter(result)?.status).toBe('idea');
    expect(result).toContain('Body prose.');
  });

  it('is a no-op when the field is absent', () => {
    const result = removeFrontmatterField(base, 'nonexistent');
    expect(result).toBe(base);
  });

  it('round-trips with setFrontmatterField: set then remove yields no field', () => {
    const md = `---\ntitle: Test\nstatus: idea\n---\n`;
    const withFlag = setFrontmatterField(md, 'researching', 'true');
    const withoutFlag = removeFrontmatterField(withFlag, 'researching');
    expect(parseFrontmatter(withoutFlag)?.researching).toBeUndefined();
    expect(parseFrontmatter(withoutFlag)?.title).toBe('Test');
  });

  it('removes all duplicate copies of a field with the g flag (#278)', () => {
    // Simulate frontmatter with a pre-existing duplicate key.
    const md = `---\ntitle: Test Trip\nstatus: idea\nstatus: planning\n---\n\nBody.`;
    const result = removeFrontmatterField(md, 'status');
    expect(result).not.toContain('status:');
    expect(parseFrontmatter(result)?.status).toBeUndefined();
    expect(parseFrontmatter(result)?.title).toBe('Test Trip');
  });
});

describe('imageQuery', () => {
  it('prefers the explicit image_query field when present', () => {
    expect(imageQuery({
      title: 'Chicago: Architectural Landmarks and Rare Books',
      destination: 'Chicago, IL',
      image_query: 'Chicago skyline downtown',
    })).toBe('Chicago skyline downtown');
  });

  it('trims whitespace from image_query', () => {
    expect(imageQuery({ title: 'X', image_query: '  Asheville Blue Ridge  ' }))
      .toBe('Asheville Blue Ridge');
  });

  it('ignores an empty/whitespace image_query and falls back to title', () => {
    expect(imageQuery({ title: 'Marfa Texas Desert', image_query: '   ' }))
      .toBe('Marfa Texas Desert');
  });

  it('falls back to the title with stopwords stripped when image_query is absent', () => {
    expect(imageQuery({
      title: 'The Heart of the Ozarks',
      destination: 'Eureka Springs, AR',
    })).toBe('Heart Ozarks');
  });

  it('falls back to destination when neither image_query nor title is set', () => {
    expect(imageQuery({ destination: 'Marfa, TX' })).toBe('Marfa, TX');
  });

  it('returns an empty string when nothing is set', () => {
    expect(imageQuery({})).toBe('');
  });

  it('does not match image_query when it is a non-string truthy value', () => {
    // YAML coerces some values to booleans/numbers; only honour real strings
    // so we never feed something like `true` into a Pexels query string.
    expect(imageQuery({ title: 'Marfa', image_query: true }))
      .toBe('Marfa');
  });
});

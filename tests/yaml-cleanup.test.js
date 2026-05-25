/**
 * Tests for cleanupModelYaml — pre-parse repair for the column-1 wrapping
 * failures opus-class models reliably emit in <plan> / <candidates> blocks.
 *
 * Fixtures derived from the three real-world failures captured in the fresh-
 * clone walkthrough recorded on issue #417: two against mammoth-cave-kentucky
 * (description and dash variants) and one against new-glarus-swiss-village.
 * Each fixture is paired with a yaml.parse() roundtrip so we prove the
 * cleanup actually produces parseable output — not just "looks plausible."
 */

import { describe, it, expect } from 'vitest';
import { parse as yamlParse } from 'yaml';
import { cleanupModelYaml } from '../src/lib/server/yaml-cleanup.js';

describe('cleanupModelYaml', () => {
  it('returns empty string for non-string input', () => {
    expect(cleanupModelYaml(null)).toBe('');
    expect(cleanupModelYaml(undefined)).toBe('');
    expect(cleanupModelYaml(42)).toBe('');
  });

  it('passes valid YAML through unchanged (modulo line-ending normalization)', () => {
    const input = `stops:
  - name: "Place"
    description: "A single-line description that's already valid"
    category: historic`;
    expect(cleanupModelYaml(input)).toBe(input);
    expect(yamlParse(cleanupModelYaml(input))).toEqual({
      stops: [{ name: 'Place', description: "A single-line description that's already valid", category: 'historic' }],
    });
  });

  it('folds a column-1 continuation back onto its key line (the mammoth-cave failure)', () => {
    // Real shape from issue #417 — opus emitted `description:` with the
    // value wrapped to column 1 instead of staying inline. Strict YAML
    // reads the wrapped content as a new top-level implicit key and bails.
    const broken = `stops:
  - name: Mammoth Cave Historic Tour
    description:
The classic Mammoth Cave tour visiting historic areas that originally made it famous.
    category: historic`;
    expect(() => yamlParse(broken)).toThrow();

    const fixed = cleanupModelYaml(broken);
    const parsed = yamlParse(fixed);
    expect(parsed.stops[0].description).toBe(
      'The classic Mammoth Cave tour visiting historic areas that originally made it famous.'
    );
    expect(parsed.stops[0].category).toBe('historic');
  });

  it('folds a column-1 continuation under a bare list-item dash (the gotchas failure)', () => {
    // The second mammoth-cave attempt — same root cause, but the broken
    // emission was a `- ` bullet line with the value wrapped beneath.
    const broken = `gotchas:
  -
Cave tours frequently sell out and reservations are the only way to ensure a spot in peak season.`;
    expect(() => yamlParse(broken)).toThrow();

    const fixed = cleanupModelYaml(broken);
    const parsed = yamlParse(fixed);
    expect(parsed.gotchas).toEqual([
      'Cave tours frequently sell out and reservations are the only way to ensure a spot in peak season.',
    ]);
  });

  it('folds multi-line wrapped content into a single space-joined value', () => {
    const broken = `stops:
  - name: New Glarus Brewing
    description:
One of the largest female-owned breweries in the United States,
founded by Deb Carey in 1993 with her husband Daniel as brewmaster.
    category: food`;
    const fixed = cleanupModelYaml(broken);
    const parsed = yamlParse(fixed);
    expect(parsed.stops[0].description).toBe(
      'One of the largest female-owned breweries in the United States, founded by Deb Carey in 1993 with her husband Daniel as brewmaster.'
    );
  });

  it('does not fold a legitimate top-level key into the previous block', () => {
    // candidates.yaml normally has `stops:` followed by entries, then
    // `lodging:` as a sibling. The `lodging:` line starts at column 1 but
    // is a real new key — must not be merged into the last stop's value.
    const valid = `stops:
  - name: "First"
    description: "First place"
lodging:
  - name: "Hotel"
    description: "Hotel description"`;
    const cleaned = cleanupModelYaml(valid);
    const parsed = yamlParse(cleaned);
    expect(parsed.lodging).toHaveLength(1);
    expect(parsed.lodging[0].name).toBe('Hotel');
  });

  it('leaves a properly-indented block-scalar continuation alone', () => {
    // The model rarely uses `|` block scalars, but if it does we must not
    // touch them — the indented continuation is the value.
    const input = `description: |
  Line one of a block scalar.
  Line two stays indented.`;
    expect(cleanupModelYaml(input)).toBe(input);
    expect(yamlParse(cleanupModelYaml(input)).description.trim())
      .toBe('Line one of a block scalar.\nLine two stays indented.');
  });

  it('stops folding at a blank line', () => {
    // Two list entries with the first one having a wrapped value — the blank
    // line between them is the natural separator.
    const broken = `gotchas:
  -
First gotcha that wrapped.

  -
Second gotcha that also wrapped.`;
    const fixed = cleanupModelYaml(broken);
    const parsed = yamlParse(fixed);
    expect(parsed.gotchas).toEqual([
      'First gotcha that wrapped.',
      'Second gotcha that also wrapped.',
    ]);
  });

  it('normalizes CRLF line endings before processing', () => {
    const broken = 'stops:\r\n  - name: Foo\r\n    description:\r\nWrapped value here.';
    const fixed = cleanupModelYaml(broken);
    expect(fixed).not.toContain('\r');
    expect(yamlParse(fixed).stops[0].description).toBe('Wrapped value here.');
  });

  it('strips trailing whitespace from lines before deciding to fold', () => {
    // A key line with trailing spaces still counts as "empty after the colon"
    // and should trigger the fold.
    const broken = 'description:   \nThe value lives down here.';
    expect(yamlParse(cleanupModelYaml(broken))).toEqual({ description: 'The value lives down here.' });
  });
});

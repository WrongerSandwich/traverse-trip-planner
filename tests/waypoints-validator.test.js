// Unit tests for the isValidWaypoints validator (issue #350).
//
// The validator lives in src/lib/utils/waypoints.js — a pure isomorphic
// utility with no side-effects, so no mocks are needed.

import { describe, it, expect } from 'vitest';
import { isValidWaypoints } from '../src/lib/utils/waypoints.js';

describe('isValidWaypoints', () => {
  // ── Happy path ──────────────────────────────────────────────────────────────

  it('accepts an array of exactly 2 non-empty strings', () => {
    expect(isValidWaypoints(['Cleveland OH', 'Pittsburgh PA'])).toBe(true);
  });

  it('accepts an array of 3 or more non-empty strings', () => {
    expect(isValidWaypoints(['Cleveland OH', 'Sandusky OH', 'Toledo OH'])).toBe(true);
  });

  it('accepts strings that have internal whitespace (city + state)', () => {
    expect(isValidWaypoints(['Kansas City MO', 'Wichita KS'])).toBe(true);
  });

  // ── Array structure ─────────────────────────────────────────────────────────

  it('rejects a plain string (not an array)', () => {
    expect(isValidWaypoints('Cleveland OH, Pittsburgh PA')).toBe(false);
  });

  it('rejects a non-array object', () => {
    expect(isValidWaypoints({ 0: 'Cleveland OH', 1: 'Pittsburgh PA' })).toBe(false);
  });

  it('rejects null', () => {
    expect(isValidWaypoints(null)).toBe(false);
  });

  it('rejects undefined', () => {
    expect(isValidWaypoints(undefined)).toBe(false);
  });

  it('rejects a boolean (YAML coercion artifact)', () => {
    // YAML `not_an_array: true` would be parsed as a boolean.
    expect(isValidWaypoints(true)).toBe(false);
  });

  it('rejects a number', () => {
    expect(isValidWaypoints(42)).toBe(false);
  });

  // ── Array length ────────────────────────────────────────────────────────────

  it('rejects an empty array', () => {
    expect(isValidWaypoints([])).toBe(false);
  });

  it('rejects an array with only 1 entry', () => {
    expect(isValidWaypoints(['Cleveland OH'])).toBe(false);
  });

  // ── String content ──────────────────────────────────────────────────────────

  it('rejects an array where an entry is an empty string', () => {
    expect(isValidWaypoints(['Cleveland OH', ''])).toBe(false);
  });

  it('rejects an array where an entry is whitespace only', () => {
    expect(isValidWaypoints(['Cleveland OH', '   '])).toBe(false);
  });

  it('rejects an array where an entry is a non-string (number)', () => {
    expect(isValidWaypoints(['Cleveland OH', 42])).toBe(false);
  });

  it('rejects an array where an entry is a non-string (null)', () => {
    expect(isValidWaypoints(['Cleveland OH', null])).toBe(false);
  });

  it('rejects an array where an entry is a non-string (boolean)', () => {
    // YAML might coerce a bare `true` token inside a flow sequence.
    expect(isValidWaypoints(['Cleveland OH', true])).toBe(false);
  });

  it('rejects an array where every entry is empty', () => {
    expect(isValidWaypoints(['', ''])).toBe(false);
  });
});

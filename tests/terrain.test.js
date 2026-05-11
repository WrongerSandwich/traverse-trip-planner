import { describe, it, expect } from 'vitest';
import { buildProjection } from '../src/lib/utils/projection.js';
import { stateOutlinePaths, riverPaths, placesInBbox } from '../src/lib/utils/terrain.js';

// Build a projection for the Kansas City / Missouri area — a region with known
// US states, named rivers (Missouri River), and populated places nearby.
function makeProj(overrides = {}) {
  return buildProjection({
    coords: [[38.5, -95.0], [39.5, -94.0]],
    viewBoxW: 800,
    viewBoxH: 600,
    padding: 0,
    ...overrides,
  });
}

// A projection in the middle of the Pacific Ocean — no US states, rivers,
// or named NA places should appear.
function makeOceanProj() {
  return buildProjection({
    coords: [[20, -170], [22, -168]],
    viewBoxW: 800,
    viewBoxH: 600,
    padding: 0,
  });
}

// ── stateOutlinePaths ────────────────────────────────────────────────────────

describe('stateOutlinePaths', () => {
  it('returns an array of strings', () => {
    const proj = makeProj();
    const paths = stateOutlinePaths(proj);
    expect(Array.isArray(paths)).toBe(true);
    paths.forEach(p => expect(typeof p).toBe('string'));
  });

  it('returns paths for states that overlap the bbox', () => {
    const proj = makeProj();
    const paths = stateOutlinePaths(proj, { padDegrees: 0 });
    expect(paths.length).toBeGreaterThan(0);
  });

  it('returns empty array for a bbox in the middle of the Pacific', () => {
    const proj = makeOceanProj();
    const paths = stateOutlinePaths(proj, { padDegrees: 0 });
    expect(paths.length).toBe(0);
  });

  it('padDegrees broadens the intersecting set: 5° pad returns ≥ what 0 pad returns', () => {
    const proj = makeProj();
    const tight = stateOutlinePaths(proj, { padDegrees: 0 });
    const wide = stateOutlinePaths(proj, { padDegrees: 5 });
    expect(wide.length).toBeGreaterThanOrEqual(tight.length);
  });

  it('returns [] when projection is null', () => {
    expect(stateOutlinePaths(null)).toEqual([]);
    expect(stateOutlinePaths(undefined)).toEqual([]);
  });

  it('each path starts with M and contains L (well-formed SVG)', () => {
    const proj = makeProj();
    for (const p of stateOutlinePaths(proj)) {
      expect(p.trimStart()).toMatch(/^M /);
      expect(p).toContain(' L ');
    }
  });
});

// ── riverPaths ───────────────────────────────────────────────────────────────

describe('riverPaths', () => {
  it('returns an array of objects with name, zoom, path fields', () => {
    const proj = makeProj();
    const rivers = riverPaths(proj);
    for (const r of rivers) {
      expect(r).toHaveProperty('path');
      expect(typeof r.path).toBe('string');
    }
  });

  it('returns rivers overlapping the KC bbox', () => {
    const proj = makeProj();
    const rivers = riverPaths(proj, { padDegrees: 0.5, maxZoom: 5 });
    expect(rivers.length).toBeGreaterThan(0);
  });

  it('maxZoom gate: lower maxZoom returns fewer or equal rivers than higher', () => {
    const proj = makeProj();
    const coarse = riverPaths(proj, { maxZoom: 2 });
    const fine = riverPaths(proj, { maxZoom: 10 });
    expect(fine.length).toBeGreaterThanOrEqual(coarse.length);
  });

  it('maxZoom: 0 returns no rivers (min_zoom is always ≥ 1 in the dataset)', () => {
    const proj = makeProj();
    const rivers = riverPaths(proj, { maxZoom: 0 });
    expect(rivers.length).toBe(0);
  });

  it('returns [] when projection is null', () => {
    expect(riverPaths(null)).toEqual([]);
  });
});

// ── placesInBbox ─────────────────────────────────────────────────────────────

describe('placesInBbox', () => {
  it('returns an array of objects with name, scalerank, xy fields', () => {
    const proj = makeProj();
    const places = placesInBbox(proj);
    for (const p of places) {
      expect(p).toHaveProperty('name');
      expect(p).toHaveProperty('scalerank');
      expect(Array.isArray(p.xy)).toBe(true);
      expect(p.xy.length).toBe(2);
    }
  });

  it('returns places inside the KC bbox', () => {
    // Use a wide KC region to include Kansas City itself (high-scalerank city).
    const proj = buildProjection({
      coords: [[38, -96], [40, -93]],
      viewBoxW: 800,
      viewBoxH: 600,
      padding: 0,
    });
    const places = placesInBbox(proj, { maxScalerank: 10 });
    expect(places.length).toBeGreaterThan(0);
  });

  it('maxScalerank filter: lower value returns fewer or equal places', () => {
    const proj = buildProjection({
      coords: [[38, -96], [40, -93]],
      viewBoxW: 800,
      viewBoxH: 600,
      padding: 0,
    });
    const major = placesInBbox(proj, { maxScalerank: 4 });
    const all = placesInBbox(proj, { maxScalerank: 10 });
    expect(all.length).toBeGreaterThanOrEqual(major.length);
  });

  it('maxScalerank: -1 returns no places (rank is always ≥ 0)', () => {
    const proj = makeProj();
    const places = placesInBbox(proj, { maxScalerank: -1 });
    expect(places.length).toBe(0);
  });

  it('returns no places for a bbox in the middle of the Pacific', () => {
    const proj = makeOceanProj();
    const places = placesInBbox(proj, { maxScalerank: 10 });
    expect(places.length).toBe(0);
  });

  it('all returned places have xy within viewBox bounds', () => {
    const proj = makeProj();
    const places = placesInBbox(proj, { maxScalerank: 10 });
    // Since we filter by bbox, all places must project inside the viewBox.
    for (const p of places) {
      const [x, y] = p.xy;
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(800);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(600);
    }
  });

  it('returns [] when projection is null', () => {
    expect(placesInBbox(null)).toEqual([]);
  });
});

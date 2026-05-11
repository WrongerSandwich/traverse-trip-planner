import { describe, it, expect } from 'vitest';
import {
  buildProjection,
  buildMercatorProjection,
  chooseZoomForBbox,
  pathFromCoords,
} from '../src/lib/utils/projection.js';

// ── buildProjection ──────────────────────────────────────────────────────────

describe('buildProjection', () => {
  it('returns null for empty coords', () => {
    expect(buildProjection({ coords: [], viewBoxW: 800, viewBoxH: 600 })).toBe(null);
    expect(buildProjection({ coords: null, viewBoxW: 800, viewBoxH: 600 })).toBe(null);
  });

  it('handles a single point by synthesizing a bbox', () => {
    const proj = buildProjection({ coords: [[39, -95]], viewBoxW: 800, viewBoxH: 600 });
    expect(proj).not.toBe(null);
    // A single point must not produce an invalid (Infinity/-Infinity) projection.
    const [x, y] = proj.project(39, -95);
    expect(isFinite(x)).toBe(true);
    expect(isFinite(y)).toBe(true);
  });

  it('exposes bbox, scale, and cosLat', () => {
    const proj = buildProjection({
      coords: [[40, -90], [41, -89]],
      viewBoxW: 800,
      viewBoxH: 600,
      padding: 0,
    });
    expect(proj.bbox).toMatchObject({ minLat: 40, maxLat: 41, minLon: -90, maxLon: -89 });
    expect(proj.scale).toBeGreaterThan(0);
    expect(proj.cosLat).toBeGreaterThan(0);
    expect(proj.cosLat).toBeLessThanOrEqual(1);
  });

  it('projects bottom-left corner to high y and top-right to low y (SVG y-down)', () => {
    const proj = buildProjection({
      coords: [[40, -90], [41, -89]],
      viewBoxW: 800,
      viewBoxH: 600,
      padding: 0,
    });
    const [xBL, yBL] = proj.project(40, -90); // minLat, minLon → bottom-left
    const [xTR, yTR] = proj.project(41, -89); // maxLat, maxLon → top-right
    expect(xBL).toBeLessThan(xTR); // left of right
    expect(yBL).toBeGreaterThan(yTR); // below top (larger y = lower in SVG)
  });

  it('applies padding so extreme points do not reach the viewBox edge', () => {
    const proj = buildProjection({
      coords: [[40, -90], [41, -89]],
      viewBoxW: 800,
      viewBoxH: 600,
      padding: 0.1,
    });
    const [xBL, yBL] = proj.project(40, -90);
    const [xTR, yTR] = proj.project(41, -89);
    // With padding the extreme points must be inset from all four edges.
    expect(xBL).toBeGreaterThan(0);
    expect(yBL).toBeLessThan(600);
    expect(xTR).toBeLessThan(800);
    expect(yTR).toBeGreaterThan(0);
  });

  it('minSpanDeg expands a tight cluster to a usable scale', () => {
    // Two stops 0.01° apart — far less than minSpanDeg: 2.0.
    const tight = buildProjection({
      coords: [[39.00, -94.60], [39.01, -94.59]],
      viewBoxW: 800,
      viewBoxH: 600,
      padding: 0,
      minSpanDeg: 2.0,
    });
    const wide = buildProjection({
      coords: [[39.00, -94.60], [39.01, -94.59]],
      viewBoxW: 800,
      viewBoxH: 600,
      padding: 0,
      minSpanDeg: null,
    });
    // The expanded bbox must be at least as wide.
    const tightSpan = tight.bbox.maxLat - tight.bbox.minLat;
    const wideSpan = wide.bbox.maxLat - wide.bbox.minLat;
    expect(tightSpan).toBeGreaterThanOrEqual(2.0);
    expect(wideSpan).toBeLessThan(tightSpan);
  });

  it('scale is invariant: same aspect coords → same scale regardless of zoom', () => {
    const a = buildProjection({ coords: [[0, 0], [1, 1]], viewBoxW: 400, viewBoxH: 400, padding: 0 });
    const b = buildProjection({ coords: [[0, 0], [1, 1]], viewBoxW: 800, viewBoxH: 800, padding: 0 });
    // Scale doubles when viewBox doubles (lat-span is same, inner height doubles).
    expect(b.scale).toBeCloseTo(a.scale * 2, 0);
  });
});

// ── pathFromCoords ───────────────────────────────────────────────────────────

describe('pathFromCoords', () => {
  const fakeProject = (lat, lon) => [lon * 10, lat * 10];

  it('returns empty string for null/empty input', () => {
    expect(pathFromCoords(null, fakeProject)).toBe('');
    expect(pathFromCoords([], fakeProject)).toBe('');
    expect(pathFromCoords([[0, 0]], null)).toBe('');
  });

  it('produces a single M command for one point', () => {
    const d = pathFromCoords([[3, 5]], fakeProject);
    expect(d).toBe('M 50.0 30.0');
  });

  it('produces M … L … for multiple points', () => {
    const d = pathFromCoords([[0, 0], [1, 2], [3, 4]], fakeProject);
    expect(d).toMatch(/^M /);
    expect(d).toContain(' L ');
    // First segment must be M, rest L.
    const parts = d.split(' ').filter(t => t === 'M' || t === 'L');
    expect(parts[0]).toBe('M');
    expect(parts.slice(1).every(t => t === 'L')).toBe(true);
  });

  it('uses one decimal place in coordinates', () => {
    const d = pathFromCoords([[1.23456, 2.34567]], fakeProject);
    // fakeProject returns [23.4567, 12.3456]; toFixed(1) → "23.5" and "12.3"
    expect(d).toContain('23.5');
    expect(d).toContain('12.3');
  });
});

// ── chooseZoomForBbox ────────────────────────────────────────────────────────

describe('chooseZoomForBbox', () => {
  it('returns an integer in [1, 18]', () => {
    const bbox = { minLat: 38, maxLat: 40, minLon: -95, maxLon: -93 };
    const z = chooseZoomForBbox({ bbox, viewBoxW: 720, viewBoxH: 480 });
    expect(Number.isInteger(z)).toBe(true);
    expect(z).toBeGreaterThanOrEqual(1);
    expect(z).toBeLessThanOrEqual(18);
  });

  it('returns a higher zoom for a smaller bbox', () => {
    const small = { minLat: 38.9, maxLat: 39.1, minLon: -94.6, maxLon: -94.4 };
    const large = { minLat: 30, maxLat: 50, minLon: -110, maxLon: -70 };
    const zSmall = chooseZoomForBbox({ bbox: small, viewBoxW: 720, viewBoxH: 480 });
    const zLarge = chooseZoomForBbox({ bbox: large, viewBoxW: 720, viewBoxH: 480 });
    expect(zSmall).toBeGreaterThan(zLarge);
  });

  it('returns a lower zoom for a bigger viewBox (same bbox, more room → can go deeper)', () => {
    // Larger viewBox at same bbox → more pixels available → higher zoom.
    const bbox = { minLat: 38, maxLat: 40, minLon: -95, maxLon: -93 };
    const zSmallVB = chooseZoomForBbox({ bbox, viewBoxW: 100, viewBoxH: 100 });
    const zLargeVB = chooseZoomForBbox({ bbox, viewBoxW: 1000, viewBoxH: 1000 });
    expect(zLargeVB).toBeGreaterThanOrEqual(zSmallVB);
  });
});

// ── buildMercatorProjection ──────────────────────────────────────────────────

describe('buildMercatorProjection', () => {
  it('projects the center lat/lon to the viewBox center', () => {
    const VB_W = 720, VB_H = 480;
    const proj = buildMercatorProjection({
      centerLat: 39,
      centerLon: -94,
      zoom: 10,
      viewBoxW: VB_W,
      viewBoxH: VB_H,
    });
    const [cx, cy] = proj.project(39, -94);
    expect(cx).toBeCloseTo(VB_W / 2, 3);
    expect(cy).toBeCloseTo(VB_H / 2, 3);
  });

  it('projects points east of center to x > VB_W/2', () => {
    const VB_W = 720, VB_H = 480;
    const proj = buildMercatorProjection({ centerLat: 39, centerLon: -94, zoom: 10, viewBoxW: VB_W, viewBoxH: VB_H });
    const [x] = proj.project(39, -93); // 1° east
    expect(x).toBeGreaterThan(VB_W / 2);
  });

  it('projects points north of center to y < VB_H/2 (SVG y-down)', () => {
    const VB_W = 720, VB_H = 480;
    const proj = buildMercatorProjection({ centerLat: 39, centerLon: -94, zoom: 10, viewBoxW: VB_W, viewBoxH: VB_H });
    const [, y] = proj.project(40, -94); // 1° north
    expect(y).toBeLessThan(VB_H / 2);
  });

  it('exposes bbox, scale, cosLat, and zoom', () => {
    const proj = buildMercatorProjection({ centerLat: 39, centerLon: -94, zoom: 10, viewBoxW: 720, viewBoxH: 480 });
    expect(proj.zoom).toBe(10);
    expect(proj.scale).toBeGreaterThan(0);
    expect(proj.cosLat).toBeGreaterThan(0);
    expect(proj.bbox).toHaveProperty('minLat');
    expect(proj.bbox).toHaveProperty('maxLon');
  });

  it('bbox wraps the viewBox geographic extent: center must be inside', () => {
    const proj = buildMercatorProjection({ centerLat: 39, centerLon: -94, zoom: 10, viewBoxW: 720, viewBoxH: 480 });
    const { minLat, maxLat, minLon, maxLon } = proj.bbox;
    expect(39).toBeGreaterThan(minLat);
    expect(39).toBeLessThan(maxLat);
    expect(-94).toBeGreaterThan(minLon);
    expect(-94).toBeLessThan(maxLon);
  });
});

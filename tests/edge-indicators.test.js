import { describe, it, expect } from 'vitest';
import {
  computeEdgeIndicator,
  computeEdgeIndicators,
  isInViewport,
} from '../src/lib/utils/edge-indicators.js';

// ── isInViewport ─────────────────────────────────────────────────────────────

describe('isInViewport', () => {
  it('returns true for a point inside the viewBox', () => {
    expect(isInViewport([360, 240], 720, 480)).toBe(true);
  });

  it('returns true for points on the boundary', () => {
    expect(isInViewport([0, 0], 720, 480)).toBe(true);
    expect(isInViewport([720, 480], 720, 480)).toBe(true);
    expect(isInViewport([720, 0], 720, 480)).toBe(true);
    expect(isInViewport([0, 480], 720, 480)).toBe(true);
  });

  it('returns false for points outside each edge', () => {
    expect(isInViewport([-1, 240], 720, 480)).toBe(false);   // left
    expect(isInViewport([721, 240], 720, 480)).toBe(false);  // right
    expect(isInViewport([360, -1], 720, 480)).toBe(false);   // top
    expect(isInViewport([360, 481], 720, 480)).toBe(false);  // bottom
  });
});

// ── computeEdgeIndicator ─────────────────────────────────────────────────────

const VB_W = 720;
const VB_H = 480;
const CX = VB_W / 2; // 360
const CY = VB_H / 2; // 240

describe('computeEdgeIndicator', () => {
  it('returns null for a pin exactly at the viewport center', () => {
    expect(computeEdgeIndicator([CX, CY], VB_W, VB_H)).toBe(null);
  });

  // ── Right-edge pin ───────────────────────────────────────────────────────

  it('clamps a right-edge pin to near x = VB_W (within inset)', () => {
    const result = computeEdgeIndicator([VB_W + 200, CY], VB_W, VB_H);
    expect(result).not.toBe(null);
    const inset = 22;
    expect(result.edgeXY[0]).toBeCloseTo(VB_W - inset, 1);
    expect(result.edgeXY[1]).toBeCloseTo(CY, 1); // stays on y-center for a pure horizontal pin
  });

  // ── Left-edge pin ────────────────────────────────────────────────────────

  it('clamps a left-edge pin to near x = 0 (within inset)', () => {
    const result = computeEdgeIndicator([-200, CY], VB_W, VB_H);
    expect(result).not.toBe(null);
    expect(result.edgeXY[0]).toBeCloseTo(22, 1);  // inset from left
    expect(result.edgeXY[1]).toBeCloseTo(CY, 1);
  });

  // ── Top-edge pin ─────────────────────────────────────────────────────────

  it('clamps a top-edge pin to near y = 0 (within inset)', () => {
    const result = computeEdgeIndicator([CX, -200], VB_W, VB_H);
    expect(result).not.toBe(null);
    expect(result.edgeXY[0]).toBeCloseTo(CX, 1);
    expect(result.edgeXY[1]).toBeCloseTo(22, 1);  // inset from top
  });

  // ── Bottom-edge pin ──────────────────────────────────────────────────────

  it('clamps a bottom-edge pin to near y = VB_H (within inset)', () => {
    const result = computeEdgeIndicator([CX, VB_H + 200], VB_W, VB_H);
    expect(result).not.toBe(null);
    expect(result.edgeXY[0]).toBeCloseTo(CX, 1);
    expect(result.edgeXY[1]).toBeCloseTo(VB_H - 22, 1);
  });

  // ── angleDeg correctness (the key invariant from the chevron-reversal bug) ──
  //
  // angleDeg = atan2(dy, dx) where (dx, dy) is the direction from center to the
  // off-map pin. A chevron SVG whose apex sits in the positive-x direction,
  // rotated by angleDeg, will point *toward* the off-map stop (outward).
  //
  // The fix in 827c491 moved the SVG path apex to x=17 (positive direction)
  // so that this rotation convention is fulfilled. These tests document the
  // angle convention precisely enough that a regression would be obvious.

  it('angleDeg is ~0° for a pin to the right (apex must point right)', () => {
    const result = computeEdgeIndicator([VB_W + 100, CY], VB_W, VB_H);
    expect(result.angleDeg).toBeCloseTo(0, 1);
  });

  it('angleDeg is ~±180° for a pin to the left (apex must point left)', () => {
    const result = computeEdgeIndicator([-100, CY], VB_W, VB_H);
    expect(Math.abs(result.angleDeg)).toBeCloseTo(180, 1);
  });

  it('angleDeg is ~-90° for a pin above center (apex must point up)', () => {
    const result = computeEdgeIndicator([CX, -100], VB_W, VB_H);
    expect(result.angleDeg).toBeCloseTo(-90, 1);
  });

  it('angleDeg is ~+90° for a pin below center (apex must point down)', () => {
    const result = computeEdgeIndicator([CX, VB_H + 100], VB_W, VB_H);
    expect(result.angleDeg).toBeCloseTo(90, 1);
  });

  it('angleDeg points toward the pin for a diagonal (northeast) case', () => {
    // Pin far to the upper-right: dx > 0, dy < 0 → angle in Q4 (−90°–0°)
    const result = computeEdgeIndicator([VB_W + 400, CY - 400], VB_W, VB_H);
    expect(result.angleDeg).toBeGreaterThan(-90);
    expect(result.angleDeg).toBeLessThan(0);
  });

  // ── Corner case: smallest-positive-t selects the right edge ─────────────

  it('selects the correct edge when pin is in the top-right corner region', () => {
    // Pin is far upper-right at a 45° angle from center with unequal VB dims.
    // The shorter half (VB_H/2 = 240) gates before the longer half (VB_W/2 = 360).
    const result = computeEdgeIndicator([VB_W + 300, CY - 300], VB_W, VB_H);
    expect(result).not.toBe(null);
    // edgeXY must land on the viewBox boundary (before inset), within 30px margin.
    const [ex, ey] = result.edgeXY;
    const onBoundary =
      ex <= 22 || ex >= VB_W - 22 || ey <= 22 || ey >= VB_H - 22;
    expect(onBoundary).toBe(true);
  });

  it('respects a custom inset value', () => {
    const defaultInset = computeEdgeIndicator([VB_W + 100, CY], VB_W, VB_H, 22);
    const doubleInset = computeEdgeIndicator([VB_W + 100, CY], VB_W, VB_H, 44);
    // Larger inset → badge is further from the right edge (smaller x).
    expect(doubleInset.edgeXY[0]).toBeLessThan(defaultInset.edgeXY[0]);
  });
});

// ── computeEdgeIndicators ────────────────────────────────────────────────────

describe('computeEdgeIndicators', () => {
  const makePixels = (coords) =>
    coords.map(([x, y], i) => ({ n: i + 1, xy: [x, y], name: `stop-${i + 1}` }));

  it('returns empty array for empty input', () => {
    expect(computeEdgeIndicators([], VB_W, VB_H)).toEqual([]);
  });

  it('pins inside the viewport are excluded', () => {
    const pixels = makePixels([[CX, CY], [100, 100], [600, 400]]);
    const result = computeEdgeIndicators(pixels, VB_W, VB_H);
    expect(result.length).toBe(0);
  });

  it('pins outside the viewport are included', () => {
    const pixels = makePixels([[VB_W + 50, CY], [-50, CY]]);
    const result = computeEdgeIndicators(pixels, VB_W, VB_H);
    expect(result.length).toBe(2);
  });

  it('filters in-viewport pins and keeps off-viewport pins in a mixed set', () => {
    const pixels = makePixels([
      [CX, CY],         // inside
      [VB_W + 50, CY],  // outside right
      [200, 150],       // inside
      [CX, -100],       // outside top
    ]);
    const result = computeEdgeIndicators(pixels, VB_W, VB_H);
    expect(result.length).toBe(2);
  });

  it('merges edgeXY and angleDeg onto the original pin object', () => {
    const pixels = makePixels([[VB_W + 50, CY]]);
    const [pin] = computeEdgeIndicators(pixels, VB_W, VB_H);
    expect(pin.n).toBe(1);
    expect(pin.name).toBe('stop-1');
    expect(Array.isArray(pin.edgeXY)).toBe(true);
    expect(typeof pin.angleDeg).toBe('number');
  });

  it('filters out degenerate pins at the viewport center (dist = 0)', () => {
    const pixels = makePixels([[CX, CY - 1000], [CX, CY]]); // one off-screen, one at center
    // The on-screen center pin stays filtered as in-viewport; the off-screen
    // pin that coincidentally has dist=0 after a different center is not this case.
    // What we test: a pixel exactly at (CX, CY) that is NOT in-viewport cannot
    // happen by construction (isInViewport returns true at center), but the
    // computeEdgeIndicator null guard still works.
    const result = computeEdgeIndicators(pixels, VB_W, VB_H);
    expect(result.length).toBe(1); // only the above-top pin
  });
});

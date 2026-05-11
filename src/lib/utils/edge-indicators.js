// Edge-indicator math: for pins that fall outside the visible viewBox, compute
// a clamped position on the viewport boundary (pulled inward by `inset` px)
// and an angle pointing from that badge toward the actual off-map location.
//
// Extracted from DestinationMap.svelte so the geometry can be unit-tested.
// The angle convention matches SVG rotation: 0° = positive-x (right), 90° =
// positive-y (down). A chevron whose apex is in the positive-x direction,
// rotated by angleDeg, will point toward the off-map stop.

/**
 * For a single off-viewport pin, compute the badge position and direction.
 *
 * @param {[number, number]} pinXY   - pixel coords of the pin (may be outside viewBox)
 * @param {number} viewBoxW
 * @param {number} viewBoxH
 * @param {number} inset             - px to pull the badge inside the viewport edge
 * @returns {{ edgeXY: [number, number], angleDeg: number } | null}
 *   null when the pin is exactly at the viewport center (degenerate case)
 */
export function computeEdgeIndicator(pinXY, viewBoxW, viewBoxH, inset = 22) {
  const cx = viewBoxW / 2;
  const cy = viewBoxH / 2;
  const dx = pinXY[0] - cx;
  const dy = pinXY[1] - cy;
  const dist = Math.hypot(dx, dy);
  if (dist === 0) return null;

  // Find the smallest positive t where the parametric ray from center hits a boundary.
  const ts = [];
  if (dx < 0) ts.push(-cx / dx);              // left edge  (x = 0)
  if (dx > 0) ts.push((viewBoxW - cx) / dx);  // right edge (x = viewBoxW)
  if (dy < 0) ts.push(-cy / dy);              // top edge   (y = 0)
  if (dy > 0) ts.push((viewBoxH - cy) / dy);  // bottom edge (y = viewBoxH)

  const tEdge = Math.min(...ts);
  const tInset = Math.max(0, tEdge - inset / dist);

  return {
    edgeXY: [cx + dx * tInset, cy + dy * tInset],
    angleDeg: Math.atan2(dy, dx) * 180 / Math.PI,
  };
}

/**
 * Filter an array of projected pins to those outside the viewport and compute
 * their edge indicators. Each returned object merges the original pin with
 * `edgeXY` and `angleDeg`.
 *
 * @param {Array<{ xy: [number, number], [key: string]: any }>} pixels
 * @param {number} viewBoxW
 * @param {number} viewBoxH
 * @param {number} inset
 */
export function computeEdgeIndicators(pixels, viewBoxW, viewBoxH, inset = 22) {
  return pixels
    .filter(p => !isInViewport(p.xy, viewBoxW, viewBoxH))
    .map(p => {
      const result = computeEdgeIndicator(p.xy, viewBoxW, viewBoxH, inset);
      if (!result) return null;
      return { ...p, ...result };
    })
    .filter(Boolean);
}

/**
 * Returns true if [x, y] is inside (or on the boundary of) the viewBox.
 */
export function isInViewport(xy, viewBoxW, viewBoxH) {
  return xy[0] >= 0 && xy[0] <= viewBoxW && xy[1] >= 0 && xy[1] <= viewBoxH;
}

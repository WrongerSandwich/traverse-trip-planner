// Equirectangular projection scaled to a viewBox + padding, with cos(centerLat)
// longitude compensation so east-west distances are visually proportional to
// north-south. Shared by PaperMap and DestinationMap; same math + same math
// shape so terrain layers and route layers line up when rendered together.
//
// Pass coords as [[lat, lon], …]; project() returns [x, y] in viewBox units.

// Minimum span the data bbox must occupy. When the coords are clustered
// tighter than this (e.g., stops in a single town), the bbox is expanded
// outward so the map shows surrounding geographic context — nearby
// towns, rivers, state borders — instead of a building-block view.
// Specified in degrees of *latitude* (≈ 69 mi/deg).
//
// Passing `minSpanDeg: null` disables the floor and uses the raw bbox.
export function buildProjection({ coords, viewBoxW, viewBoxH, padding = 0.08, minSpanDeg = null }) {
  if (!coords || coords.length < 1) return null;

  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  for (const [lat, lon] of coords) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
  }

  // Single-point input: synthesize a small bbox so projection still works.
  if (minLat === maxLat) { minLat -= 0.25; maxLat += 0.25; }
  if (minLon === maxLon) { minLon -= 0.25; maxLon += 0.25; }

  // Apply minimum-span floor — expands tight clusters out to a usable scale.
  if (minSpanDeg) {
    const centerLatPre = (minLat + maxLat) / 2;
    const cosCenter = Math.cos(centerLatPre * Math.PI / 180);
    const latSpan = maxLat - minLat;
    const lonSpan = (maxLon - minLon) * cosCenter;
    if (latSpan < minSpanDeg) {
      const pad = (minSpanDeg - latSpan) / 2;
      minLat -= pad; maxLat += pad;
    }
    if (lonSpan < minSpanDeg) {
      const padDeg = (minSpanDeg - lonSpan) / 2 / cosCenter;
      minLon -= padDeg; maxLon += padDeg;
    }
  }

  const centerLat = (minLat + maxLat) / 2;
  const cosLat = Math.cos(centerLat * Math.PI / 180);

  const lonRange = Math.max((maxLon - minLon) * cosLat, 0.0001);
  const latRange = Math.max(maxLat - minLat, 0.0001);

  const padX = viewBoxW * padding;
  const padY = viewBoxH * padding;
  const innerW = viewBoxW - 2 * padX;
  const innerH = viewBoxH - 2 * padY;

  const scale = Math.min(innerW / lonRange, innerH / latRange);
  const usedW = lonRange * scale;
  const usedH = latRange * scale;
  const offsetX = padX + (innerW - usedW) / 2;
  const offsetY = padY + (innerH - usedH) / 2;

  function project(lat, lon) {
    return [
      offsetX + (lon - minLon) * cosLat * scale,
      offsetY + (maxLat - lat) * scale, // SVG y-down → flip
    ];
  }

  return {
    project,
    scale,
    cosLat,
    bbox: { minLat, maxLat, minLon, maxLon },
  };
}

/**
 * Build a route SVG path string ("M x y L x y …") from projected coords.
 * Skips invalid coords gracefully.
 */
export function pathFromCoords(coords, project) {
  if (!coords?.length || !project) return '';
  return coords
    .map(([lat, lon], i) => {
      const [x, y] = project(lat, lon);
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');
}

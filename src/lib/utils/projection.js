// Equirectangular projection scaled to a viewBox + padding, with cos(centerLat)
// longitude compensation so east-west distances are visually proportional to
// north-south. Shared by PaperMap and DestinationMap; same math + same math
// shape so terrain layers and route layers line up when rendered together.
//
// Pass coords as [[lat, lon], …]; project() returns [x, y] in viewBox units.

export function buildProjection({ coords, viewBoxW, viewBoxH, padding = 0.08 }) {
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

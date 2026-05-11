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

// ── Web Mercator (for static-tile overlays) ───────────────────────────
//
// Stadia (and Mapbox, MapLibre, Google, OSM, ...) all serve raster tiles
// in Web Mercator. To draw pins/route/etc. *on top* of a Stadia static
// map and have them land precisely on roads and landmarks, our SVG
// coordinate space has to match the same projection at the same zoom.
//
// Equirectangular (what `buildProjection` uses) is fine for standalone
// brochure-illustration maps, but drifts visibly when overlaid on
// Mercator tiles. Use `buildMercatorProjection` whenever a real tile
// base layer is involved.

const TILE_SIZE = 256;

function lonToMercX(lon, zoom) {
  return (lon + 180) / 360 * TILE_SIZE * (2 ** zoom);
}
function latToMercY(lat, zoom) {
  const radLat = lat * Math.PI / 180;
  return (1 - Math.log(Math.tan(radLat) + 1 / Math.cos(radLat)) / Math.PI) / 2 * TILE_SIZE * (2 ** zoom);
}
function mercXToLon(x, zoom) {
  return (x / (TILE_SIZE * 2 ** zoom)) * 360 - 180;
}
function mercYToLat(y, zoom) {
  const n = Math.PI - 2 * Math.PI * (y / (TILE_SIZE * 2 ** zoom));
  return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

/**
 * Pick the largest integer zoom level whose Mercator projection of the
 * given bbox fits inside a viewBox (with padding margin). Used to size
 * a tile-based base map to the trip's stops cluster.
 */
export function chooseZoomForBbox({ bbox, viewBoxW, viewBoxH, padding = 0.08 }) {
  const innerW = viewBoxW * (1 - 2 * padding);
  const innerH = viewBoxH * (1 - 2 * padding);
  const xSpan0 = lonToMercX(bbox.maxLon, 0) - lonToMercX(bbox.minLon, 0);
  const ySpan0 = latToMercY(bbox.minLat, 0) - latToMercY(bbox.maxLat, 0);
  if (xSpan0 <= 0 || ySpan0 <= 0) return 10;
  const zoomX = Math.log2(innerW / xSpan0);
  const zoomY = Math.log2(innerH / ySpan0);
  const z = Math.floor(Math.min(zoomX, zoomY));
  return Math.max(1, Math.min(18, z));
}

/**
 * Web-Mercator projection centered on (centerLat, centerLon) at integer
 * zoom, returning pixel coords in the viewBox. Exposes the matching
 * inverse bbox so terrain helpers (state outlines etc.) can still filter
 * by geographic bbox if rendered alongside.
 */
export function buildMercatorProjection({ centerLat, centerLon, zoom, viewBoxW, viewBoxH }) {
  const centerX = lonToMercX(centerLon, zoom);
  const centerY = latToMercY(centerLat, zoom);

  function project(lat, lon) {
    return [
      lonToMercX(lon, zoom) - centerX + viewBoxW / 2,
      latToMercY(lat, zoom) - centerY + viewBoxH / 2,
    ];
  }

  const halfW = viewBoxW / 2;
  const halfH = viewBoxH / 2;
  const bbox = {
    minLon: mercXToLon(centerX - halfW, zoom),
    maxLon: mercXToLon(centerX + halfW, zoom),
    maxLat: mercYToLat(centerY - halfH, zoom),
    minLat: mercYToLat(centerY + halfH, zoom),
  };

  // Match equirectangular's `scale` shape — viewBox units per
  // cos-lat-compensated degree of longitude — so callers using
  // `69 / scale` get correct miles-per-unit at centerLat.
  const cosLat = Math.cos(centerLat * Math.PI / 180);
  const scale = (TILE_SIZE * (2 ** zoom) / 360) / Math.max(cosLat, 0.0001);

  return { project, zoom, bbox, scale, cosLat };
}

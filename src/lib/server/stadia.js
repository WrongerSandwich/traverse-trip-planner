// Stadia Maps tile-mosaic builder.
//
// Stadia's "Static Map" image endpoint is paid-tier only; the "Styled Map
// Tiles" tile endpoint is available on the free tier. Rather than asking
// Stadia for one composed PNG, we compute which standard slippy-map tiles
// cover the requested viewport and return an array of {url, x, y, w, h}
// records. DestinationMap.svelte renders each as an <image> inside the
// SVG; the browser composites them natively. Pin overlays use the same
// Mercator projection (buildMercatorProjection) so they align pixel-for-
// pixel with the tile mosaic.
//
// URLs are same-origin proxy paths (/api/stadia-tile?...) — never direct
// Stadia URLs, so STADIA_API_KEY never reaches the browser. See the
// matching endpoint in src/routes/api/stadia-tile/+server.js.
//
// Returns null when STADIA_API_KEY is unset OR when the key fails a probe
// against the tile endpoint (expired, revoked, paid-tier mismatch, etc).
// The caller (DestinationMap) then falls back to its illustrative-paper
// rendering with state outlines and rivers, instead of emitting tile
// URLs the browser would fail to load — that would leave pins floating
// over a blank rectangle.

import { resolveEnv } from './settings.js';

const TILE_SIZE = 256;
const PROBE_TTL_MS = 5 * 60 * 1000;
const STADIA_TILES_ENDPOINT = 'https://tiles.stadiamaps.com/tiles';

function lonToMercX(lon, zoom) {
  return ((lon + 180) / 360) * TILE_SIZE * (2 ** zoom);
}
function latToMercY(lat, zoom) {
  const radLat = (lat * Math.PI) / 180;
  return (
    (1 - Math.log(Math.tan(radLat) + 1 / Math.cos(radLat)) / Math.PI) / 2 *
    TILE_SIZE *
    (2 ** zoom)
  );
}

// In-process probe cache. Keyed by `${apiKey}:${style}:${retina}` so a key
// rotation, a style change, or toggling retina each invalidate naturally.
// Stores { ok: boolean, expiresAt: ms }. Short TTL because a key that
// just started working should be picked up promptly without a restart.
const probeCache = new Map();

export function _resetProbeCacheForTest() {
  probeCache.clear();
}

async function probeKey({ apiKey, style, retina }) {
  const cacheKey = `${apiKey}:${style}:${retina ? '2x' : '1x'}`;
  const cached = probeCache.get(cacheKey);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.ok;

  // Probe with the world tile (z=0/x=0/y=0) of the requested style. Smallest
  // possible payload (~10 KB) and a canonical URL that proves the key works
  // for tile requests at this style. Network failures are treated as a
  // soft-fail — better to fall back to the illustrative map than show
  // broken tile images.
  const suffix = retina ? '@2x' : '';
  const url = `${STADIA_TILES_ENDPOINT}/${style}/0/0/0${suffix}.png?api_key=${encodeURIComponent(apiKey)}`;
  let ok = false;
  try {
    const res = await fetch(url);
    ok = res.ok;
    if (res.body) await res.body.cancel().catch(() => {});
  } catch {
    ok = false;
  }
  probeCache.set(cacheKey, { ok, expiresAt: now + PROBE_TTL_MS });
  return ok;
}

/**
 * Compute the tile mosaic that covers `viewBoxW × viewBoxH` SVG units
 * centered on (centerLat, centerLon) at integer `zoom`. Each tile occupies
 * TILE_SIZE × TILE_SIZE SVG units; retina (@2x) variants render in the
 * same footprint at twice the pixel density.
 *
 * Returns { tiles: [{ url, x, y, w, h }, …], centerLat, centerLon, zoom }
 * or null when no API key is configured, or when a probe of the tile
 * endpoint fails (so callers don't emit URLs the browser would fail to
 * load).
 */
export async function stadiaTileMosaic({
  centerLat,
  centerLon,
  zoom,
  viewBoxW,
  viewBoxH,
  style = 'outdoors',
  retina = true,
}) {
  const apiKey = resolveEnv('STADIA_API_KEY');
  if (!apiKey) return null;

  const keyWorks = await probeKey({ apiKey, style, retina });
  if (!keyWorks) return null;

  const z = Math.round(zoom);
  const maxTile = 2 ** z - 1;

  const centerX = lonToMercX(centerLon, z);
  const centerY = latToMercY(centerLat, z);

  // Viewport in world-pixel coordinates (top-left origin).
  const left = centerX - viewBoxW / 2;
  const top = centerY - viewBoxH / 2;
  const right = left + viewBoxW;
  const bottom = top + viewBoxH;

  // Tile range that fully covers the viewport. Clamp Y to valid tile
  // range; Mercator has no tiles above ~85°N / below -85°S. X wraps
  // around the antimeridian in Stadia's tile scheme, but every trip in
  // scope is drivable from a single home, so wrap is irrelevant in
  // practice — clamp anyway to stay defensive.
  const tileMinX = Math.max(0, Math.floor(left / TILE_SIZE));
  const tileMaxX = Math.min(maxTile, Math.floor((right - 1e-6) / TILE_SIZE));
  const tileMinY = Math.max(0, Math.floor(top / TILE_SIZE));
  const tileMaxY = Math.min(maxTile, Math.floor((bottom - 1e-6) / TILE_SIZE));

  const tiles = [];
  for (let ty = tileMinY; ty <= tileMaxY; ty++) {
    for (let tx = tileMinX; tx <= tileMaxX; tx++) {
      const params = new URLSearchParams({
        z: String(z),
        x: String(tx),
        y: String(ty),
        style,
      });
      if (retina) params.set('r', '2x');
      tiles.push({
        url: `/api/stadia-tile?${params}`,
        x: tx * TILE_SIZE - left,
        y: ty * TILE_SIZE - top,
        w: TILE_SIZE,
        h: TILE_SIZE,
      });
    }
  }

  return { tiles, centerLat, centerLon, zoom: z };
}

export function stadiaEnabled() {
  return Boolean(resolveEnv('STADIA_API_KEY'));
}

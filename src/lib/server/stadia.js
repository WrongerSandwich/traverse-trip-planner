// Stadia Maps static-map URL builder.
//
// Returns a same-origin proxy URL (/api/stadia-map?...) — never the direct
// Stadia URL with the embedded api_key, since that would leak the key to
// anyone with view-source access, including public /share/<token>/brochure
// recipients. See #265 and src/routes/api/stadia-map/+server.js.
//
// The proxy fetches the upstream image with the key injected server-side
// and returns it with a long Cache-Control so repeated brochure loads hit
// the browser cache rather than re-traversing the proxy.
//
// Returns null when STADIA_API_KEY is unset — the caller (DestinationMap)
// then falls back to its illustrative-paper rendering with state outlines
// and rivers.

import { resolveEnv } from './settings.js';

export function stadiaStaticMapUrl({ centerLat, centerLon, zoom, width, height, style = 'outdoors', retina = true }) {
  if (!resolveEnv('STADIA_API_KEY')) return null;

  // Cap dims to free-tier max; round to integers.
  const w = Math.min(Math.round(width), 2048);
  const h = Math.min(Math.round(height), 2048);
  const sizeSuffix = retina ? '@2x' : '';

  // Stadia rejects center coords with too many decimals; round for cache hits.
  const lat = centerLat.toFixed(5);
  const lon = centerLon.toFixed(5);

  const params = new URLSearchParams({
    center: `${lat},${lon}`,
    zoom: String(zoom),
    size: `${w}x${h}${sizeSuffix}`,
    style,
  });
  return `/api/stadia-map?${params}`;
}

export function stadiaEnabled() {
  return Boolean(resolveEnv('STADIA_API_KEY'));
}

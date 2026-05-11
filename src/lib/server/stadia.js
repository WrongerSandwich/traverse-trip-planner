// Stadia Maps static-map URL builder.
//
// Each trip's destination map is one Stadia request; Stadia serves the
// resulting image through their CDN with their own caching, so we don't
// need a per-trip image cache file on our side. The URL is deterministic
// from (style, center, zoom, size), and the same URL across page loads
// hits Stadia's CDN, not their tile renderer.
//
// Returns null when STADIA_API_KEY is unset — the caller (DestinationMap)
// then falls back to its illustrative-paper rendering with state outlines
// and rivers.

const ENDPOINT = 'https://tiles.stadiamaps.com/static';

export function stadiaStaticMapUrl({ centerLat, centerLon, zoom, width, height, style = 'outdoors', retina = true }) {
  const apiKey = process.env.STADIA_API_KEY;
  if (!apiKey) return null;

  // Stadia accepts size up to 2048×2048 for free tier (and larger paid);
  // request the @2x retina variant when asked, capped at sensible print
  // resolution to stay within free-tier limits.
  const w = Math.min(Math.round(width), 2048);
  const h = Math.min(Math.round(height), 2048);
  const sizeSuffix = retina ? '@2x' : '';

  // Stadia rejects center coords with too many decimals; round.
  const lat = centerLat.toFixed(5);
  const lon = centerLon.toFixed(5);

  const params = new URLSearchParams({
    center: `${lat},${lon}`,
    zoom: String(zoom),
    size: `${w}x${h}${sizeSuffix}`,
    api_key: apiKey,
  });

  return `${ENDPOINT}/${style}.png?${params}`;
}

export function stadiaEnabled() {
  return Boolean(process.env.STADIA_API_KEY);
}

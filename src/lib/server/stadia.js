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

import { resolveEnv } from './settings.js';

const ENDPOINT = 'https://tiles.stadiamaps.com/static';

export function stadiaStaticMapUrl({ centerLat, centerLon, zoom, width, height, style = 'outdoors', retina = true }) {
  const apiKey = resolveEnv('STADIA_API_KEY');
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
  return Boolean(resolveEnv('STADIA_API_KEY'));
}

// Tile URL template for Leaflet's `L.tileLayer()`. Stadia's
// `alidade_smooth_dark` is a softer dark style than CartoDB Dark Matter —
// warm grays with visible roads and labels rather than near-black canvas.
// Falls back to CartoDB Dark Matter (no API key needed) when Stadia
// isn't configured.
//
// Note: this URL is rendered into client-side HTML, so the API key
// reaches the browser. Stadia supports domain-restricted keys via their
// dashboard for self-hosted apps; on a personal home server the risk
// of key leakage is low.
export function darkTileUrlTemplate() {
  const apiKey = resolveEnv('STADIA_API_KEY');
  if (apiKey) {
    return `https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png?api_key=${apiKey}`;
  }
  return 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
}

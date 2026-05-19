// GET /api/stadia-map?center=lat,lon&zoom=N&size=WxH[@2x]&style=outdoors
//
// Proxies Stadia static-map images so STADIA_API_KEY never reaches the
// browser. The previous implementation (src/lib/server/stadia.js) embedded
// the key in the query string of the <image href=...> rendered into the
// brochure SVG, which leaked it to anyone who could view source — including
// public share-URL recipients. See #265.
//
// Inputs are strictly validated so the proxy can't be coerced into burning
// the key on arbitrary Stadia requests. Style is allowlisted (only the
// 'outdoors' value the brochure pipeline uses today). Size is capped to
// 2048×2048 + optional @2x retina suffix, matching the Stadia free tier.
//
// Caching: pass through Stadia's response with a generous Cache-Control so
// repeated brochure loads hit the browser cache, not our server.

import { resolveEnv } from '$lib/server/settings.js';
import { rateLimitResponse } from '$lib/server/rate-limit.js';

const STADIA_ENDPOINT = 'https://tiles.stadiamaps.com/static';
const ALLOWED_STYLES = new Set(['outdoors']);
const MAX_DIM = 2048;

function badInput(msg) {
  return new Response(JSON.stringify({ error: msg, code: 'invalid_input' }), {
    status: 400,
    headers: { 'content-type': 'application/json' },
  });
}

export async function GET(event) {
  const apiKey = resolveEnv('STADIA_API_KEY');
  if (!apiKey) {
    return new Response('Stadia key not configured', { status: 503 });
  }

  const limited = rateLimitResponse({ event, endpoint: 'stadia-map' });
  if (limited) return limited;

  const params = event.url.searchParams;
  const center = params.get('center') ?? '';
  const zoomStr = params.get('zoom') ?? '';
  const sizeStr = params.get('size') ?? '';
  const style = params.get('style') ?? 'outdoors';

  if (!ALLOWED_STYLES.has(style)) return badInput(`style must be one of: ${[...ALLOWED_STYLES].join(', ')}`);

  const centerMatch = /^(-?\d{1,3}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)$/.exec(center);
  if (!centerMatch) return badInput('center must be "lat,lon" decimal numbers');
  const lat = Number(centerMatch[1]);
  const lon = Number(centerMatch[2]);
  if (!(lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180)) return badInput('center coordinates out of range');

  const zoom = Number(zoomStr);
  if (!Number.isInteger(zoom) || zoom < 1 || zoom > 20) return badInput('zoom must be an integer 1..20');

  const sizeMatch = /^(\d{1,4})x(\d{1,4})(@2x)?$/.exec(sizeStr);
  if (!sizeMatch) return badInput('size must be "WxH" or "WxH@2x"');
  const w = Number(sizeMatch[1]);
  const h = Number(sizeMatch[2]);
  if (w < 1 || w > MAX_DIM || h < 1 || h > MAX_DIM) return badInput(`size dimensions must be 1..${MAX_DIM}`);
  const retinaSuffix = sizeMatch[3] ?? '';

  const upstream = new URLSearchParams({
    center: `${lat.toFixed(5)},${lon.toFixed(5)}`,
    zoom: String(zoom),
    size: `${w}x${h}${retinaSuffix}`,
    api_key: apiKey,
  });
  const upstreamUrl = `${STADIA_ENDPOINT}/${style}.png?${upstream}`;

  const res = await fetch(upstreamUrl, { signal: event.request.signal });
  if (!res.ok) {
    return new Response(`Stadia upstream returned ${res.status}`, { status: res.status === 401 ? 502 : res.status });
  }

  const headers = new Headers();
  headers.set('content-type', res.headers.get('content-type') ?? 'image/png');
  headers.set('cache-control', 'public, max-age=86400, immutable');
  return new Response(res.body, { status: 200, headers });
}

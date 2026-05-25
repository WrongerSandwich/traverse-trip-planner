// GET /api/stadia-tile?z=N&x=N&y=N&style=outdoors[&r=2x]
//
// Proxies individual Stadia "Styled Map Tiles" so STADIA_API_KEY never
// reaches the browser. Replaces the older static-map proxy: Stadia's
// static-image endpoint is paid-tier only, but the tile endpoint is
// available on all tiers including the free Basic plan. The brochure
// composes its destination map by stitching the tile mosaic returned by
// stadiaTileMosaic() (src/lib/server/stadia.js) into the SVG via
// <image> elements.
//
// Inputs are strictly validated. Style is allowlisted; tile coordinates
// must be valid for the given zoom. Retina ("r=2x") is optional.
//
// Caching: pass through Stadia's response with a generous Cache-Control
// so repeated brochure loads hit the browser cache rather than re-
// traversing the proxy. Tile URLs are stable for a given (z, x, y,
// style, r) so cache hits are common across reloads of the same brochure.

import { resolveEnv } from '$lib/server/settings.js';
import { rateLimitResponse } from '$lib/server/rate-limit.js';

const STADIA_TILES_ENDPOINT = 'https://tiles.stadiamaps.com/tiles';
const ALLOWED_STYLES = new Set(['outdoors']);
const ALLOWED_RETINA = new Set(['', '2x']);
const MAX_ZOOM = 20;

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

  const limited = rateLimitResponse({ event, endpoint: 'stadia-tile' });
  if (limited) return limited;

  const params = event.url.searchParams;
  const zStr = params.get('z') ?? '';
  const xStr = params.get('x') ?? '';
  const yStr = params.get('y') ?? '';
  const style = params.get('style') ?? 'outdoors';
  const retina = params.get('r') ?? '';

  if (!ALLOWED_STYLES.has(style)) return badInput(`style must be one of: ${[...ALLOWED_STYLES].join(', ')}`);
  if (!ALLOWED_RETINA.has(retina)) return badInput('r must be "2x" or omitted');

  const z = Number(zStr);
  if (!Number.isInteger(z) || z < 0 || z > MAX_ZOOM) return badInput(`z must be an integer 0..${MAX_ZOOM}`);

  const x = Number(xStr);
  const y = Number(yStr);
  const maxTile = 2 ** z - 1;
  if (!Number.isInteger(x) || x < 0 || x > maxTile) return badInput(`x must be an integer 0..${maxTile} for zoom ${z}`);
  if (!Number.isInteger(y) || y < 0 || y > maxTile) return badInput(`y must be an integer 0..${maxTile} for zoom ${z}`);

  const suffix = retina ? '@2x' : '';
  const upstreamUrl = `${STADIA_TILES_ENDPOINT}/${style}/${z}/${x}/${y}${suffix}.png?api_key=${encodeURIComponent(apiKey)}`;

  const res = await fetch(upstreamUrl, { signal: event.request.signal });
  if (!res.ok) {
    return new Response(`Stadia upstream returned ${res.status}`, {
      status: res.status === 401 ? 502 : res.status,
    });
  }

  const headers = new Headers();
  headers.set('content-type', res.headers.get('content-type') ?? 'image/png');
  headers.set('cache-control', 'public, max-age=86400, immutable');
  return new Response(res.body, { status: 200, headers });
}

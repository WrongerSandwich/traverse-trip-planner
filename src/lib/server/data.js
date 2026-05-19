import { readFileSync, existsSync, readdirSync, statSync, mkdirSync } from 'fs';
import { join } from 'path';
import { stringify as yamlStringify, parse as yamlParse } from 'yaml';
import { resolveEnv } from './settings.js';
import { TraverseError } from './errors.js';
// Canonical atomic-write module. Both imported for internal use and re-exported
// so callers that import atomicWrite from data.js continue to work without change.
export { atomicWrite } from './atomic-write.js';
import { atomicWrite } from './atomic-write.js';

export const ROOT = process.cwd();
const IMAGE_CACHE_PATH   = join(ROOT, '.image-cache.json');
const ROUTE_CACHE_PATH   = join(ROOT, '.route-cache.json');
const GEOCODE_CACHE_PATH = join(ROOT, '.geocode-cache.json');

// ── Caches ──
let geocodeCache = {};
let imageCache   = {};
let routeCache   = {};
try { imageCache   = JSON.parse(readFileSync(IMAGE_CACHE_PATH,   'utf8')); } catch {}
try { routeCache   = JSON.parse(readFileSync(ROUTE_CACHE_PATH,   'utf8')); } catch {}
try { geocodeCache = JSON.parse(readFileSync(GEOCODE_CACHE_PATH, 'utf8')); } catch {}

// Cache writes are batched: fetchers mark their cache dirty, and a single
// flushCaches() at the end of a request writes only the dirty ones. This
// turns ~35 writeFileSync calls during a cold enrichTrips into at most 3.
let geocodeDirty = false;
let imageDirty   = false;
let routeDirty   = false;

function saveCache(path, data, label) {
  try {
    atomicWrite(path, JSON.stringify(data, null, 2));
  } catch (e) {
    console.warn(`failed to save ${label} cache to ${path} —`, e.message);
  }
}

export function flushCaches() {
  if (geocodeDirty) { saveCache(GEOCODE_CACHE_PATH, geocodeCache, 'geocode'); geocodeDirty = false; }
  if (imageDirty)   { saveCache(IMAGE_CACHE_PATH,   imageCache,   'image');   imageDirty   = false; }
  if (routeDirty)   { saveCache(ROUTE_CACHE_PATH,   routeCache,   'route');   routeDirty   = false; }
}

function pruneCaches(liveRouteKeys, liveImageKeys, liveGeocodeKeys) {
  let routesDropped = 0, imagesDropped = 0, geocodesDropped = 0;
  for (const k of Object.keys(routeCache)) {
    if (!liveRouteKeys.has(k)) { delete routeCache[k]; routesDropped++; }
  }
  for (const k of Object.keys(imageCache)) {
    if (!liveImageKeys.has(k)) { delete imageCache[k]; imagesDropped++; }
  }
  for (const k of Object.keys(geocodeCache)) {
    if (!liveGeocodeKeys.has(k)) { delete geocodeCache[k]; geocodesDropped++; }
  }
  if (routesDropped)   routeDirty   = true;
  if (imagesDropped)   imageDirty   = true;
  if (geocodesDropped) geocodeDirty = true;
  if (routesDropped || imagesDropped || geocodesDropped) {
    console.log(`cache GC: dropped ${routesDropped} route(s), ${imagesDropped} image(s), ${geocodesDropped} geocode(s)`);
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Geocoding ──
// Only cache on a real 200 response (including legitimate empty results).
// Transient failures (429, network errors) return null without caching, so
// the next page load retries instead of sticking the destination as broken.
export async function geocode(destination) {
  if (geocodeCache[destination] !== undefined) return geocodeCache[destination];
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(destination)}&format=json&limit=1`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'traverse/1.0 (personal)' } });
      if (res.status === 429) {
        if (attempt === 0) { await sleep(2000); continue; }
        throw new TraverseError('geocode_quota', `Nominatim rate-limited for "${destination}"`);
      }
      if (!res.ok) {
        console.warn('geocode HTTP', res.status, 'for', destination);
        return null;
      }
      const data = await res.json();
      let coords = null;
      if (data.length) {
        const lat = parseFloat(data[0].lat);
        const lon = parseFloat(data[0].lon);
        if (
          Number.isFinite(lat) && Number.isFinite(lon) &&
          lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180
        ) {
          coords = [lat, lon];
        } else {
          console.warn('geocode: out-of-range coords for', destination, lat, lon);
        }
      }
      geocodeCache[destination] = coords;
      geocodeDirty = true;
      return coords;
    } catch (e) {
      if (attempt === 0) { await sleep(500); continue; }
      console.warn('geocode error for', destination, '—', e.message);
      return null;
    }
  }
  return null;
}

// ── Pexels images ──
//
// Cache entries are wrapped: `{ value, fetchedAt }`. Legacy bare entries
// (objects or null without a `fetchedAt` field) survive a deploy and are
// treated as fresh until they're rewritten on next fetch.
export const IMAGE_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function readImageCacheEntry(cache, query, now = Date.now(), ttlMs = IMAGE_CACHE_TTL_MS) {
  const entry = cache[query];
  if (entry === undefined) return { state: 'miss' };
  // Legacy bare value (cached miss or pre-TTL hit). No expiry.
  if (entry === null || typeof entry.fetchedAt !== 'number') {
    return { state: 'hit', value: entry };
  }
  if (now - entry.fetchedAt > ttlMs) return { state: 'expired' };
  return { state: 'hit', value: entry.value };
}

export function writeImageCacheEntry(cache, query, value, now = Date.now()) {
  cache[query] = { value, fetchedAt: now };
}

// Whether Pexels search is available in this environment. The endpoint
// distinguishes "search failed" (network/quota) from "search unconfigured"
// (no API key) so the UI can render the right ERROR_REGISTRY sentence.
export function isPexelsConfigured() {
  return !!resolveEnv('PEXELS_API_KEY');
}

export async function fetchImage(query) {
  const cached = readImageCacheEntry(imageCache, query);
  if (cached.state === 'hit') return cached.value;
  // miss or expired — refetch
  const key = resolveEnv('PEXELS_API_KEY');
  if (!key) { writeImageCacheEntry(imageCache, query, null); return null; }
  try {
    const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=3&orientation=landscape`;
    const res = await fetch(url, { headers: { Authorization: key } });
    const data = await res.json();
    const photos = (data.photos ?? []).slice(0, 3).map(p => ({
      medium: p.src.medium,
      large: p.src.large,
      large2x: p.src.large2x ?? null,
      photographer: p.photographer,
      photographer_url: p.photographer_url,
    }));
    // Legacy-compat shape: keep top-level primary fields so anything reading
    // trip._image.medium / .large keeps working. Extra photos live on .photos
    // so brochure-style consumers can use them as atmosphere images.
    const result = photos.length > 0
      ? { ...photos[0], photos }
      : null;
    writeImageCacheEntry(imageCache, query, result);
    imageDirty = true;
    return result;
  } catch (e) {
    console.error('Pexels error for', query, e.message);
    writeImageCacheEntry(imageCache, query, null);
    return null;
  }
}

// Apply a frontmatter `image_pick` to a Pexels result. Returns the same
// shape as `fetchImage()` with `photos` reordered so the picked photo
// sits at index 0, and the top-level medium/large/photographer fields
// point at the picked photo. This keeps brochure atmosphere slots
// (photos[1], photos[2]) from accidentally showing the new cover.
//
// Frontmatter values arrive as strings, so accept either; clamp to a
// valid index, and short-circuit on the trivial cases.
export function applyImagePick(image, pick) {
  if (!image) return null;
  const photos = image.photos;
  if (!Array.isArray(photos) || photos.length < 2) return image;
  const raw = typeof pick === 'string' ? Number(pick) : pick;
  if (!Number.isInteger(raw) || raw <= 0) return image;
  const idx = Math.min(raw, photos.length - 1);
  const reordered = [photos[idx], ...photos.slice(0, idx), ...photos.slice(idx + 1)];
  return { ...reordered[0], photos: reordered };
}

// ── OSRM road routing ──
function routeCacheKey(geocodedCoords) {
  return geocodedCoords.map(c => c.join(',')).join(';');
}

// Sentinel stored in the route cache when OSRM confirmed no route exists for
// a given coordinate set. Distinguishes "we tried and there is no route"
// (this sentinel) from null / undefined ("never tried — fetch on next request").
const ROUTE_NO_ROUTE = { status: 'no_route' };

async function fetchRoute(geocodedCoords) {
  if (!geocodedCoords || geocodedCoords.length < 2) return null;

  const cacheKey = routeCacheKey(geocodedCoords);
  const cached = routeCache[cacheKey];
  if (cached !== undefined) {
    // Translate the sentinel back to null so callers don't need to know about it.
    return cached === ROUTE_NO_ROUTE || (cached && cached.status === 'no_route') ? null : cached;
  }

  try {
    // OSRM expects lon,lat order; overview=full gives maximum geometry fidelity
    const coordStr = geocodedCoords.map(([lat, lon]) => `${lon},${lat}`).join(';');
    const url = `https://router.project-osrm.org/route/v1/driving/${coordStr}?overview=full&geometries=geojson`;
    const res = await fetch(url, { headers: { 'User-Agent': 'road-trip-planner/personal' } });
    const data = await res.json();

    if (data.code !== 'Ok' || !data.routes?.[0]?.geometry?.coordinates) {
      console.warn('OSRM returned no route for', cacheKey);
      // Use a sentinel so we don't retry on every request, but distinguish this
      // from null (= never fetched).
      routeCache[cacheKey] = { status: 'no_route' };
      routeDirty = true;
      return null;
    }

    // GeoJSON is [lon, lat] — flip to [lat, lon] for Leaflet
    const coords = data.routes[0].geometry.coordinates.map(([lon, lat]) => [lat, lon]);
    routeCache[cacheKey] = coords;
    routeDirty = true;
    console.log(`OSRM: cached route with ${coords.length} points`);
    return coords;
  } catch (e) {
    console.error('OSRM fetch error:', e.message);
    // Do NOT cache fetch errors — let the next request retry.
    return null;
  }
}

// Build the query string sent to Pexels for the trip's hero photo.
//
// Precedence:
//   1. `image_query` frontmatter field — authored by the seed/add LLM as a
//      deliberate stock-photo search ("Chicago skyline downtown"). This is
//      the source of truth for new trips.
//   2. Title with English stopwords stripped — legacy path for ideas that
//      predate the field; kept so old cached entries still resolve.
//   3. Destination — last-ditch fallback.
//
// Pexels keyword search rewards concrete visual nouns and punishes
// atmospheric phrases ("intellectual", "centennial"); letting the LLM
// pick the query directly produces far better matches than scraping
// the human-readable title.
export function imageQuery(trip) {
  if (typeof trip.image_query === 'string' && trip.image_query.trim()) {
    return trip.image_query.trim();
  }
  const titleQuery = (trip.title || '')
    .replace(/\b(and|the|a|an|or|of|in|at|for)\b/gi, ' ')
    .replace(/\s+/g, ' ').trim();
  return titleQuery || trip.destination || '';
}

// ── Cost estimation ──
function haversine([lat1, lon1], [lat2, lon2]) {
  const R = 3959;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function fmt(n) { return '$' + (Math.round(n / 50) * 50).toLocaleString('en-US'); }

function estimateCost(trip, homeCoords) {
  if (trip.cost_tier) {
    return { budget: '$300–$600', mid: '$700–$1,400', splurge: '$1,500+' }[trip.cost_tier] || null;
  }
  if (!homeCoords || !Array.isArray(trip._coords)) return null;

  const dist = haversine(homeCoords, trip._coords);
  const gas = dist * 2 * 0.22;
  let nights, lodging, food;
  if (dist < 150)      { nights = 1; lodging = 150; food = 100; }
  else if (dist < 300) { nights = 2; lodging = 165; food = 110; }
  else                 { nights = 3; lodging = 180; food = 120; }

  if (trip.duration_days) {
    const d = Array.isArray(trip.duration_days) ? Number(trip.duration_days[0]) : Number(trip.duration_days);
    if (!isNaN(d) && d > 0) nights = d;
  }

  const low = gas + nights * lodging + (nights + 1) * food;
  return `${fmt(low)}–${fmt(low * 1.45)}`;
}

// ── Frontmatter parser ──

/**
 * Parse the body of a frontmatter block (the lines between `---` fences) into
 * an object. Inline-list values like `[a, b, c]` become arrays; everything
 * else stays as a string. Use this when you have raw key:value lines without
 * fences (e.g. AI-generated frontmatter inside an XML tag).
 *
 * Limitation: quoted commas inside inline arrays are not handled — a value
 * like `[hiking, "scenic, drive"]` splits into three entries instead of two.
 * Use YAML multiline block sequences (one item per line with `- ` prefix) for
 * values that may contain commas.
 */
export function parseFrontmatterFields(text) {
  const data = {};
  for (const line of text.split('\n')) {
    const colon = line.indexOf(':');
    if (colon < 1) continue;
    const key = line.slice(0, colon).trim();
    const raw = line.slice(colon + 1).trim();
    data[key] = raw.startsWith('[') && raw.endsWith(']')
      ? raw.slice(1, -1).split(',').map(s => s.trim()).filter(s => s !== '')
      : raw;
  }
  return data;
}

export function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  return parseFrontmatterFields(match[1]);
}

// ── Collect raw trips ──
function collectTrips() {
  const trips = [];
  for (const stage of ['ideas', 'planning', 'completed']) {
    const dir = join(ROOT, stage);
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      let filePath;
      if (entry.isFile() && entry.name.endsWith('.md')) {
        filePath = join(dir, entry.name);
      } else if (entry.isDirectory()) {
        const ov = join(dir, entry.name, 'overview.md');
        if (existsSync(ov)) filePath = ov;
      }
      if (!filePath) continue;
      const fm = parseFrontmatter(readFileSync(filePath, 'utf8'));
      if (fm) trips.push({ ...fm, _stage: stage, _slug: entry.name.replace(/\.md$/, '') });
    }
  }
  return trips.sort((a, b) => new Date(b.created || 0) - new Date(a.created || 0));
}

// ── Home ──
export function readHomeMd() {
  const p = join(ROOT, 'home.md');
  if (!existsSync(p)) {
    throw new Error('home.md not found — copy home.example.md to home.md and fill in your details.');
  }
  return readFileSync(p, 'utf8');
}

/**
 * Split markdown body text into a preamble and named sections.
 * Preamble is everything before the first `## ` heading.
 * Exported so it can be unit-tested independently.
 *
 * @param {string} body - Markdown text with frontmatter already stripped.
 * @returns {{ preamble: string, sections: Array<{ heading: string, body: string }> }}
 */
export function splitHomeBody(body) {
  const lines = body.split('\n');
  const sections = [];
  let preambleLines = [];
  let current = null;

  for (const line of lines) {
    if (line.startsWith('## ')) {
      if (current !== null) {
        sections.push({ heading: current.heading, body: current.lines.join('\n').trim() });
      } else {
        preambleLines = preambleLines; // nothing to finalize — just fall through
      }
      current = { heading: line.slice(3).trim(), lines: [] };
    } else if (current === null) {
      preambleLines.push(line);
    } else {
      current.lines.push(line);
    }
  }
  if (current !== null) {
    sections.push({ heading: current.heading, body: current.lines.join('\n').trim() });
  }

  return { preamble: preambleLines.join('\n').trim(), sections };
}

/**
 * Parse home.md into a structured object.
 *
 * Uses the `yaml` package (eemeli/yaml v2) for the frontmatter block, which
 * preserves nested objects, arrays, numbers, and booleans as their native types.
 * (The simpler `parseFrontmatter` used for trip files stays as-is — trip
 * frontmatter is flat and the line-by-line parser is fine for it.)
 *
 * @returns {{ frontmatter: object, prose: { preamble: string, sections: Array<{heading, body}> } } | null}
 */
export function parseHomeMd() {
  const p = join(ROOT, 'home.md');
  if (!existsSync(p)) return null;

  const content = readFileSync(p, 'utf8');
  const fenceMatch = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!fenceMatch) return null;

  let frontmatter;
  try {
    frontmatter = yamlParse(fenceMatch[1]) || {};
  } catch (err) {
    throw new Error(`home.md YAML parse failed: ${err.message}`);
  }
  const bodyStart = fenceMatch[0].length;
  const body = content.slice(bodyStart);
  const prose = splitHomeBody(body);

  return { frontmatter, prose };
}

/**
 * Serialize a frontmatter object to a YAML block (no `---` fences).
 *
 * Uses the `yaml` package with options chosen to match the existing
 * `home.md` file style: predictable line-by-line output, no auto-wrapping,
 * preserved key insertion order, native types for numbers/booleans.
 *
 * @param {object} obj
 * @returns {string} YAML block (no fences, no trailing newline)
 */
export function serializeFrontmatter(obj) {
  return yamlStringify(obj, {
    lineWidth: 0,                 // never line-wrap
    defaultStringType: 'PLAIN',   // bare strings where possible
    blockQuote: 'literal',
    sortMapEntries: false,        // preserve insertion order
  }).trimEnd();
}

/**
 * Write home.md atomically from a structured payload.
 * Reconstructs `---\nYAML\n---\n\nbody\n` on disk.
 *
 * @param {{ frontmatter: object, prose: { preamble: string, sections: Array<{heading, body}> } }} payload
 */
export function writeHomeMd({ frontmatter, prose }) {
  const yamlBlock = serializeFrontmatter(frontmatter);
  const { preamble, sections } = prose;
  const sectionText = sections
    .map(({ heading, body }) => `## ${heading}\n\n${body}`)
    .join('\n\n');
  const bodyParts = [preamble, sectionText].filter(Boolean);
  const body = bodyParts.join('\n\n');
  const final = `---\n${yamlBlock}\n---\n\n${body}\n`;

  const p = join(ROOT, 'home.md');
  atomicWrite(p, final);
  invalidateEnrichCache();
}

export function getHome() {
  const p = join(ROOT, 'home.md');
  if (!existsSync(p)) return null;
  const fm = parseFrontmatter(readFileSync(p, 'utf8'));
  if (!fm) return null;
  const coords = Array.isArray(fm.home_coords) ? fm.home_coords.map(Number) : null;
  return { city: fm.home_city || 'Home', coords };
}

// ── Enrich trips ──
// TODO: split into enrichWithGeodata() (geocode/image/route I/O) and enrichWithCalculations() (pure transforms); pruneCaches() can be called explicitly after enrichment

async function geocodeWaypoints(waypoints, trackSet = null) {
  const wps = Array.isArray(waypoints) ? waypoints : [waypoints];
  const geocoded = [];
  for (const wp of wps) {
    if (trackSet) trackSet.add(wp);
    const needsFetch = geocodeCache[wp] === undefined;
    try {
      const coord = await geocode(wp);
      if (needsFetch) await sleep(1100);
      if (coord) geocoded.push(coord);
    } catch (e) {
      if (e instanceof TraverseError && e.code === 'geocode_quota') {
        console.warn('geocode rate-limited during enrichment for', wp);
      } else {
        throw e;
      }
    }
  }
  return geocoded;
}
// 30-second memo on the enriched trip list so rapid-fire page loads (multiple
// browser tabs, F5 spam) don't re-walk the file system. Mutating endpoints
// call `invalidateEnrichCache()` to force a refresh.
const ENRICH_TTL_MS = 30_000;
let enrichMemo = null;
let enrichTime = 0;

export function invalidateEnrichCache() {
  enrichMemo = null;
}

export async function enrichTrips() {
  if (enrichMemo && Date.now() - enrichTime < ENRICH_TTL_MS) return enrichMemo;
  const home = getHome();
  const homeCoords = home?.coords ?? null;
  const trips = collectTrips();

  const liveRouteKeys   = new Set();
  const liveImageKeys   = new Set();
  const liveGeocodeKeys = new Set();

  // Per-request geocode coalescing: if two trips share a destination that isn't
  // in the disk cache yet, the second trip awaits the same in-flight promise
  // rather than firing a duplicate Nominatim request.
  const geocodeInflight = new Map();

  async function geocodeCached(destination) {
    if (geocodeCache[destination] !== undefined) return geocodeCache[destination] ?? null;
    if (geocodeInflight.has(destination)) return geocodeInflight.get(destination);
    const promise = geocode(destination).then(async (coord) => {
      await sleep(1100);
      return coord;
    });
    geocodeInflight.set(destination, promise);
    return promise;
  }

  let completedEnumeration = true;
  for (const trip of trips) {
    try {
      // Geocode
      const dest = trip.destination;
      if (dest) liveGeocodeKeys.add(dest);
      if (dest) {
        try {
          trip._coords = await geocodeCached(dest);
        } catch (e) {
          if (e instanceof TraverseError && e.code === 'geocode_quota') {
            console.warn('geocode rate-limited during enrichment for', dest);
            trip._coords = null;
          } else {
            throw e;
          }
        }
      } else {
        trip._coords = null;
      }

      // Image
      const q = imageQuery(trip);
      if (q) liveImageKeys.add(q);
      if (q) {
        const cached = readImageCacheEntry(imageCache, q);
        const raw = cached.state === 'hit' ? cached.value : await fetchImage(q);
        if (cached.state !== 'hit') await sleep(50);
        trip._image = applyImagePick(raw, trip.image_pick);
      } else {
        trip._image = null;
      }

      // Route waypoints → geocode → OSRM road geometry
      if (trip.waypoints) {
        const geocoded = await geocodeWaypoints(trip.waypoints, liveGeocodeKeys);
        if (geocoded.length >= 2) {
          liveRouteKeys.add(routeCacheKey(geocoded));
          const route = await fetchRoute(geocoded);
          // Coords are fetched lazily by the client via /api/route/[slug] —
          // shipping them here added 40 KB per route to every page load.
          trip._has_route = !!(route && route.length >= 2);
        } else {
          trip._has_route = false;
        }
      } else {
        trip._has_route = false;
      }

      // Cost + drive time
      trip._cost = estimateCost(trip, homeCoords);
      if (homeCoords && Array.isArray(trip._coords)) {
        const dist = haversine(homeCoords, trip._coords);
        trip._drive_hours = Math.round((dist * 1.2 / 65) * 2) / 2;
      } else {
        trip._drive_hours = null;
      }
    } catch (e) {
      completedEnumeration = false;
      console.warn('enrichTrips: error enriching trip', trip._slug, '—', e.message);
    }
  }

  // GC orphaned cache entries — only when we found at least one trip AND all
  // trips enriched without error, so a partial failure can't nuke valid entries.
  if (trips.length > 0 && completedEnumeration) {
    pruneCaches(liveRouteKeys, liveImageKeys, liveGeocodeKeys);
  } else if (trips.length > 0 && !completedEnumeration) {
    console.warn('enrichTrips: skipping cache prune due to partial enrichment');
  }

  flushCaches();

  enrichMemo = trips;
  enrichTime = Date.now();
  return trips;
}

// Lazy-loaded by /api/route/[slug]. Geocode + route caches make this near-instant
// for any trip enrichTrips has already touched.
export async function getTripRoute(slug) {
  for (const stage of ['planning', 'completed']) {
    const fp = join(ROOT, stage, slug, 'overview.md');
    if (!existsSync(fp)) continue;
    const fm = parseFrontmatter(readFileSync(fp, 'utf8'));
    if (!fm?.waypoints) return null;
    const geocoded = await geocodeWaypoints(fm.waypoints);
    if (geocoded.length < 2) { flushCaches(); return null; }
    const route = await fetchRoute(geocoded);
    flushCaches();
    return route;
  }
  return null;
}

// ── Planning section utilities ──
export const PLANNING_SECTIONS = ['overview', 'route', 'stops', 'logistics'];

/**
 * Returns true when `artifact` exists in `dir` AND at least one of the
 * `sources` section files has been modified more recently than `artifact` —
 * i.e. the artifact is stale relative to its source sections.
 *
 * Accepts an optional `stat` callback so tests can inject synthetic mtimes
 * without touching the filesystem.
 *
 * @param {string}   dir      - Absolute path to the trip folder.
 * @param {string[]} sources  - Section names to check (without `.md` extension).
 * @param {string}   artifact - Filename of the artifact to check (e.g. `'itinerary.md'`).
 * @param {(path: string) => { mtimeMs: number } | null} [stat]
 *   - Defaults to `fs.statSync` with a null-returning catch.
 * @returns {boolean}
 */
export function isArtifactStale(dir, sources, artifact, stat) {
  const safeStat = stat ?? ((p) => { try { return statSync(p); } catch { return null; } });

  const artifactPath = join(dir, artifact);
  const artifactStat = safeStat(artifactPath);
  if (!artifactStat) return false; // artifact absent — nothing to be stale

  const artifactMtime = artifactStat.mtimeMs;

  for (const section of sources) {
    const sectionStat = safeStat(join(dir, `${section}.md`));
    if (sectionStat && sectionStat.mtimeMs > artifactMtime) return true;
  }
  return false;
}

/**
 * Convenience wrapper: returns true when `brochure.md` is stale relative to
 * the four canonical planning sections.
 *
 * @param {string} dir
 * @param {(path: string) => { mtimeMs: number } | null} [stat]
 * @returns {boolean}
 */
export function isBrochureStale(dir, stat) {
  return isArtifactStale(dir, PLANNING_SECTIONS, 'brochure.md', stat);
}

// Returns { dir, frontmatter, sections } for a trip in the planning stage,
// or null if the directory doesn't exist. `frontmatter` is the raw YAML block
// from overview.md (with trailing newline); `sections` maps section name →
// prose body (frontmatter stripped for overview).
export function readPlanningTrip(slug) {
  const dir = join(ROOT, 'planning', slug);
  if (!existsSync(dir)) return null;
  const out = { dir, frontmatter: '', sections: {} };
  for (const name of PLANNING_SECTIONS) {
    const fp = join(dir, `${name}.md`);
    if (!existsSync(fp)) continue;
    let content = readFileSync(fp, 'utf8');
    if (name === 'overview') {
      const fm = content.match(/^(---\n[\s\S]*?\n---\n)/);
      if (fm) {
        out.frontmatter = fm[1];
        content = content.slice(fm[1].length).replace(/^\s+/, '');
      }
    }
    out.sections[name] = content;
  }
  return out;
}

// Writes a single planning section file, preserving frontmatter for overview.
export function writePlanningSection(dir, section, frontmatter, content) {
  const fp = join(dir, `${section}.md`);
  if (section === 'overview') {
    const trimmed = content.replace(/^\s+/, '');
    const final = frontmatter
      ? `${frontmatter}\n${trimmed}${trimmed.endsWith('\n') ? '' : '\n'}`
      : `${trimmed}${trimmed.endsWith('\n') ? '' : '\n'}`;
    atomicWrite(fp, final);
  } else {
    const final = content.endsWith('\n') ? content : `${content}\n`;
    atomicWrite(fp, final);
  }
  invalidateEnrichCache();
}

// ── Frontmatter field mutation ──
//
// Developer note: `field` is always internal — never pass user input. The
// regex-escape below is belt-and-suspenders so a typo'd metacharacter in a
// field name can't corrupt the frontmatter block.

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Sets or inserts a single frontmatter field in markdown content.
// Scoped to the frontmatter block (mirroring removeFrontmatterField) so a
// prose line in the body that starts with the field name is never touched.
// No-op insert if no frontmatter block exists (body-only files are left as-is).
export function setFrontmatterField(content, field, value) {
  const safeField = escapeRegex(field);
  const line = `${field}: ${value}`;
  return content.replace(
    /^---\n([\s\S]*?)\n---/m,
    (match, block) => {
      if (new RegExp(`^${safeField}:`, 'm').test(block)) {
        // Field exists in frontmatter — replace that line only.
        return `---\n${block.replace(new RegExp(`^${safeField}:.*$`, 'm'), line)}\n---`;
      }
      // Field absent — append before the closing fence.
      return `---\n${block}\n${line}\n---`;
    },
  );
}

// Removes a frontmatter field line from markdown content. No-op if absent.
// Scoped to the frontmatter block so prose lines with the same prefix are safe.
export function removeFrontmatterField(content, field) {
  const safeField = escapeRegex(field);
  return content.replace(
    /^---\n([\s\S]*?)\n---/m,
    (_, block) => `---\n${block.replace(new RegExp(`^${safeField}:.*\n?`, 'm'), '')}\n---`,
  );
}

// ── Slug + AI-path validation ──
//
// Defends two attack surfaces:
//   1. URL [slug] params reach the filesystem via `join(ROOT, …, slug)`. An
//      unsanitized slug like `../../home.md` resolves outside the trip tree.
//      SvelteKit decodes %2e%2e%2f before we see it, so the slug we receive
//      is the post-decode string — we just need a strict character allowlist.
//   2. AI-generated <file name="…"> paths from seed/add. A nudged model
//      might emit `../../.env` if not constrained.
//
// Both checks live here (not as inline regexes at call sites) so the rule has
// one canonical home. Update both patterns together if either evolves.

// Slugs: kebab-case ASCII. Starts with [a-z0-9] to forbid leading dashes;
// no dots, slashes, whitespace, or uppercase. Length cap is generous.
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,99}$/;

export function isValidSlug(slug) {
  return typeof slug === 'string' && SLUG_PATTERN.test(slug);
}

// Returns a 400 Response when the slug is invalid, else null. Use at the top
// of every `[slug]` route handler before any filesystem access.
export function rejectInvalidSlug(slug) {
  if (isValidSlug(slug)) return null;
  return new Response('Invalid slug', { status: 400 });
}

// AI-emitted file paths must match exactly `ideas/<kebab>.md`. Reject the
// entire batch if any file fails so a partial write doesn't drop only some
// of a planned set.
const IDEA_PATH_PATTERN = /^ideas\/[a-z0-9][a-z0-9-]{0,99}\.md$/;

export function isSafeIdeaPath(p) {
  return typeof p === 'string' && IDEA_PATH_PATTERN.test(p);
}

export function assertSafeIdeaPath(p) {
  if (!isSafeIdeaPath(p)) {
    throw new Error(`Refusing unsafe AI-generated path: ${JSON.stringify(p)}`);
  }
  return p;
}

// ── Trip location ──
// Returns { kind: 'file'|'dir', path, stage } for the trip's current live location,
// or null if not found. kind='file' means an idea .md; kind='dir' means a stage folder.
// TODO: findIdeaFile() in deepen/[slug]/+server.js is intentionally idea-only (deepening
// only applies to ideas), but could be simplified to use findTripLocation if that changes.
export function findTripLocation(slug) {
  const ideaPath = join(ROOT, 'ideas', `${slug}.md`);
  if (existsSync(ideaPath)) return { kind: 'file', path: ideaPath, stage: 'ideas' };
  for (const stage of ['planning', 'completed']) {
    const dir = join(ROOT, stage, slug);
    if (existsSync(dir)) return { kind: 'dir', path: dir, stage };
  }
  return null;
}

// ── Bookmark toggle ──
// Returns the source-of-truth markdown path for a trip (idea .md or
// overview.md inside the stage folder). Used by frontmatter-mutation
// helpers (bookmark, share, jobs registry) that don't care which stage
// the trip is in, only where its frontmatter lives.
export function findTripFile(slug) {
  const loc = findTripLocation(slug);
  if (!loc) return null;
  return loc.kind === 'file' ? loc.path : join(loc.path, 'overview.md');
}

export function toggleStarred(slug) {
  const filePath = findTripFile(slug);
  if (!filePath) return null;

  const content = readFileSync(filePath, 'utf8');
  const fm = parseFrontmatter(content);
  if (!fm) return null;

  const wasStarred = fm.starred === 'true' || fm.starred === true;
  const nowStarred = !wasStarred;

  atomicWrite(filePath, setFrontmatterField(content, 'starred', nowStarred));
  invalidateEnrichCache();
  return { starred: nowStarred };
}

// ── Share toggle ──
export function setShared(slug, shared) {
  const filePath = findTripFile(slug);
  if (!filePath) return null;

  const content = readFileSync(filePath, 'utf8');
  const fm = parseFrontmatter(content);
  if (!fm) return null;

  atomicWrite(filePath, setFrontmatterField(content, 'shared', shared));
  invalidateEnrichCache();
  return { shared };
}

// ── Image metadata mutation ──
// Writes image_query and/or image_pick to a trip's frontmatter. Both are
// optional — caller provides only the fields they want to update.
//
// image_pick === 0 (or omitted) is the implicit default, so we remove the
// field entirely in that case rather than littering frontmatter with zeros.
//
// Throws TypeError on invalid inputs so the endpoint can return 400.
export function updateImageMeta(slug, { image_query, image_pick } = {}) {
  if (image_query !== undefined) {
    if (typeof image_query !== 'string' || /[\r\n]/.test(image_query)) {
      throw new TypeError('image_query must be a single-line string');
    }
  }
  let pick;
  if (image_pick !== undefined) {
    const n = typeof image_pick === 'string' ? Number(image_pick) : image_pick;
    if (!Number.isInteger(n) || n < 0 || n > 2) {
      throw new TypeError('image_pick must be an integer 0, 1, or 2');
    }
    pick = n;
  }

  const filePath = findTripFile(slug);
  if (!filePath) return null;

  let content = readFileSync(filePath, 'utf8');
  if (!parseFrontmatter(content)) return null;

  if (image_query !== undefined) {
    content = setFrontmatterField(content, 'image_query', image_query);
  }
  if (pick !== undefined) {
    content = pick === 0
      ? removeFrontmatterField(content, 'image_pick')
      : setFrontmatterField(content, 'image_pick', pick);
  }

  atomicWrite(filePath, content);
  invalidateEnrichCache();
  return { ok: true };
}

// ── Trip file content ──
export function getTripFiles(slug) {
  for (const stage of ['planning', 'completed']) {
    const dir = join(ROOT, stage, slug);
    if (existsSync(dir) && statSync(dir).isDirectory()) {
      const files = {};
      for (const name of ['overview', 'route', 'stops', 'logistics', 'itinerary', 'notes']) {
        const fp = join(dir, `${name}.md`);
        if (!existsSync(fp)) continue;
        let content = readFileSync(fp, 'utf8');
        // Strip leading YAML frontmatter from any section that has it (overview
        // always does; notes carries retro frontmatter — rating, would_repeat,
        // highlights — that must not bleed into the rendered body).
        content = content.replace(/^---\n[\s\S]*?\n---\n*/, '').trimStart();
        files[name] = content;
      }
      return { slug, stage, files };
    }
  }
  const ideaPath = join(ROOT, 'ideas', `${slug}.md`);
  if (existsSync(ideaPath)) {
    const raw = readFileSync(ideaPath, 'utf8').replace(/^---\n[\s\S]*?\n---\n*/, '').trimStart();
    return { slug, stage: 'ideas', files: raw ? { overview: raw } : {} };
  }
  return null;
}

// Append a block of text to notes.md for a completed trip, separated by a
// blank line. Creates the file if it does not exist. Returns true on success.
export function appendToNotes(slug, text) {
  const notesPath = join(ROOT, 'completed', slug, 'notes.md');
  const existing = existsSync(notesPath) ? readFileSync(notesPath, 'utf8') : '';
  const separator = existing.trimEnd().length > 0 ? '\n\n' : '';
  atomicWrite(notesPath, existing.trimEnd() + separator + text.trim() + '\n');
  invalidateEnrichCache();
  return true;
}

// ── Stage transition utility ──
// Moves a trip folder from one stage directory to another and updates
// the status field in overview.md. Used by promote, complete, and archive routes.
export function moveTrip(slug, fromStage, toStage, newStatus) {
  const fromDir = join(ROOT, fromStage, slug);
  const toDir   = join(ROOT, toStage, slug);

  if (!existsSync(fromDir)) return { error: `Trip not in ${fromStage} stage`, status: 404 };
  if (existsSync(toDir))    return { error: `Trip already exists in ${toStage}`, status: 409 };

  try {
    mkdirSync(join(ROOT, toStage), { recursive: true });
    renameSync(fromDir, toDir);

    const overviewPath = join(toDir, 'overview.md');
    if (existsSync(overviewPath)) {
      const content = readFileSync(overviewPath, 'utf8');
      const updated = /^status:.*$/m.test(content)
        ? content.replace(/^status:.*$/m, `status: ${newStatus}`)
        : content.replace(/^---\n/, `---\nstatus: ${newStatus}\n`);
      atomicWrite(overviewPath, updated);
    }
  } catch (err) {
    return { error: err.message, status: 500 };
  }

  invalidateEnrichCache();
  return null; // null = success; caller reads slug/stage from its own context
}

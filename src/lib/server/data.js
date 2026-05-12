import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync, renameSync } from 'fs';
import { join } from 'path';
import { resolveEnv } from './settings.js';

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
    writeFileSync(path, JSON.stringify(data, null, 2));
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
        console.warn('geocode rate-limited (429) for', destination);
        return null;
      }
      if (!res.ok) {
        console.warn('geocode HTTP', res.status, 'for', destination);
        return null;
      }
      const data = await res.json();
      const coords = data.length ? [parseFloat(data[0].lat), parseFloat(data[0].lon)] : null;
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

// ── OSRM road routing ──
function routeCacheKey(geocodedCoords) {
  return geocodedCoords.map(c => c.join(',')).join(';');
}

async function fetchRoute(geocodedCoords) {
  if (!geocodedCoords || geocodedCoords.length < 2) return null;

  const cacheKey = routeCacheKey(geocodedCoords);
  if (routeCache[cacheKey] !== undefined) return routeCache[cacheKey];

  try {
    // OSRM expects lon,lat order; overview=full gives maximum geometry fidelity
    const coordStr = geocodedCoords.map(([lat, lon]) => `${lon},${lat}`).join(';');
    const url = `https://router.project-osrm.org/route/v1/driving/${coordStr}?overview=full&geometries=geojson`;
    const res = await fetch(url, { headers: { 'User-Agent': 'road-trip-planner/personal' } });
    const data = await res.json();

    if (data.code !== 'Ok' || !data.routes?.[0]?.geometry?.coordinates) {
      console.warn('OSRM returned no route for', cacheKey);
      routeCache[cacheKey] = null;
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
    routeCache[cacheKey] = null;
    return null;
  }
}

function imageQuery(trip) {
  return (trip.title || '')
    .replace(/\b(and|the|a|an|or|of|in|at|for)\b/gi, ' ')
    .replace(/\s+/g, ' ').trim()
    || trip.destination || '';
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
 */
export function parseFrontmatterFields(text) {
  const data = {};
  for (const line of text.split('\n')) {
    const colon = line.indexOf(':');
    if (colon < 1) continue;
    const key = line.slice(0, colon).trim();
    const raw = line.slice(colon + 1).trim();
    data[key] = raw.startsWith('[') && raw.endsWith(']')
      ? raw.slice(1, -1).split(',').map(s => s.trim())
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
  for (const stage of ['ideas', 'exploring', 'planning', 'completed']) {
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
// TODO: standardize null-check pattern in setLocked/toggleStarred/setShared — all should assign parseFrontmatter to a variable before checking, not discard the result

async function geocodeWaypoints(waypoints, trackSet = null) {
  const wps = Array.isArray(waypoints) ? waypoints : [waypoints];
  const geocoded = [];
  for (const wp of wps) {
    if (trackSet) trackSet.add(wp);
    const needsFetch = geocodeCache[wp] === undefined;
    const coord = await geocode(wp);
    if (needsFetch) await sleep(1100);
    if (coord) geocoded.push(coord);
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

  for (const trip of trips) {
    // Geocode
    const dest = trip.destination;
    if (dest) liveGeocodeKeys.add(dest);
    if (dest && geocodeCache[dest] === undefined) {
      trip._coords = await geocode(dest);
      await sleep(1100);
    } else {
      trip._coords = geocodeCache[dest] ?? null;
    }

    // Image
    const q = imageQuery(trip);
    if (q) liveImageKeys.add(q);
    if (q) {
      const cached = readImageCacheEntry(imageCache, q);
      if (cached.state === 'hit') {
        trip._image = cached.value;
      } else {
        trip._image = await fetchImage(q);
        await sleep(50);
      }
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
  }

  // GC orphaned cache entries — only when we found at least one trip, so a
  // transient empty load (mid-promote, etc.) can't nuke the caches.
  if (trips.length > 0) pruneCaches(liveRouteKeys, liveImageKeys, liveGeocodeKeys);

  flushCaches();

  enrichMemo = trips;
  enrichTime = Date.now();
  return trips;
}

// Lazy-loaded by /api/route/[slug]. Geocode + route caches make this near-instant
// for any trip enrichTrips has already touched.
export async function getTripRoute(slug) {
  for (const stage of ['exploring', 'planning', 'completed']) {
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
    writeFileSync(fp, final);
  } else {
    const final = content.endsWith('\n') ? content : `${content}\n`;
    writeFileSync(fp, final);
  }
  invalidateEnrichCache();
}

// ── Frontmatter field mutation ──
// Sets or inserts a single frontmatter field in markdown content.
// Returns the updated string; throws if no closing --- fence is found.
export function setFrontmatterField(content, field, value) {
  const line = `${field}: ${value}`;
  if (new RegExp(`^${field}:`, 'm').test(content)) {
    return content.replace(new RegExp(`^${field}:.*$`, 'm'), line);
  }
  return content.replace(/(\n---\n)/, `\n${line}$1`);
}

// Removes a frontmatter field line from markdown content. No-op if absent.
// Scoped to the frontmatter block so prose lines with the same prefix are safe.
export function removeFrontmatterField(content, field) {
  return content.replace(
    /^---\n([\s\S]*?)\n---/m,
    (_, block) => `---\n${block.replace(new RegExp(`^${field}:.*\n?`, 'm'), '')}\n---`,
  );
}

// ── Lock toggle ──
export function setLocked(slug, locked) {
  const filePath = join(ROOT, 'planning', slug, 'overview.md');
  if (!existsSync(filePath)) return null;

  const content = readFileSync(filePath, 'utf8');
  if (!parseFrontmatter(content)) return null;

  writeFileSync(filePath, setFrontmatterField(content, 'locked', locked));
  invalidateEnrichCache();
  return { locked };
}

// ── Trip location ──
// Returns { kind: 'file'|'dir', path, stage } for the trip's current live location,
// or null if not found. kind='file' means an idea .md; kind='dir' means a stage folder.
// TODO: findIdeaFile() in deepen/[slug]/+server.js is intentionally idea-only (deepening
// only applies to ideas), but could be simplified to use findTripLocation if that changes.
export function findTripLocation(slug) {
  const ideaPath = join(ROOT, 'ideas', `${slug}.md`);
  if (existsSync(ideaPath)) return { kind: 'file', path: ideaPath, stage: 'ideas' };
  for (const stage of ['exploring', 'planning', 'completed']) {
    const dir = join(ROOT, stage, slug);
    if (existsSync(dir)) return { kind: 'dir', path: dir, stage };
  }
  return null;
}

// ── Bookmark toggle ──
function findTripFile(slug) {
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

  writeFileSync(filePath, setFrontmatterField(content, 'starred', nowStarred));
  invalidateEnrichCache();
  return { starred: nowStarred };
}

// ── Share toggle ──
export function setShared(slug, shared) {
  const filePath = findTripFile(slug);
  if (!filePath) return null;

  const content = readFileSync(filePath, 'utf8');
  if (!parseFrontmatter(content)) return null;

  writeFileSync(filePath, setFrontmatterField(content, 'shared', shared));
  invalidateEnrichCache();
  return { shared };
}

// ── Trip file content ──
export function getTripFiles(slug) {
  for (const stage of ['exploring', 'planning', 'completed']) {
    const dir = join(ROOT, stage, slug);
    if (existsSync(dir) && statSync(dir).isDirectory()) {
      const files = {};
      for (const name of ['overview', 'route', 'stops', 'logistics', 'itinerary', 'notes']) {
        const fp = join(dir, `${name}.md`);
        if (!existsSync(fp)) continue;
        let content = readFileSync(fp, 'utf8');
        if (name === 'overview') content = content.replace(/^---\n[\s\S]*?\n---\n*/, '').trimStart();
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
      writeFileSync(overviewPath, updated);
    }
  } catch (err) {
    return { error: err.message, status: 500 };
  }

  invalidateEnrichCache();
  return null; // null = success; caller reads slug/stage from its own context
}

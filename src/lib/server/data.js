import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

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

function saveCache(path, data, label) {
  try {
    writeFileSync(path, JSON.stringify(data, null, 2));
  } catch (e) {
    console.warn(`failed to save ${label} cache to ${path} —`, e.message);
  }
}
function saveImageCache()   { saveCache(IMAGE_CACHE_PATH,   imageCache,   'image'); }
function saveRouteCache()   { saveCache(ROUTE_CACHE_PATH,   routeCache,   'route'); }
function saveGeocodeCache() { saveCache(GEOCODE_CACHE_PATH, geocodeCache, 'geocode'); }

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
  if (routesDropped)   saveRouteCache();
  if (imagesDropped)   saveImageCache();
  if (geocodesDropped) saveGeocodeCache();
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
      const res = await fetch(url, { headers: { 'User-Agent': 'atlas-trip-planner/1.0 (personal)' } });
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
      saveGeocodeCache();
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
export async function fetchImage(query) {
  if (imageCache[query] !== undefined) return imageCache[query];
  const key = process.env.PEXELS_API_KEY;
  if (!key) { imageCache[query] = null; return null; }
  try {
    const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=3&orientation=landscape`;
    const res = await fetch(url, { headers: { Authorization: key } });
    const data = await res.json();
    const photo = data.photos?.[0];
    const result = photo
      ? { medium: photo.src.medium, large: photo.src.large, photographer: photo.photographer, photographer_url: photo.photographer_url }
      : null;
    imageCache[query] = result;
    saveImageCache();
    return result;
  } catch (e) {
    console.error('Pexels error for', query, e.message);
    imageCache[query] = null;
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
      saveRouteCache();
      return null;
    }

    // GeoJSON is [lon, lat] — flip to [lat, lon] for Leaflet
    const coords = data.routes[0].geometry.coordinates.map(([lon, lat]) => [lat, lon]);
    routeCache[cacheKey] = coords;
    saveRouteCache();
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
  const flyIn = trip.fly_in === 'true';
  if (trip.cost_tier) {
    if (flyIn) return { budget: '~$1,200–1,800', mid: '~$1,800–3,000', splurge: '~$3,000+' }[trip.cost_tier] || null;
    return { budget: '~$300–600', mid: '~$700–1,400', splurge: '~$1,500+' }[trip.cost_tier] || null;
  }
  if (flyIn) return '~$1,500–3,000';
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
  return `~${fmt(low)}–${fmt(low * 1.45).slice(1)}`;
}

// ── Frontmatter parser ──
export function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const data = {};
  for (const line of match[1].split('\n')) {
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
export async function enrichTrips() {
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
    if (q && imageCache[q] === undefined) {
      trip._image = await fetchImage(q);
      await sleep(300);
    } else {
      trip._image = imageCache[q] ?? null;
    }

    // Route waypoints → geocode → OSRM road geometry
    if (trip.waypoints) {
      const wps = Array.isArray(trip.waypoints) ? trip.waypoints : [trip.waypoints];
      const geocoded = [];
      for (const wp of wps) {
        liveGeocodeKeys.add(wp);
        const needsFetch = geocodeCache[wp] === undefined;
        const coord = await geocode(wp);
        if (needsFetch) await sleep(1100);
        if (coord) geocoded.push(coord);
      }
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
    if (trip.fly_in !== 'true' && homeCoords && Array.isArray(trip._coords)) {
      const dist = haversine(homeCoords, trip._coords);
      trip._drive_hours = Math.round((dist * 1.2 / 65) * 2) / 2;
    } else {
      trip._drive_hours = null;
    }
  }

  // GC orphaned cache entries — only when we found at least one trip, so a
  // transient empty load (mid-promote, etc.) can't nuke the caches.
  if (trips.length > 0) pruneCaches(liveRouteKeys, liveImageKeys, liveGeocodeKeys);

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
    const wps = Array.isArray(fm.waypoints) ? fm.waypoints : [fm.waypoints];
    const geocoded = [];
    for (const wp of wps) {
      const needsFetch = geocodeCache[wp] === undefined;
      const coord = await geocode(wp);
      if (needsFetch) await sleep(1100);
      if (coord) geocoded.push(coord);
    }
    if (geocoded.length < 2) return null;
    return await fetchRoute(geocoded);
  }
  return null;
}

// ── Lock toggle ──
export function setLocked(slug, locked) {
  const filePath = join(ROOT, 'planning', slug, 'overview.md');
  if (!existsSync(filePath)) return null;

  const content = readFileSync(filePath, 'utf8');
  if (!parseFrontmatter(content)) return null;

  let updated;
  if (/^locked:/m.test(content)) {
    updated = content.replace(/^locked:.*$/m, `locked: ${locked}`);
  } else {
    updated = content.replace(/(\n---\n)/, `\nlocked: ${locked}$1`);
  }

  writeFileSync(filePath, updated);
  return { locked };
}

// ── Bookmark toggle ──
function findTripFile(slug) {
  const ideaPath = join(ROOT, 'ideas', `${slug}.md`);
  if (existsSync(ideaPath)) return ideaPath;
  for (const stage of ['exploring', 'planning', 'completed']) {
    const p = join(ROOT, stage, slug, 'overview.md');
    if (existsSync(p)) return p;
  }
  return null;
}

export function toggleStarred(slug) {
  const filePath = findTripFile(slug);
  if (!filePath) return null;

  const content = readFileSync(filePath, 'utf8');
  const fm = parseFrontmatter(content);
  if (!fm) return null;

  const wasStarred = fm.starred === 'true' || fm.starred === true;
  const nowStarred = !wasStarred;

  let updated;
  if (/^starred:/m.test(content)) {
    updated = content.replace(/^starred:.*$/m, `starred: ${nowStarred}`);
  } else {
    // Insert before closing ---
    updated = content.replace(/(\n---\n)/, `\nstarred: ${nowStarred}$1`);
  }

  writeFileSync(filePath, updated);
  return { starred: nowStarred };
}

// ── Trip file content ──
export function getTripFiles(slug) {
  for (const stage of ['exploring', 'planning', 'completed']) {
    const dir = join(ROOT, stage, slug);
    if (existsSync(dir) && statSync(dir).isDirectory()) {
      const files = {};
      for (const name of ['overview', 'route', 'stops', 'logistics', 'itinerary']) {
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

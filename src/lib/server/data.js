import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const IMAGE_CACHE_PATH = join(ROOT, '.image-cache.json');
const ROUTE_CACHE_PATH = join(ROOT, '.route-cache.json');

// ── Caches ──
const geocodeCache = {};
let imageCache = {};
let routeCache = {};
try { imageCache = JSON.parse(readFileSync(IMAGE_CACHE_PATH, 'utf8')); } catch {}
try { routeCache = JSON.parse(readFileSync(ROUTE_CACHE_PATH, 'utf8')); } catch {}

function saveImageCache() {
  writeFileSync(IMAGE_CACHE_PATH, JSON.stringify(imageCache, null, 2));
}
function saveRouteCache() {
  writeFileSync(ROUTE_CACHE_PATH, JSON.stringify(routeCache, null, 2));
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Geocoding ──
export async function geocode(destination) {
  if (geocodeCache[destination] !== undefined) return geocodeCache[destination];
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(destination)}&format=json&limit=1`;
    const res = await fetch(url, { headers: { 'User-Agent': 'road-trip-planner/personal' } });
    const data = await res.json();
    const coords = data.length ? [parseFloat(data[0].lat), parseFloat(data[0].lon)] : null;
    geocodeCache[destination] = coords;
    return coords;
  } catch {
    geocodeCache[destination] = null;
    return null;
  }
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
async function fetchRoute(geocodedCoords) {
  if (!geocodedCoords || geocodedCoords.length < 2) return null;

  // Cache key: stable string of the input coordinates
  const cacheKey = geocodedCoords.map(c => c.join(',')).join(';');
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
export async function enrichTrips() {
  const home = getHome();
  const homeCoords = home?.coords ?? null;
  const trips = collectTrips();

  for (const trip of trips) {
    // Geocode
    const dest = trip.destination;
    if (dest && geocodeCache[dest] === undefined) {
      trip._coords = await geocode(dest);
      await sleep(1100);
    } else {
      trip._coords = geocodeCache[dest] ?? null;
    }

    // Image
    const q = imageQuery(trip);
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
        const needsFetch = geocodeCache[wp] === undefined;
        const coord = await geocode(wp);
        if (needsFetch) await sleep(1100);
        if (coord) geocoded.push(coord);
      }
      trip._route_coords = geocoded.length >= 2 ? await fetchRoute(geocoded) : null;
    } else {
      trip._route_coords = null;
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

  return trips;
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
      for (const name of ['overview', 'route', 'stops', 'logistics']) {
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

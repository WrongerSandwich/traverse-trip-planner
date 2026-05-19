// Threat model: see src/lib/server/auth.js. PUT here rewrites home.md, which
// shapes every AI prompt (home location, vehicle, travelers, taste). An
// attacker who can write here could poison trip generation or scrub the
// constraints the AI workflows rely on. Loopback-gated by default.
import { json } from '@sveltejs/kit';
import { parseHomeMd, writeHomeMd, invalidateEnrichCache } from '$lib/server/data.js';
import { existsSync } from 'fs';
import { join } from 'path';
import { ROOT } from '$lib/server/data.js';
import { denyIfNotConfigWriter } from '$lib/server/auth.js';

/**
 * GET /api/home
 *
 * Returns home.md parsed into a structured object.
 *
 * Response shape (numbers stay numbers, booleans stay booleans, nested
 * objects like `vehicles:` / `units:` keep their structure — backed by the
 * `yaml` package, same as the brochure pipeline):
 * ```json
 * {
 *   "frontmatter": {
 *     "home_city": "Cleveland, OH",
 *     "home_coords": [41.50, -81.69],
 *     "travelers": ["alex", "sam"],
 *     "vehicles": {
 *       "car": { "model": "2019 Toyota RAV4", "type": "gas", "default": true }
 *     },
 *     "pets_need_sitter": true,
 *     "default_radius_mi": 450,
 *     "units": { "distance": "mi" }
 *   },
 *   "prose": {
 *     "preamble": "# Personal context for trip planning\n\n...",
 *     "sections": [
 *       { "heading": "Travelers and logistics", "body": "- Primary travelers: ..." },
 *       { "heading": "Vehicle notes", "body": "..." }
 *     ]
 *   }
 * }
 * ```
 *
 * PUT /api/home
 *
 * Accepts the same shape as GET. Validates required fields, writes home.md,
 * and invalidates the enrich cache. The `frontmatter` object is serialized
 * back to YAML; `prose.preamble` and `prose.sections` are rejoined as markdown.
 *
 * Validation:
 *   - `frontmatter.home_city`: required non-empty string
 *   - `frontmatter.home_coords`: array of two finite numbers; lat in [-90, 90], lon in [-180, 180]
 *
 * Returns `{ ok: true }` on success, `{ error, code }` with status 400 on validation failure.
 */

export async function GET() {
  const homePath = join(ROOT, 'home.md');
  if (!existsSync(homePath)) {
    return json({ error: 'home.md not found', code: 'home_not_found' }, { status: 404 });
  }

  const parsed = parseHomeMd();
  if (!parsed) {
    return json({ error: 'home.md could not be parsed', code: 'home_parse_error' }, { status: 500 });
  }

  const { frontmatter, prose } = parsed;
  return json({ frontmatter, prose });
}

export async function PUT(event) {
  const denied = denyIfNotConfigWriter(event);
  if (denied) return denied;

  let body;
  try {
    body = await event.request.json();
  } catch {
    return json({ error: 'Invalid JSON body.', code: 'invalid_input' }, { status: 400 });
  }

  if (body === null || typeof body !== 'object') {
    return json({ error: 'Body must be an object.', code: 'invalid_input' }, { status: 400 });
  }

  const { frontmatter, prose } = body;

  if (!frontmatter || typeof frontmatter !== 'object') {
    return json({ error: 'frontmatter must be an object.', code: 'invalid_input' }, { status: 400 });
  }
  if (!prose || typeof prose !== 'object') {
    return json({ error: 'prose must be an object.', code: 'invalid_input' }, { status: 400 });
  }

  // Validate home_city
  const homeCity = frontmatter.home_city;
  if (!homeCity || typeof homeCity !== 'string' || !homeCity.trim()) {
    return json(
      { error: 'frontmatter.home_city must be a non-empty string.', code: 'invalid_input' },
      { status: 400 },
    );
  }

  // Validate home_coords: must be [lat, lon] with two finite numbers in range
  const homeCoords = frontmatter.home_coords;
  if (
    !Array.isArray(homeCoords) ||
    homeCoords.length !== 2 ||
    !homeCoords.every((v) => typeof v === 'number' && Number.isFinite(v))
  ) {
    return json(
      { error: 'frontmatter.home_coords must be an array of two finite numbers [lat, lon].', code: 'invalid_input' },
      { status: 400 },
    );
  }

  const [lat, lon] = homeCoords;
  if (lat < -90 || lat > 90) {
    return json(
      { error: 'frontmatter.home_coords[0] (lat) must be between -90 and 90.', code: 'invalid_input' },
      { status: 400 },
    );
  }
  if (lon < -180 || lon > 180) {
    return json(
      { error: 'frontmatter.home_coords[1] (lon) must be between -180 and 180.', code: 'invalid_input' },
      { status: 400 },
    );
  }

  // Validate prose shape
  if (!Array.isArray(prose.sections)) {
    return json(
      { error: 'prose.sections must be an array.', code: 'invalid_input' },
      { status: 400 },
    );
  }

  try {
    writeHomeMd({ frontmatter, prose });
  } catch (err) {
    console.error('[home] failed to write home.md:', err);
    return json({ error: 'Failed to save home configuration.', code: 'write_failed' }, { status: 500 });
  }

  invalidateEnrichCache();
  return json({ ok: true });
}

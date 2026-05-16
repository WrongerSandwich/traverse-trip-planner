// Brochure structured-data layer.
//
// `brochure.md` per trip holds the structured content the printable
// brochure renders from — a separate artifact so editing planning notes
// doesn't silently shift the brochure. Schema is YAML frontmatter; an
// optional prose body is used as a Field guide "letter from the editor"
// on the back cover when present.
//
// Lifecycle:
//   1. User clicks Prepare brochure → prepareBrochure(slug) runs the AI
//      extraction, geocodes stops, writes brochure.md.
//   2. User can re-run to regenerate (overwrites; no merge).
//   3. The brochure render reads brochure.md exclusively when present.

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { stringify as yamlStringify, parse as yamlParse } from 'yaml';
import { findTripLocation, geocode, getTripFiles, readHomeMd, parseFrontmatter, flushCaches } from './data.js';
import { chat } from './ai.js';
import { getEffectiveConfig } from './config.js';
import { TraverseError } from './errors.js';

const BROCHURE_FILENAME = 'brochure.md';

export function brochurePath(slug) {
  const loc = findTripLocation(slug);
  if (!loc || loc.kind !== 'dir') return null; // brochure only exists for folder-stage trips
  return join(loc.path, BROCHURE_FILENAME);
}

export function readBrochure(slug) {
  const path = brochurePath(slug);
  if (!path || !existsSync(path)) return null;
  const content = readFileSync(path, 'utf8');
  return parseBrochureFile(content);
}

/**
 * Split a brochure.md file into { data, prose }. The data block is YAML
 * between --- fences; prose is everything after.
 */
export function parseBrochureFile(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return null;
  let data;
  try {
    data = yamlParse(match[1]) || {};
  } catch (err) {
    throw new Error(`brochure.md YAML parse failed: ${err.message}`);
  }
  const prose = (match[2] || '').trim();
  return { data, prose };
}

/**
 * Serialize { data, prose } back into the brochure.md file format.
 */
export function serializeBrochureFile({ data, prose = '' }) {
  const yaml = yamlStringify(data, {
    lineWidth: 0,                 // never line-wrap (predictable diffs)
    defaultStringType: 'PLAIN',
    blockQuote: 'literal',
  }).trimEnd();
  const body = prose.trim();
  return body ? `---\n${yaml}\n---\n\n${body}\n` : `---\n${yaml}\n---\n`;
}

export function writeBrochure(slug, { data, prose = '' }) {
  const path = brochurePath(slug);
  if (!path) throw new Error(`Cannot write brochure for trip "${slug}" — no folder stage found.`);
  writeFileSync(path, serializeBrochureFile({ data, prose }));
  return path;
}

// ── AI extraction ─────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are extracting structured brochure data from a road trip's planning notes.

Your job: read the trip's title, frontmatter, and section files (overview, route, stops, logistics, and itinerary if present) and produce a structured YAML document matching the schema below. The output will be saved as the trip's brochure.md and rendered into a printable Field guide brochure.

Output ONLY a single XML block:

<brochure>
title: "{Trip title — short, evocative, sentence case}"
subtitle: "{One short clause that frames the trip, sentence case, no period}"
target_date: "{ISO date if known, else omit}"
duration_days: {integer if known, else omit}

days:
  - n: 1
    date: "{ISO date if known, else omit}"
    theme: "{Short evocative phrase for the day, sentence case}"
    blocks:
      - period: morning      # one of: morning | afternoon | evening | optional
        items:
          - time: "{Approximate clock time, e.g. \\"8:00 AM\\", or omit if unscheduled}"
            activity: "{One-line description, place name + brief verb}"

stops:
  - name: "{Stop name — actual proper noun where possible}"
    category: "{One of: historic | food | lodging | outdoors | view | entertainment | misc}"
    address: "{Full address if known, else omit}"
    hours: "{e.g. \\"Wed–Sun, 9 AM–4 PM\\", else omit}"
    notes: "{One sentence on why it's worth the stop}"
    must_see: true        # only on stops that are clearly anchors of the trip

lodging:
  - name: "{Lodging name}"
    address: "{Full address if known, else omit}"
    nights: {integer}
    confirmation: "{Booking confirmation code if mentioned, else omit}"

field_guide_notes:
  - "{An observational aside in Field guide voice — specific, unhurried, reverent. Example: \\"Wildflowers should be in bloom this week at the Missouri Bluffs overlook.\\"}"

gotchas:
  - "{A practical heads-up worth surfacing on the back cover — road closures, cell coverage, reservation cutoffs, etc.}"
</brochure>

Rules:
- Skip any top-level field you don't have content for. Don't fabricate.
- Prefer specificity: real place names, real addresses, real hours. If you don't know, omit the field rather than guessing.
- For 'days', extract from the itinerary if present. If not present, propose a reasonable day-by-day shape based on duration_days + the trip's stops, but mark approximate times as "TBD" rather than guessing exact clocks.
- For 'category' on stops, default to 'misc' if uncertain.
- 'must_see' should be sparingly applied — at most 2-3 stops on a typical trip.
- 'field_guide_notes' should be 2-4 short observational asides. Voice: reverent, observational, unhurried. Avoid hype, exclamation, or promotional language. If the planning notes don't naturally surface anything quotable, return an empty list rather than fabricating.
- 'gotchas' should be 2-5 short, practical warnings. Omit if there are no real concerns.
- All free-text values are sentence-case unless the proper noun demands otherwise.

Return the YAML inside the <brochure> tags. Do not include any other prose, commentary, or markdown outside the tags.`;

function extractBrochureBlock(text) {
  const match = text.match(/<brochure>\s*([\s\S]*?)\s*<\/brochure>/);
  return match ? match[1].trim() : null;
}

/**
 * Try a sequence of geocode queries from most to least specific. The
 * first that returns coords wins. Without fallbacks, named landmarks
 * with no street address ("Bingham Home", "Sappington Museum") never
 * resolve, even though Nominatim knows them as places.
 *
 * Order:
 *   1. Stop's address (most precise; small-town addresses often fail)
 *   2. Name, destination (e.g. "J. Huston Tavern, Arrow Rock, MO")
 *   3. Name alone
 */
async function geocodeStops(stops = [], { destinationContext = '' } = {}) {
  for (const stop of stops) {
    if (stop.coords) continue;
    if (!stop.name && !stop.address) continue;

    const queries = [];
    if (stop.address) queries.push(stop.address);
    if (stop.name && destinationContext) queries.push(`${stop.name}, ${destinationContext}`);
    if (stop.name) queries.push(stop.name);

    for (const q of queries) {
      try {
        const coord = await geocode(q);
        if (coord) { stop.coords = coord; break; }
      } catch (e) {
        if (e instanceof TraverseError) throw e; // propagate quota/typed errors
        // otherwise try the next fallback query
      }
    }
  }
  return stops;
}

/**
 * Build the user-facing prompt content from the trip's existing files.
 */
function buildExtractionInput({ trip, files }) {
  const fmLines = Object.entries(trip)
    .filter(([k]) => !k.startsWith('_'))
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? `[${v.join(', ')}]` : v}`)
    .join('\n');

  const sections = Object.entries(files)
    .filter(([, body]) => typeof body === 'string' && body.trim())
    .map(([name, body]) => `<section name="${name}">\n${body}\n</section>`)
    .join('\n\n');

  return `Trip frontmatter:\n${fmLines}\n\nSection files:\n${sections}\n\nExtract the structured brochure data now.`;
}

export async function prepareBrochure(slug, { signal, onActivity } = {}) {
  const loc = findTripLocation(slug);
  if (!loc) throw new TraverseError('trip_not_found', `Trip "${slug}" not found.`);
  if (loc.kind !== 'dir') throw new TraverseError('wrong_stage', `Brochure requires a folder-stage trip (planning/completed); "${slug}" is in ${loc.stage}.`);

  // Load the trip's content
  const overviewPath = join(loc.path, 'overview.md');
  if (!existsSync(overviewPath)) {
    throw new TraverseError('missing_overview', `overview.md is required to prepare a brochure for "${slug}".`);
  }
  const tripFm = parseFrontmatter(readFileSync(overviewPath, 'utf8')) || {};
  const filesResult = getTripFiles(slug);
  const files = filesResult?.files || {};

  onActivity?.({ type: 'progress', message: 'Reading trip notes…' });

  // Call the model
  const homeMd = readHomeMd();
  const userInput = buildExtractionInput({ trip: tripFm, files });
  const system = `${SYSTEM_PROMPT}\n\nTraveler context (for tone calibration only):\n${homeMd}`;

  onActivity?.({ type: 'progress', message: 'Extracting stops, days, and notes…' });

  const { text, usage } = await chat({
    ...getEffectiveConfig().features.itinerary,  // reuse the itinerary slot — same scale of call
    label: 'brochure-prepare',
    system,
    messages: [{ role: 'user', content: userInput }],
    maxTokens: 4000,
    signal,
  });

  // Parse YAML out of the XML wrapper
  const yamlBody = extractBrochureBlock(text);
  if (!yamlBody) throw new TraverseError('model_returned_no_yaml_block', 'Model did not return a <brochure> block.');

  let data;
  try {
    data = yamlParse(yamlBody) || {};
  } catch (err) {
    throw new TraverseError('model_returned_invalid_yaml', `Returned YAML failed to parse: ${err.message}`);
  }

  // Pin the cover image: use the trip's enriched _image.large or _image.medium
  // if available. Fall back to whatever the AI may have included.
  if (!data.cover_image && tripFm._image?.large) data.cover_image = tripFm._image.large;
  if (!data.cover_image && tripFm._image?.medium) data.cover_image = tripFm._image.medium;

  // Geocode stops + lodging in place — uses the cache, almost always free
  onActivity?.({ type: 'progress', message: 'Geocoding stop addresses…' });
  const destContext = tripFm.destination || '';
  await geocodeStops(data.stops, { destinationContext: destContext });
  await geocodeStops(data.lodging, { destinationContext: destContext });
  flushCaches();

  // Write brochure.md
  writeBrochure(slug, { data, prose: '' });
  onActivity?.({ type: 'progress', message: 'Brochure ready.' });

  return { data, usage };
}

/**
 * Re-geocode any stops/lodging in an existing brochure.md that don't
 * yet have coords. Doesn't call the AI; just runs the (improved)
 * geocode fallback chain against entries that need it.
 *
 * Returns counts so the UI can show how many pins got filled in.
 */
export async function regeocodeBrochureStops(slug, { onActivity } = {}) {
  const existing = readBrochure(slug);
  if (!existing) throw new Error(`No brochure.md found for "${slug}".`);
  const { data, prose } = existing;

  const loc = findTripLocation(slug);
  const tripFm = loc?.kind === 'dir'
    ? (parseFrontmatter(readFileSync(join(loc.path, 'overview.md'), 'utf8')) || {})
    : {};
  const destContext = tripFm.destination || '';

  const beforeStops = (data.stops ?? []).filter(s => Array.isArray(s.coords)).length;
  const beforeLodging = (data.lodging ?? []).filter(s => Array.isArray(s.coords)).length;

  onActivity?.({ type: 'progress', message: 'Trying fallback queries for missing pins…' });
  if (data.stops) await geocodeStops(data.stops, { destinationContext: destContext });
  if (data.lodging) await geocodeStops(data.lodging, { destinationContext: destContext });
  flushCaches();

  const afterStops = (data.stops ?? []).filter(s => Array.isArray(s.coords)).length;
  const afterLodging = (data.lodging ?? []).filter(s => Array.isArray(s.coords)).length;

  writeBrochure(slug, { data, prose });
  return {
    stopsAdded: afterStops - beforeStops,
    lodgingAdded: afterLodging - beforeLodging,
    stopsTotal: data.stops?.length ?? 0,
    stopsLocated: afterStops,
  };
}

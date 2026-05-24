// Candidate pool layer.
//
// `candidates.yaml` holds the wide net of stops + lodging the researcher
// surfaced, plus anything the user added manually. "In plan" status is
// computed from membership in plan.yaml, NOT stored here.
//
// Migration: on first read, if `candidates.md` exists and `candidates.yaml`
// doesn't, the legacy file is migrated automatically. Idempotent.

import { readFileSync, existsSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { stringify as yamlStringify, parse as yamlParse } from 'yaml';
import { atomicWrite } from './atomic-write.js';
import { findTripLocation, geocode } from './data.js';
import { TraverseError } from './errors.js';
// Circular with plan.js — safe only because unPromoteCandidate is invoked lazily
// (call-time, not module-init). Don't add top-level uses of plan.js exports here.
import { unPromoteCandidate } from './plan.js';

const CANDIDATES_FILENAME = 'candidates.yaml';
const CANDIDATES_LEGACY_FILENAME = 'candidates.md';

export function emptyCandidates() {
  return { stops: [], lodging: [] };
}

export function candidatesPath(slug) {
  const loc = findTripLocation(slug);
  if (!loc || loc.kind !== 'dir') return null;
  return join(loc.path, CANDIDATES_FILENAME);
}

/**
 * Migrate candidates.md → candidates.yaml on first read (one-shot, idempotent).
 */
function migrateCandidatesIfNeeded(slug) {
  const loc = findTripLocation(slug);
  if (!loc || loc.kind !== 'dir') return;
  const yamlPath = join(loc.path, CANDIDATES_FILENAME);
  const legacyPath = join(loc.path, CANDIDATES_LEGACY_FILENAME);
  if (existsSync(yamlPath) || !existsSync(legacyPath)) return;
  try {
    const content = readFileSync(legacyPath, 'utf8');
    const parsed = parseCandidatesFile(content);
    if (parsed) {
      writeFileSync(yamlPath, serializeCandidatesFile(parsed));
      unlinkSync(legacyPath);
    }
  } catch (e) {
    console.warn(`candidates.js: migration of candidates.md failed for "${slug}" —`, e.message);
    // Rethrow parse errors (TraverseError) so callers know the data is invalid.
    // Other errors (fs failures) are swallowed so a missing file doesn't break reads.
    if (e?.code === 'model_returned_invalid_yaml') throw e;
  }
}

export function readCandidates(slug) {
  migrateCandidatesIfNeeded(slug);
  const path = candidatesPath(slug);
  if (!path || !existsSync(path)) return null;
  const content = readFileSync(path, 'utf8');
  return parseCandidatesFile(content);
}

/**
 * Parse a candidates file. Accepts both formats:
 *   - Legacy: `---\nYAML\n---\n` (frontmatter-wrapped markdown, candidates.md)
 *   - New:    bare YAML (candidates.yaml)
 */
export function parseCandidatesFile(content) {
  let yamlBlock;
  const fenceMatch = content.match(/^---\n([\s\S]*?)\n?---\n?([\s\S]*)$/);
  if (fenceMatch) {
    yamlBlock = fenceMatch[1];
  } else {
    yamlBlock = content;
  }
  let data;
  try {
    data = yamlParse(yamlBlock) || {};
  } catch (err) {
    throw new TraverseError('model_returned_invalid_yaml', `candidates.yaml YAML parse failed: ${err.message}`);
  }
  return {
    stops: Array.isArray(data.stops) ? data.stops : [],
    lodging: Array.isArray(data.lodging) ? data.lodging : [],
  };
}

/** Serialize candidates to pure YAML (no frontmatter fences). */
export function serializeCandidatesFile(cands) {
  return yamlStringify(cands, {
    lineWidth: 0,
    defaultStringType: 'PLAIN',
    blockQuote: 'literal',
  });
}

export function writeCandidates(slug, cands) {
  const path = candidatesPath(slug);
  if (!path) throw new Error(`Cannot write candidates for trip "${slug}" — no folder stage found.`);
  atomicWrite(path, serializeCandidatesFile(cands));
  return path;
}

const SLUG_RE = /[^a-z0-9]+/g;

export function makeCandidateId(name, existingIds) {
  const base = String(name).toLowerCase().replace(SLUG_RE, '-').replace(/^-|-$/g, '') || 'candidate';
  const taken = new Set(existingIds);
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

export const STOP_CATEGORIES = [
  'historic', 'food', 'outdoors', 'view', 'entertainment',
  'cultural', 'quirky', 'shopping', 'misc',
];

export const LODGING_PRICE_TIERS = ['budget', 'mid', 'splurge'];

function loadOrInit(slug) {
  return readCandidates(slug) || emptyCandidates();
}

function allIds(cands) {
  return [...cands.stops.map((s) => s.id), ...cands.lodging.map((l) => l.id)];
}

export function addCandidateStop(slug, fields) {
  const cands = loadOrInit(slug);
  const id = makeCandidateId(fields.name, allIds(cands));
  cands.stops.push({
    id,
    name: fields.name,
    category: STOP_CATEGORIES.includes(fields.category) ? fields.category : 'misc',
    description: fields.description || '',
    why_recommended: fields.why_recommended || '',
    source_url: fields.source_url || '',
    coords: fields.coords,
    user_added: true,
  });
  writeCandidates(slug, cands);
  return id;
}

export function addCandidateLodging(slug, fields) {
  const cands = loadOrInit(slug);
  const id = makeCandidateId(fields.name, allIds(cands));
  cands.lodging.push({
    id,
    name: fields.name,
    description: fields.description || '',
    price_tier: LODGING_PRICE_TIERS.includes(fields.price_tier) ? fields.price_tier : 'mid',
    nights: fields.nights,
    booking_url: fields.booking_url || '',
    coords: fields.coords,
    user_added: true,
  });
  writeCandidates(slug, cands);
  return id;
}

export function deleteCandidate(slug, id) {
  const existing = readCandidates(slug);
  const inStops = existing?.stops.some((s) => s.id === id) ?? false;
  const inLodging = existing?.lodging.some((l) => l.id === id) ?? false;
  if (!inStops && !inLodging) return; // id matches nothing; avoid materializing empty files
  unPromoteCandidate(slug, id);
  const cands = loadOrInit(slug);
  cands.stops = cands.stops.filter((s) => s.id !== id);
  cands.lodging = cands.lodging.filter((l) => l.id !== id);
  writeCandidates(slug, cands);
}

export function deleteCandidateStop(slug, id) {
  const existing = readCandidates(slug);
  if (!existing?.stops.some((s) => s.id === id)) return; // not a stop; no-op
  unPromoteCandidate(slug, id);
  const cands = loadOrInit(slug);
  cands.stops = cands.stops.filter((s) => s.id !== id);
  writeCandidates(slug, cands);
}

export function deleteCandidateLodging(slug, id) {
  const existing = readCandidates(slug);
  if (!existing?.lodging.some((l) => l.id === id)) return; // not a lodging; no-op
  unPromoteCandidate(slug, id);
  const cands = loadOrInit(slug);
  cands.lodging = cands.lodging.filter((l) => l.id !== id);
  writeCandidates(slug, cands);
}

/**
 * Toggle the `hidden` flag on a candidate (stop or lodging). The flag is
 * the persistence layer for the "whittle" gesture in CandidatesSection —
 * users discard candidates they don't want without deleting the file
 * record, so the seeder still avoids re-suggesting them and the user can
 * un-hide if they change their mind.
 *
 * `hidden: false` is normalized to deleting the field so a fresh file
 * stays clean (default-visible). `hidden: true` writes the field.
 *
 * **Re-extract persistence (Option B):** When hiding a researcher-sourced
 * candidate (`user_added: false`), we also flip `user_added` to `true` so
 * the existing merge logic in `extractCandidates` treats this entry as
 * user-owned and preserves it across re-extracts. When un-hiding, we flip
 * `user_added` back to `false` so the entry is again replaceable by a
 * fresh researcher run (the candidate can reappear if the model still
 * suggests it). User-added candidates (`user_added: true` before this
 * call) are unaffected by the flip — they stay `user_added: true`
 * regardless.
 *
 * Returns the updated candidate object, or `null` if `id` matches
 * nothing in either array.
 */
export function setCandidateHidden(slug, id, hidden) {
  const cands = loadOrInit(slug);
  let updated = null;
  for (const s of cands.stops) {
    if (s.id !== id) continue;
    if (hidden) {
      s.hidden = true;
      // Flip researcher-sourced candidate to user_added so re-extract preserves it.
      if (!s.user_added) s.user_added = true;
    } else {
      delete s.hidden;
      // Restore researcher ownership so a future re-extract can replace it.
      // Only revert if the candidate was a researcher candidate that we flipped
      // on hide (i.e. it is not genuinely user-added, which we can tell by the
      // absence of other user_added signals — but we can't know post-flip).
      // Conservative choice: always revert to false on un-hide. A genuinely
      // user-added candidate that was hidden then un-hidden will become
      // researcher-replaceable, but that edge case is far less harmful than
      // hidden discards reappearing after re-extract.
      s.user_added = false;
    }
    updated = s;
    break;
  }
  if (!updated) {
    for (const l of cands.lodging) {
      if (l.id !== id) continue;
      if (hidden) {
        l.hidden = true;
        if (!l.user_added) l.user_added = true;
      } else {
        delete l.hidden;
        l.user_added = false;
      }
      updated = l;
      break;
    }
  }
  if (!updated) return null;
  // Hiding a promoted candidate is contradictory — un-promote first so plan.yaml
  // doesn't reference an invisible candidate. Un-hiding doesn't touch the plan.
  if (hidden) unPromoteCandidate(slug, id);
  writeCandidates(slug, cands);
  return updated;
}

// ── Geocoding helpers ─────────────────────────────────────────────────────────
//
// Shared by extract-candidates.js and any new endpoint that needs to geocode
// candidate names with destination-scoped disambiguation. Extracted here so
// downstream route handlers can import without creating circular dependencies.

// Same threshold as the prior extract-candidates implementation.
// Anything farther than this from the destination is treated as a same-name
// collision and dropped.
export const MAX_CANDIDATE_DISTANCE_MI = 200;
const NOMINATIM_THROTTLE_MS = 1100;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function distanceMi(a, b) {
  const lat1 = a[0], lng1 = a[1];
  const lat2 = b[0], lng2 = b[1];
  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return Infinity;
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 3959;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

/**
 * Resolve the destination's coords once so candidate lookups can be
 * sanity-checked against it. Returns null on geocode failure (rate-limit,
 * outage). When null, callers must skip the bare-name fallback in
 * geocodeCandidate to avoid same-name collisions.
 */
export async function getDestinationRefCoords(destinationContext) {
  if (!destinationContext) return null;
  return await geocode(destinationContext);
}

/**
 * Geocode a single candidate with destination-scoped disambiguation.
 * Returns `[lat, lng]` or `null` if no plausible match.
 *
 * Order of attempts:
 *   1. "<name>, <destination>" — scoped query first
 *   2. "<name>" alone — bare fallback, only accepted if within
 *      MAX_CANDIDATE_DISTANCE_MI of refCoords
 *
 * Bare fallback is skipped entirely when refCoords is null — without a
 * reference, any same-name collision passes the (skipped) distance check.
 *
 * Throttles between calls so callers can run this in a loop without
 * hitting Nominatim's 1 req/sec ToS limit.
 */
export async function geocodeCandidate(name, destinationContext, refCoords) {
  let coords = null;
  if (destinationContext) {
    const scoped = await geocode(`${name}, ${destinationContext}`);
    if (scoped && (!refCoords || distanceMi(scoped, refCoords) <= MAX_CANDIDATE_DISTANCE_MI)) {
      coords = scoped;
    }
  }
  if (!coords && refCoords) {
    const bare = await geocode(name);
    if (bare && distanceMi(bare, refCoords) <= MAX_CANDIDATE_DISTANCE_MI) {
      coords = bare;
    } else if (bare) {
      console.warn(
        `geocodeCandidate: dropped "${name}" geocode — bare result was ${Math.round(distanceMi(bare, refCoords))}mi from destination "${destinationContext}" (likely a same-name collision)`
      );
    }
  }
  await sleep(NOMINATIM_THROTTLE_MS);
  return coords;
}

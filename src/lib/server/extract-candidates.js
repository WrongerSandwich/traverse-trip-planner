// Extractor pass — runs after research to populate plan.yaml
// and candidates.yaml from the prose research output.
//
// Inputs: home.md + the four research sections (overview/route/stops/logistics).
// Outputs: plan.yaml (cover_query, field_guide_notes, gotchas; days empty) and
// candidates.yaml (stops + lodging, with assigned ids and `user_added: false`).
//
// The prompt asks the model for a fixed XML envelope (<extract><plan>YAML</plan>
// <candidates>YAML</candidates></extract>) so we get cheap, regex-cut parsing
// at the outer layer and structured YAML at the inner — the same dual-format
// shape the deepen call uses for its section tags.

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { parse as yamlParse } from 'yaml';
import { chat } from './ai.js';
import {
  atomicWrite,
  findTripFile,
  geocode,
  getTripFiles,
  parseFrontmatter,
  readHomeMd,
  removeFrontmatterField,
  setFrontmatterField,
} from './data.js';
import { readPlan, emptyPlan, planPath, serializePlanFile } from './plan.js';
import { readCandidates, emptyCandidates, makeCandidateId, STOP_CATEGORIES, LODGING_PRICE_TIERS, candidatesPath, serializeCandidatesFile } from './candidates.js';
import { getEffectiveConfig } from './config.js';
import { TraverseError } from './errors.js';
import { MAX_TOKENS } from './promises.js';

const SYSTEM_PROMPT = `You extract a structured plan + candidate pool from a road trip's planning notes.

INPUTS you will receive in the user message:
- home.md frontmatter + preferences (taste/constraints)
- overview.md, route.md, stops.md, logistics.md prose

OUTPUT exactly one XML block, nothing else:

<extract>
<plan>
cover_query: <2-4 concrete visual nouns for a Pexels hero photo — reward specific landmarks/terrain over atmospheric words, e.g. "Cincinnati Italianate architecture neon" or "Glacier alpine lake mountains">
field_guide_notes:
  - <One trip-wide note worth surfacing on the printable brochure>
  - <Another note, if any>
gotchas:
  - <One closure, permit, cell-dead zone, or seasonal restriction>
  - <Another gotcha, if any>
</plan>
<candidates>
stops:
  - name: <Place name>
    category: <one of: ${STOP_CATEGORIES.join(' | ')}>
    description: <1 sentence>
    why_recommended: <1 sentence linking to trip vibe / home preferences>
    source_url: <best source if any>
lodging:
  - name: <Lodging name>
    description: <1 sentence>
    price_tier: <budget | mid | splurge>
    nights: <typical recommended nights, integer, optional>
    booking_url: <best source if any>
</candidates>
</extract>

Aim for 8–15 stop candidates spanning categories (do NOT only pick outdoors). Aim for 2–5 lodging candidates at varying price tiers. Pull every concrete place mentioned in stops.md, plus any worth-mentioning bonus the prose hints at. Skip restaurants unless the trip is food-themed. Skip "id" and "coords" — those are added later.`;

// One outer envelope + two inner blocks. The outer match anchors the parser
// so stray prose around the XML doesn't bleed into the YAML.
const EXTRACT_RE = /<extract>([\s\S]*?)<\/extract>/;
const PLAN_RE = /<plan>([\s\S]*?)<\/plan>/;
const CANDIDATES_RE = /<candidates>([\s\S]*?)<\/candidates>/;

export async function extractCandidates(slug, { signal, onActivity } = {}) {
  const tripResult = getTripFiles(slug);
  if (!tripResult) throw new TraverseError('trip_not_found', `extractCandidates: trip "${slug}" not found.`);
  const { files } = tripResult;
  const home = readHomeMd();
  const userMessage = `# home.md\n${home}\n\n# overview.md\n${files.overview ?? ''}\n\n# route.md\n${files.route ?? ''}\n\n# stops.md\n${files.stops ?? ''}\n\n# logistics.md\n${files.logistics ?? ''}`;

  // `features.extract` is optional in config; fall back to the deepen feature
  // so extraction inherits the research model unless the user configures a
  // dedicated one. See config.js — neither slot is mandatory.
  const cfg = getEffectiveConfig();
  const featureCfg = cfg.features?.extract ?? cfg.features?.deepen;
  const { text, usage } = await chat({
    ...featureCfg,
    label: 'extract-candidates',
    maxTokens: MAX_TOKENS.extract ?? 8000,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
    signal,
    onActivity,
  });

  const extract = EXTRACT_RE.exec(text);
  if (!extract) throw new TraverseError('model_returned_invalid_yaml', `extract-candidates: missing <extract> block`);

  const planMatch = PLAN_RE.exec(extract[1]);
  const candMatch = CANDIDATES_RE.exec(extract[1]);
  if (!planMatch || !candMatch) {
    throw new TraverseError('model_returned_invalid_yaml', `extract-candidates: missing <plan> or <candidates> block`);
  }

  let planData, candData;
  try {
    planData = yamlParse(planMatch[1]) || {};
    candData = yamlParse(candMatch[1]) || {};
  } catch (err) {
    throw new TraverseError('model_returned_invalid_yaml', `extract-candidates YAML parse failed: ${err.message}`);
  }

  // Build plan: prose fields, days empty. The user assembles days in the UI.
  // field_guide_notes and gotchas are stored as arrays; we normalise whatever
  // the model emitted (array → passthrough; block string → split on newlines).
  const plan = emptyPlan();
  plan.cover_query = typeof planData.cover_query === 'string' && planData.cover_query.trim() ? planData.cover_query.trim() : null;
  plan.field_guide_notes = Array.isArray(planData.field_guide_notes)
    ? planData.field_guide_notes.map(String).filter(Boolean)
    : (typeof planData.field_guide_notes === 'string'
        ? planData.field_guide_notes.split('\n').map(l => l.replace(/^\s*[-*•]\s+/, '').trim()).filter(Boolean)
        : []);
  plan.gotchas = Array.isArray(planData.gotchas)
    ? planData.gotchas.map(String).filter(Boolean)
    : (typeof planData.gotchas === 'string'
        ? planData.gotchas.split('\n').map(l => l.replace(/^\s*[-*•]\s+/, '').trim()).filter(Boolean)
        : []);

  // Build candidates with assigned ids. `seenIds` accumulates across both
  // stops and lodging so a stop and a lodging that happen to share a name
  // (e.g. "Whitefish Lodge" the bar vs the inn) don't collide.
  const cands = emptyCandidates();
  const seenIds = [];
  for (const raw of candData.stops ?? []) {
    if (!raw?.name) continue;
    const id = makeCandidateId(raw.name, seenIds);
    seenIds.push(id);
    cands.stops.push({
      id,
      name: raw.name,
      category: STOP_CATEGORIES.includes(raw.category) ? raw.category : 'misc',
      description: raw.description ?? '',
      why_recommended: raw.why_recommended ?? '',
      source_url: raw.source_url ?? '',
      user_added: false,
    });
  }
  for (const raw of candData.lodging ?? []) {
    if (!raw?.name) continue;
    const id = makeCandidateId(raw.name, seenIds);
    seenIds.push(id);
    cands.lodging.push({
      id,
      name: raw.name,
      description: raw.description ?? '',
      price_tier: LODGING_PRICE_TIERS.includes(raw.price_tier) ? raw.price_tier : 'mid',
      nights: typeof raw.nights === 'number' ? raw.nights : undefined,
      booking_url: raw.booking_url ?? '',
      user_added: false,
    });
  }

  // Merge with prior plan + candidates so re-extracting doesn't blow away the
  // user's day-by-day work or anything they added manually.
  // Rules (see Task 7.1):
  //   - plan.days is preserved untouched (never auto-unpromoted; orphan ids
  //     become "dangling" and surface in the UI banner).
  //   - Researcher-sourced candidates (user_added: false) are wholesale-replaced
  //     by the new extraction (already the case, since `cands` is built fresh).
  //   - User-added candidates (user_added: true) are preserved, with ids
  //     reassigned via makeCandidateId on collision with new researcher ids.
  const existingPlan = readPlan(slug);
  const existingCands = readCandidates(slug);

  if (existingPlan) {
    plan.days = existingPlan.days;
  }

  // Track id renames across the merge pass so we can rewrite plan.days
  // references and surface a banner on the detail page (#349).
  const renames = new Map();

  if (existingCands) {
    const userAddedStops = (existingCands.stops ?? []).filter((s) => s.user_added);
    const userAddedLodging = (existingCands.lodging ?? []).filter((l) => l.user_added);

    // Hidden user-added entries are discards — if the model re-suggests the same
    // id, the discard wins. Strip the fresh researcher entry so the hidden entry
    // keeps its original id (no rename to -2) and the duplicate visible copy never
    // appears. Without this, the merge renames the hidden entry and leaves a fresh
    // visible copy at the original id — exactly what the user rejected.
    const hiddenUserIds = new Set([
      ...userAddedStops.filter((s) => s.hidden).map((s) => s.id),
      ...userAddedLodging.filter((l) => l.hidden).map((l) => l.id),
    ]);
    if (hiddenUserIds.size > 0) {
      cands.stops = cands.stops.filter((s) => !hiddenUserIds.has(s.id));
      cands.lodging = cands.lodging.filter((l) => !hiddenUserIds.has(l.id));
    }

    const newIds = new Set([...cands.stops.map((s) => s.id), ...cands.lodging.map((l) => l.id)]);
    // Track id renames so we can rewrite plan.days references — without this,
    // a user's promoted day silently re-binds to whichever researcher candidate
    // took the original slug (real data corruption, no dangling-banner warning).

    for (const u of userAddedStops) {
      const idToUse = newIds.has(u.id) ? makeCandidateId(u.name, [...newIds]) : u.id;
      if (idToUse !== u.id) renames.set(u.id, idToUse);
      newIds.add(idToUse);
      cands.stops.push({ ...u, id: idToUse });
    }
    for (const u of userAddedLodging) {
      const idToUse = newIds.has(u.id) ? makeCandidateId(u.name, [...newIds]) : u.id;
      if (idToUse !== u.id) renames.set(u.id, idToUse);
      newIds.add(idToUse);
      cands.lodging.push({ ...u, id: idToUse });
    }

    if (renames.size > 0) {
      plan.days = plan.days.map((d) => {
        const next = { ...d };
        next.stops = (d.stops ?? []).map((id) => renames.get(id) ?? id);
        if (d.lodging_id && renames.has(d.lodging_id)) {
          next.lodging_id = renames.get(d.lodging_id);
        }
        return next;
      });
    }
  }

  // Geocode every candidate that doesn't already have coords. Without this,
  // every brochure stop renders as "unmapped" and the destination map is empty.
  // We use the trip's destination as a fallback query to disambiguate places
  // with common names ("Lake McDonald" alone hits dozens of lakes).
  const overviewFm = parseFrontmatter(files.overview ?? '') || {};
  const destinationContext = overviewFm.destination ?? '';
  await geocodeCandidates(cands, destinationContext);

  // Write both files atomically: stage each to a .tmp first, then rename both
  // so a mid-write crash cannot leave plan.yaml updated while candidates.yaml is stale.
  const pPath = planPath(slug);
  const cPath = candidatesPath(slug);
  if (!pPath || !cPath) throw new Error(`Cannot write plan/candidates for trip "${slug}" — no folder stage found.`);
  const pTmp = `${pPath}.tmp`;
  const cTmp = `${cPath}.tmp`;
  writeFileSync(pTmp, serializePlanFile(plan));
  writeFileSync(cTmp, serializeCandidatesFile(cands));
  renameSync(pTmp, pPath);
  renameSync(cTmp, cPath);

  // Persist renames into overview frontmatter so the detail page can surface
  // a one-time dismissible banner ("Re-research renamed N of your custom
  // candidates…"). The field is removed once the user dismisses the banner.
  // When no renames occurred this run, clear any stale notice from a prior run.
  const overviewFilePath = findTripFile(slug);
  if (overviewFilePath && existsSync(overviewFilePath)) {
    let overviewContent = readFileSync(overviewFilePath, 'utf8');
    if (renames.size > 0) {
      // Inline YAML list of {from, to} pairs — compact JSON form is valid YAML.
      const renamesYaml = JSON.stringify([...renames.entries()].map(([from, to]) => ({ from, to })));
      overviewContent = setFrontmatterField(overviewContent, 'last_extract_renames', renamesYaml);
    } else {
      overviewContent = removeFrontmatterField(overviewContent, 'last_extract_renames');
    }
    atomicWrite(overviewFilePath, overviewContent);
  }

  // Build the renames array for callers that want to inspect or log them.
  const renamesArray = [...renames.entries()].map(([from, to]) => ({ from, to }));
  return { usage, renames: renamesArray };
}

// Sequential geocoding — Nominatim rate-limits to 1 req/sec. The geocode()
// helper caches results so repeat runs are cheap. Cache hits short-circuit
// without a network call, so re-extraction stays fast even with the loop.
//
// Disambiguation: Nominatim almost always returns *something* for a bare
// name query, even when the name collides across regions (e.g. "Bear Lake"
// hits dozens of lakes worldwide). The previous order tried the bare name
// first and fell back to scoped only on null — which meant the scoped
// fallback never ran, and same-name places thousands of miles away
// hijacked the result (#347). We now try the scoped query first AND
// sanity-check every result against the destination's coords. Anything
// beyond MAX_CANDIDATE_DISTANCE_MI is treated as a same-name collision
// and dropped rather than pinned to the wrong continent.
const MAX_CANDIDATE_DISTANCE_MI = 200;

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
 * Geocode a candidate with destination-scoped disambiguation and a
 * distance sanity check. Returns `[lat, lng]` or `null`.
 *
 * Order of attempts:
 *   1. "<name>, <destination>" — scoped query first so common names
 *      resolve to the right region
 *   2. "<name>" alone — bare fallback, only accepted if it lands within
 *      MAX_CANDIDATE_DISTANCE_MI of the reference coords
 *
 * Either attempt is rejected if its result is too far from `refCoords`.
 * When `refCoords` is null (rare — destination didn't geocode itself),
 * we skip the distance check and accept the first non-null result.
 */
async function geocodeWithDisambiguation(name, destinationContext, refCoords) {
  if (destinationContext) {
    const scoped = await geocode(`${name}, ${destinationContext}`);
    if (scoped && (!refCoords || distanceMi(scoped, refCoords) <= MAX_CANDIDATE_DISTANCE_MI)) {
      return scoped;
    }
  }
  const bare = await geocode(name);
  if (bare && (!refCoords || distanceMi(bare, refCoords) <= MAX_CANDIDATE_DISTANCE_MI)) {
    return bare;
  }
  if (bare && refCoords) {
    console.warn(
      `extract-candidates: dropped "${name}" geocode — bare result was ${Math.round(distanceMi(bare, refCoords))}mi from destination "${destinationContext}" (likely a same-name collision)`
    );
  }
  return null;
}

async function geocodeCandidates(cands, destinationContext) {
  // Reference point for the sanity check. Skip if there's no destination
  // string or if it can't be geocoded (rare; the trip wouldn't render its
  // overview map either in that case).
  const refCoords = destinationContext ? await geocode(destinationContext) : null;

  for (const c of [...cands.stops, ...cands.lodging]) {
    // Hidden candidates are user discards — skip geocoding them. They won't
    // appear on any map and re-geocoding a rejected place is wasteful.
    if (c.hidden) continue;

    // Self-heal pre-existing bad coords: if a candidate already has coords
    // but they're far from the destination, they were almost certainly
    // mis-geocoded by the previous (bare-first) logic. Re-geocode through
    // the new disambiguation path. If the existing coords look plausible,
    // leave them alone.
    if (c.coords && refCoords) {
      const existing = [Number(c.coords.lat), Number(c.coords.lng)];
      if (distanceMi(existing, refCoords) <= MAX_CANDIDATE_DISTANCE_MI) continue;
      console.warn(
        `extract-candidates: re-geocoding "${c.name}" — existing coords were ${Math.round(distanceMi(existing, refCoords))}mi from destination (above ${MAX_CANDIDATE_DISTANCE_MI}mi sanity threshold)`
      );
    } else if (c.coords) {
      // No reference to validate against; trust the existing coords.
      continue;
    }
    const coords = await geocodeWithDisambiguation(c.name, destinationContext, refCoords);
    if (coords) {
      c.coords = { lat: coords[0], lng: coords[1] };
    } else if (c.coords) {
      // We're here because we tried to re-geocode an existing-but-suspicious
      // coord and got nothing usable. Remove the bad coord so the map shows
      // the candidate as unmapped rather than pinned to the wrong continent.
      delete c.coords;
    }
  }
}

// Exported for tests; the disambiguation behavior is the contract that
// matters here, not the unit's internal call signature.
export const __testing__ = { geocodeCandidates, geocodeWithDisambiguation, distanceMi, MAX_CANDIDATE_DISTANCE_MI };

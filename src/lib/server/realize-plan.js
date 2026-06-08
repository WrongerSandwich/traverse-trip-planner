// Post-LLM half of the deepen pipeline.
//
// `realizePlan(slug, parsedExtract, { signal })` accepts the already-parsed
// `plan` and `candidates` YAML blocks that `doResearch()` carved out of the
// unified envelope, then runs the deterministic work: merge with any prior
// user-added candidates, write plan.yaml + candidates.yaml atomically, and
// persist any id-rename notice to the overview frontmatter.
//
// Geocoding moved out of this module in issue #382. Candidates land with
// `coords: undefined`; the deepen handler kicks off a separate
// `geocode-candidates` background job that fills coords in incrementally so
// the deepen pill completes ~15s sooner.
//
// This module does NOT call chat(); the LLM call lives in doResearch(). The
// module was renamed from extract-candidates.js as part of issue #380 — the
// extractor's "fetch the model output and process it" became "process the
// already-fetched model output."

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import {
  atomicWrite,
  findTripFile,
  getTripFiles,
  removeFrontmatterField,
  setFrontmatterField,
} from './data.js';
import {
  emptyPlan,
  planPath,
  readPlan,
  serializePlanFile,
} from './plan.js';
import {
  candidatesPath,
  emptyCandidates,
  LODGING_PRICE_TIERS,
  makeCandidateId,
  readCandidates,
  serializeCandidatesFile,
  STOP_CATEGORIES,
} from './candidates.js';
import { TraverseError } from './errors.js';

/**
 * @param {string} slug
 * @param {{ plan?: object, candidates?: object }} parsedExtract — the
 *   already-parsed `<plan>` and `<candidates>` YAML blocks from the unified
 *   deepen envelope. doResearch() parses them; this function consumes them.
 * @param {{ signal?: AbortSignal }} [opts] — `signal` is accepted for API
 *   symmetry with the prior extractCandidates contract; the function itself
 *   makes no abortable calls (candidates are written without geocoding; the
 *   follow-on geocode-candidates job handles the abortable Nominatim work).
 */
export async function realizePlan(slug, parsedExtract, _opts = {}) {
  const tripResult = getTripFiles(slug);
  if (!tripResult) throw new TraverseError('trip_not_found', `realizePlan: trip "${slug}" not found.`);

  const planData = parsedExtract?.plan ?? {};
  const candData = parsedExtract?.candidates ?? {};

  // Build plan: prose fields, days empty. The user assembles days in the UI.
  // field_guide_notes and gotchas are stored as arrays; we normalise whatever
  // the model emitted (array → passthrough; block string → split on newlines).
  const plan = emptyPlan();
  plan.cover_query = typeof planData.cover_query === 'string' && planData.cover_query.trim()
    ? planData.cover_query.trim()
    : null;
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
      ...(typeof raw.address === 'string' && raw.address.trim() ? { address: raw.address.trim() } : {}),
      ...(typeof raw.hours === 'string' && raw.hours.trim() ? { hours: raw.hours.trim() } : {}),
      // website/phone get the same format rules the enrich-candidates job applies
      // (enrich-job.js validateField): drop a website without an http(s) scheme and
      // a digit-less phone, rather than persisting the raw string to candidates.yaml.
      ...(typeof raw.website === 'string' && /^https?:\/\//i.test(raw.website.trim()) ? { website: raw.website.trim() } : {}),
      ...(typeof raw.phone === 'string' && raw.phone.trim() && /\d/.test(raw.phone) ? { phone: raw.phone.trim() } : {}),
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

  // Merge with prior plan + candidates so re-realize doesn't blow away the
  // user's day-by-day work or anything they added manually. Rules:
  //   - plan.days is preserved untouched (orphan ids become "dangling" and
  //     surface in the UI banner).
  //   - Researcher-sourced candidates (user_added: false) are wholesale-replaced
  //     by the new extraction (already the case, since `cands` is built fresh).
  //   - User-added candidates (user_added: true) are preserved, with ids
  //     reassigned via makeCandidateId on collision with new researcher ids.
  //   - Pre-existing coords on any candidate (user-added or otherwise) are
  //     preserved when the new researcher entry doesn't carry coords of its
  //     own. The follow-on geocode-candidates job only fills in coords that
  //     are missing, so already-pinned candidates stay pinned across re-realize.
  const existingPlan = readPlan(slug);
  const existingCands = readCandidates(slug);

  if (existingPlan) {
    plan.days = existingPlan.days;
  }

  // Track id renames across the merge pass so we can rewrite plan.days
  // references and surface a banner on the detail page (#349).
  const renames = new Map();

  // Preserve coords from any prior candidate of the same id, so the
  // geocode-candidates job only has to fill in the freshly-extracted entries
  // that don't already have coords on disk.
  if (existingCands) {
    const priorCoordsById = new Map();
    for (const s of existingCands.stops ?? []) {
      if (s.id && s.coords) priorCoordsById.set(s.id, s.coords);
    }
    for (const l of existingCands.lodging ?? []) {
      if (l.id && l.coords) priorCoordsById.set(l.id, l.coords);
    }
    for (const c of cands.stops) {
      if (!c.coords && priorCoordsById.has(c.id)) c.coords = priorCoordsById.get(c.id);
    }
    for (const c of cands.lodging) {
      if (!c.coords && priorCoordsById.has(c.id)) c.coords = priorCoordsById.get(c.id);
    }

    const priorPrepById = new Map();
    for (const s of existingCands.stops ?? []) {
      if (s.id && (s.tips || s.todos || s.status || s.note)) {
        priorPrepById.set(s.id, { tips: s.tips, todos: s.todos, status: s.status, note: s.note });
      }
    }
    for (const c of cands.stops) {
      const prior = priorPrepById.get(c.id);
      if (prior) {
        if (prior.tips) c.tips = prior.tips;
        if (prior.todos) c.todos = prior.todos;
        if (prior.status) c.status = prior.status;
        if (prior.note) c.note = prior.note;
      }
    }
  }

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

  // Geocoding deferred to the follow-on `geocode-candidates` background job
  // (issue #382). Candidates land with `coords: undefined`; the geocode job
  // reads candidates.yaml from disk, runs the Nominatim loop, and writes back
  // incrementally so the deepen pill completes without waiting on the ~15s
  // throttle. Disambiguation logic (destination-ref distance check) lives in
  // geocode-job.js and reuses `getDestinationRefCoords` / `geocodeCandidate`
  // from candidates.js — the same per-candidate semantics, just off the
  // critical path.

  // We still need to read the overview file (raw) so the rename-notice write
  // at the bottom can mutate frontmatter without dropping prose.
  const overviewFilePath = findTripFile(slug);
  const overviewRaw = overviewFilePath && existsSync(overviewFilePath)
    ? readFileSync(overviewFilePath, 'utf8')
    : '';

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
  if (overviewFilePath && overviewRaw) {
    let overviewContent = overviewRaw;
    if (renames.size > 0) {
      const renamesYaml = JSON.stringify([...renames.entries()].map(([from, to]) => ({ from, to })));
      overviewContent = setFrontmatterField(overviewContent, 'last_extract_renames', renamesYaml);
    } else {
      overviewContent = removeFrontmatterField(overviewContent, 'last_extract_renames');
    }
    atomicWrite(overviewFilePath, overviewContent);
  }

  // Build the renames array for callers that want to inspect or log them.
  const renamesArray = [...renames.entries()].map(([from, to]) => ({ from, to }));
  return { renames: renamesArray };
}

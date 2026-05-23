// Extractor pass — runs after research to populate plan.md frontmatter
// and candidates.md from the prose research output.
//
// Inputs: home.md + the four research sections (overview/route/stops/logistics).
// Outputs: plan.md (cover_query, field_guide_notes, gotchas; days empty) and
// candidates.md (stops + lodging, with assigned ids and `user_added: false`).
//
// The prompt asks the model for a fixed XML envelope (<extract><plan>YAML</plan>
// <candidates>YAML</candidates></extract>) so we get cheap, regex-cut parsing
// at the outer layer and structured YAML at the inner — the same dual-format
// shape the deepen call uses for its section tags.

import { parse as yamlParse } from 'yaml';
import { chat } from './ai.js';
import { getTripFiles, readHomeMd, geocode, parseFrontmatter } from './data.js';
import { writePlan, readPlan, emptyPlan } from './plan.js';
import { writeCandidates, readCandidates, emptyCandidates, makeCandidateId, STOP_CATEGORIES, LODGING_PRICE_TIERS } from './candidates.js';
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
cover_query: <2-4 visual nouns for a Pexels hero photo>
field_guide_notes: |
  Trip-wide notes worth surfacing on the printable brochure.
gotchas: |
  Closures, permits, cell-dead zones, seasonal restrictions.
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
  const { files } = getTripFiles(slug);
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
  const plan = emptyPlan();
  plan.cover_query = planData.cover_query ?? '';
  plan.field_guide_notes = planData.field_guide_notes ?? '';
  plan.gotchas = planData.gotchas ?? '';

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

  if (existingCands) {
    const userAddedStops = (existingCands.stops ?? []).filter((s) => s.user_added);
    const userAddedLodging = (existingCands.lodging ?? []).filter((l) => l.user_added);
    const newIds = new Set([...cands.stops.map((s) => s.id), ...cands.lodging.map((l) => l.id)]);
    // Track id renames so we can rewrite plan.days references — without this,
    // a user's promoted day silently re-binds to whichever researcher candidate
    // took the original slug (real data corruption, no dangling-banner warning).
    const renames = new Map();

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

  writePlan(slug, plan);
  writeCandidates(slug, cands);

  return { usage };
}

// Sequential geocoding — Nominatim rate-limits to 1 req/sec. The geocode()
// helper caches results so repeat runs are cheap. Cache hits short-circuit
// without a network call, so re-extraction stays fast even with the loop.
async function geocodeCandidates(cands, destinationContext) {
  for (const c of [...cands.stops, ...cands.lodging]) {
    if (c.coords) continue; // preserve any pre-geocoded coords
    const coords = (await geocode(c.name)) ?? (destinationContext ? await geocode(`${c.name}, ${destinationContext}`) : null);
    if (coords) c.coords = { lat: coords[0], lng: coords[1] };
  }
}

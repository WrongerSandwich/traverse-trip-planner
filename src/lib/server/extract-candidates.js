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
import { getTripFiles, readHomeMd } from './data.js';
import { writePlan, emptyPlan } from './plan.js';
import { writeCandidates, emptyCandidates, makeCandidateId, STOP_CATEGORIES } from './candidates.js';
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

const PRICE_TIERS = ['budget', 'mid', 'splurge'];

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
      price_tier: PRICE_TIERS.includes(raw.price_tier) ? raw.price_tier : 'mid',
      nights: typeof raw.nights === 'number' ? raw.nights : undefined,
      booking_url: raw.booking_url ?? '',
      user_added: false,
    });
  }

  writePlan(slug, plan);
  writeCandidates(slug, cands);

  return { usage };
}

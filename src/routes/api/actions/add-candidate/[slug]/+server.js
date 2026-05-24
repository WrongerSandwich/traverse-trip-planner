// Instant Inline: manual add-candidate.
//
// SSE stream, mirrors /api/actions/add/+server.js. Optional searchToolDefinition()
// so the model can verify obscure places before answering. New entries write with
// user_added: true via addCandidateStop/Lodging — re-extract preserves them.

import { json } from '@sveltejs/kit';
import { parse as yamlParse } from 'yaml';
import { existsSync, readFileSync } from 'fs';
import {
  readHomeMd,
  parseFrontmatter,
  invalidateEnrichCache,
  rejectInvalidSlug,
  findTripFile,
} from '$lib/server/data.js';
import {
  addCandidateStop,
  addCandidateLodging,
  readCandidates,
  geocodeCandidate,
  getDestinationRefCoords,
  STOP_CATEGORIES,
  LODGING_PRICE_TIERS,
} from '$lib/server/candidates.js';
import { chat, formatUsage } from '$lib/server/ai.js';
import { search, searchToolDefinition } from '$lib/server/search.js';
import { getEffectiveConfig, getFeatureAvailability } from '$lib/server/config.js';
import { rateLimitResponse } from '$lib/server/rate-limit.js';
import { sseStream, withHeartbeat } from '$lib/server/sse.js';
import { HAND_DEFAULTS, MAX_TOKENS } from '$lib/server/promises.js';
import { usageToTokens } from '$lib/utils/formatTokens.js';

export const _promise = HAND_DEFAULTS['add-candidate'];

const CANDIDATE_RE = /<candidate>([\s\S]*?)<\/candidate>/;
const DUPLICATE_RE = /<duplicate>([\s\S]*?)<\/duplicate>/;
const NOT_APPLICABLE_RE = /<not-applicable>([\s\S]*?)<\/not-applicable>/;

function normalize(name) {
  return String(name).toLowerCase().trim().replace(/\s+/g, ' ');
}

export async function POST(event) {
  if (!getFeatureAvailability().homeMdReady) {
    return json({ code: 'home_not_configured' }, { status: 412 });
  }
  const invalid = rejectInvalidSlug(event.params.slug);
  if (invalid) return invalid;
  const { slug } = event.params;

  const limited = rateLimitResponse({ event, endpoint: 'add-candidate', slugKey: slug });
  if (limited) return limited;

  let body = {};
  try { body = await event.request.json(); } catch { /* empty */ }
  const name = (body?.name || '').trim().slice(0, 200);
  const type = body?.type === 'lodging' ? 'lodging' : 'stop';

  return sseStream(async (send) => {
    if (!name) {
      send({ msg: 'Give a place name and try again.', done: true, code: 'invalid_input', context: { reason: 'name is required' } });
      return;
    }

    const overviewPath = findTripFile(slug);
    if (!overviewPath || !existsSync(overviewPath)) {
      send({ msg: 'Trip not found.', done: true, code: 'trip_not_found' });
      return;
    }
    const overviewRaw = readFileSync(overviewPath, 'utf8');
    const overviewFm = parseFrontmatter(overviewRaw) || {};
    const status = overviewFm.status;
    if (status !== 'planning') {
      send({ msg: 'This trip is not in the planning stage.', done: true, code: 'wrong_stage' });
      return;
    }
    const destination = overviewFm.destination ?? '';
    const vibe = overviewFm.vibe ?? '';

    send({ msg: 'Checking the candidate list…' });
    const cands = readCandidates(slug) ?? { stops: [], lodging: [] };
    const pool = type === 'stop' ? cands.stops : cands.lodging;
    const incomingNorm = normalize(name);
    if (pool.some((c) => normalize(c.name) === incomingNorm)) {
      send({ msg: `Already in your list.`, done: true, code: 'candidate_duplicate', context: { name } });
      return;
    }

    const existingNames = pool.map((c) => `- ${c.name}`).join('\n') || '(none yet)';
    const homeMd = readHomeMd();

    const safeName = `"${name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    const stopFields = `name: ${safeName}
category: <one of: ${STOP_CATEGORIES.join(' | ')}>
description: <1 sentence; if uncertain, keep it general — no operating hours, prices, or trivia>
why_recommended: <1 sentence linking to the traveler's tastes from home.md>
source_url: <best URL if known via search; leave blank if uncertain>`;

    const lodgingFields = `name: ${safeName}
description: <1 sentence; general if uncertain>
price_tier: <budget | mid | splurge>
nights: <integer; omit if uncertain>
booking_url: <best URL if known via search; leave blank if uncertain>`;

    const system = `You add one ${type} candidate to a road trip planning pool.

The trip:
- destination: ${destination}
- vibe: ${vibe}

The traveler's personal context:
${homeMd}

Existing ${type} candidates already in the pool (don't suggest a near-duplicate):
${existingNames}

The user wants to add this ${type}: "${name}"

If you don't recognize this place with confidence, USE web_search before responding. Search for the name plus the destination. After searching, if still uncertain about specifics, leave description generic and source_url blank — do not invent operating hours, prices, or trivia.

Respond with exactly one of these XML envelopes, nothing else:

1. If "${name}" is essentially the same as one of the existing candidates listed above (suburb, alternate name, etc):
<duplicate>existing candidate name</duplicate>

2. If "${name}" doesn't exist as a real, drivable place near ${destination || 'the destination'}:
<not-applicable>brief reason</not-applicable>

3. Otherwise:
<candidate>
${type === 'stop' ? stopFields : lodgingFields}
</candidate>`;

    send({ msg: `Looking up ${name}…` });
    const { text, usage } = await withHeartbeat(
      () => chat({
        ...getEffectiveConfig().features['add-candidate'],
        label: 'add-candidate',
        maxTokens: MAX_TOKENS['add-candidate'],
        system,
        messages: [{ role: 'user', content: `Add this ${type}: ${name}` }],
        tools: [searchToolDefinition()],
        onToolCall: async ({ name: toolName, input }) => {
          if (toolName === 'web_search') return search({ query: input.query });
          return null;
        },
      }),
      send,
      ['Still thinking…']
    );

    const dup = DUPLICATE_RE.exec(text);
    if (dup) {
      send({ msg: `Too close to "${dup[1].trim()}" already on the list.`, done: true, code: 'candidate_duplicate', context: { name: dup[1].trim() }, tokens: usageToTokens(usage) });
      return;
    }
    const notApp = NOT_APPLICABLE_RE.exec(text);
    if (notApp) {
      send({ msg: notApp[1].trim(), done: true, code: 'invalid_input', context: { reason: notApp[1].trim() }, tokens: usageToTokens(usage) });
      return;
    }
    const candMatch = CANDIDATE_RE.exec(text);
    if (!candMatch) {
      send({ msg: 'No candidate block returned.', done: true, code: 'empty_model_output', tokens: usageToTokens(usage) });
      return;
    }

    let parsed;
    try { parsed = yamlParse(candMatch[1]) || {}; }
    catch (e) {
      send({ msg: 'Parser failed on the model output.', done: true, code: 'model_returned_invalid_yaml', tokens: usageToTokens(usage) });
      return;
    }
    if (!parsed.name) parsed.name = name; // model occasionally omits; the user already gave us the name

    send({ msg: 'Pinning location…' });
    const refCoords = await getDestinationRefCoords(destination);
    const coords = await geocodeCandidate(parsed.name, destination, refCoords);

    const fields = type === 'stop'
      ? {
          name: parsed.name,
          category: STOP_CATEGORIES.includes(parsed.category) ? parsed.category : 'misc',
          description: parsed.description || '',
          why_recommended: parsed.why_recommended || '',
          source_url: parsed.source_url || '',
          coords: coords ? { lat: coords[0], lng: coords[1] } : undefined,
        }
      : {
          name: parsed.name,
          description: parsed.description || '',
          price_tier: LODGING_PRICE_TIERS.includes(parsed.price_tier) ? parsed.price_tier : 'mid',
          nights: typeof parsed.nights === 'number' ? parsed.nights : undefined,
          booking_url: parsed.booking_url || '',
          coords: coords ? { lat: coords[0], lng: coords[1] } : undefined,
        };

    const id = type === 'stop'
      ? addCandidateStop(slug, fields)
      : addCandidateLodging(slug, fields);

    invalidateEnrichCache();
    send({ msg: formatUsage(usage) });
    send({ msg: `Added ${parsed.name}.`, done: true, id, tokens: usageToTokens(usage) });
  });
}

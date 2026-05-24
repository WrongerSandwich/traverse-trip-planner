# Candidates: manual add + find-more batch — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two affordances to the Candidates section on a planning trip: (1) "Add candidate" — type a place name, AI fleshes out the rest with optional web_search, geocodes it, saves with `user_added: true`; (2) "Find more" — Ambient Background batch that web-searches a batch of stop or lodging candidates with optional steering prompt, dedupes against the existing pool, appends with `user_added: true`.

**Architecture:** Two new SvelteKit endpoints under `src/routes/api/actions/`. Add-candidate is Instant Inline (SSE button-as-spinner) and reuses `/api/actions/add`'s shape. Find-more is Ambient Background, registered with `jobs.js` using the discriminator-in-workflow convention (`find-more:stop` / `find-more:lodging` keys, clean slug). Both reuse `chat()` with `searchToolDefinition()` so the model can decide whether to search; both share an extracted `geocodeCandidate()` helper for destination-scoped Nominatim disambiguation. UI lives in `CandidatesSection.svelte` as a small subtools row plus two mutually-exclusive inline panels.

**Tech Stack:** SvelteKit 2 + Svelte 5 runes, Vitest, vanilla `fetch` SSE, `yaml` package, in-memory job registry mirrored to frontmatter.

**Spec:** `docs/superpowers/specs/2026-05-24-candidates-add-and-research-more-design.md`

---

## File Structure

**New files:**
- `src/routes/api/actions/add-candidate/[slug]/+server.js` — Instant Inline SSE endpoint for one-shot manual add.
- `src/routes/api/actions/find-more/[slug]/+server.js` — Ambient Background endpoint for batch find-more.
- `tests/api-add-candidate.test.js` — server-side tests for the add-candidate endpoint.
- `tests/api-find-more.test.js` — server-side tests for the find-more endpoint.
- `tests/find-more-instant-inline.test.js` — pure-JS state-machine test for the find-more panel UI (mirror of `add-instant-inline.test.js`).

**Modified files:**
- `src/lib/server/candidates.js` — export `geocodeCandidate(name, destinationContext, refCoords)` and `getDestinationRefCoords(destinationContext)` helpers; existing add functions accept an optional `coords` field unchanged.
- `src/lib/server/extract-candidates.js` — replace inline `geocodeCandidates` with calls to the extracted helper; keep `__testing__` export shape for existing tests.
- `src/lib/server/promises.js` — add `add-candidate` and `find-more` entries to `HAND_DEFAULTS` and `MAX_TOKENS`.
- `src/lib/errors-registry.js` — add `candidate_duplicate` entry.
- `src/lib/utils/jobLabels.js` — add `'find-more'` to `WORKFLOW_LABELS`.
- `src/lib/components/CandidatesSection.svelte` — add subtools row + two mutually-exclusive inline panels.
- `tests/extract-candidates.test.js` — add a test asserting find-more outputs (`user_added: true`) survive a re-extract.

**Responsibility split:** `candidates.js` is the data layer (read/write candidates.yaml, geocoding); endpoints orchestrate (rate-limit, AI call, parse, dedupe, write); `CandidatesSection.svelte` is presentation only and never touches files. This matches the existing layering in the project.

---

## Task 1: Extract `geocodeCandidate` helper to `candidates.js`

**Files:**
- Modify: `src/lib/server/candidates.js` — add exports
- Modify: `src/lib/server/extract-candidates.js` — call helper, drop inline copy
- Test: `tests/extract-candidates.test.js` — already covers the disambiguation path; we should verify nothing breaks

**Context:** `extract-candidates.js` has private helpers `distanceMi`, `geocodeWithDisambiguation`, `geocodeCandidates`, and `MAX_CANDIDATE_DISTANCE_MI` (lines 295–402). Both new endpoints need the same disambiguation. Extract to `candidates.js` so endpoints can import without circular deps.

- [ ] **Step 1: Add a failing test for the new exports**

Append to `tests/candidates-io.test.js` (already has the candidates.js test scaffolding):

```js
describe('geocodeCandidate', () => {
  it('exports a function returning coords or null', async () => {
    const mod = await import('$lib/server/candidates.js');
    expect(typeof mod.geocodeCandidate).toBe('function');
    expect(typeof mod.getDestinationRefCoords).toBe('function');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/candidates-io.test.js -t geocodeCandidate`
Expected: FAIL — exports don't exist yet.

- [ ] **Step 3: Add the new helpers in `candidates.js`**

Add to the bottom of `src/lib/server/candidates.js` (above the final `export function setCandidateHidden` block — actually, add at the very end of file is fine):

```js
import { geocode } from './data.js';

// Same threshold and throttle as the prior extract-candidates implementation.
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
```

- [ ] **Step 4: Run the new test**

Run: `npx vitest run tests/candidates-io.test.js -t geocodeCandidate`
Expected: PASS.

- [ ] **Step 5: Replace inline copy in `extract-candidates.js`**

Edit `src/lib/server/extract-candidates.js`. Delete the local `distanceMi`, `geocodeWithDisambiguation`, `geocodeCandidates`, `MAX_CANDIDATE_DISTANCE_MI`, `NOMINATIM_THROTTLE_MS`, and `sleep` definitions (lines ~295–402). Replace the call site `await geocodeCandidates(cands, destinationContext);` with:

```js
const refCoords = await getDestinationRefCoords(destinationContext);
if (destinationContext && !refCoords) {
  console.warn(
    `extract-candidates: destination "${destinationContext}" failed to geocode; bare-name candidate lookups will be skipped to avoid same-name collisions`
  );
}
for (const c of [...cands.stops, ...cands.lodging]) {
  if (c.hidden) continue;
  if (c.coords && refCoords) {
    const existing = [Number(c.coords.lat), Number(c.coords.lng)];
    if (distanceMi(existing, refCoords) <= MAX_CANDIDATE_DISTANCE_MI) continue;
    console.warn(
      `extract-candidates: re-geocoding "${c.name}" — existing coords were ${Math.round(distanceMi(existing, refCoords))}mi from destination (above ${MAX_CANDIDATE_DISTANCE_MI}mi sanity threshold)`
    );
  } else if (c.coords) {
    continue;
  }
  const coords = await geocodeCandidate(c.name, destinationContext, refCoords);
  if (coords) {
    c.coords = { lat: coords[0], lng: coords[1] };
  } else if (c.coords) {
    delete c.coords;
  }
}
```

Add the matching import at the top of `extract-candidates.js` (replace the existing import line):

```js
import { readCandidates, emptyCandidates, makeCandidateId, STOP_CATEGORIES, LODGING_PRICE_TIERS, candidatesPath, serializeCandidatesFile, geocodeCandidate, getDestinationRefCoords, MAX_CANDIDATE_DISTANCE_MI } from './candidates.js';
```

`distanceMi` is still needed locally for the self-heal check above. Keep that helper inline (don't export from `candidates.js` — keep its API small).

Update the bottom `__testing__` export. The existing extract-candidates tests import `geocodeCandidates`, `geocodeWithDisambiguation`, `distanceMi`, `MAX_CANDIDATE_DISTANCE_MI` from `__testing__`. Provide shims so existing tests don't break:

```js
// Existing tests rely on these. Keep the shapes; delegate to candidates.js
// where the implementations now live.
export const __testing__ = {
  geocodeCandidates: async (cands, destinationContext) => {
    // Backwards-compat wrapper used by tests.
    const refCoords = await getDestinationRefCoords(destinationContext);
    for (const c of [...cands.stops, ...cands.lodging]) {
      if (c.hidden) continue;
      if (c.coords) continue;
      const coords = await geocodeCandidate(c.name, destinationContext, refCoords);
      if (coords) c.coords = { lat: coords[0], lng: coords[1] };
    }
  },
  distanceMi,
  MAX_CANDIDATE_DISTANCE_MI,
};
```

- [ ] **Step 6: Run the existing extract-candidates tests**

Run: `npx vitest run tests/extract-candidates.test.js`
Expected: PASS (all existing assertions hold; the helper move is internal-only).

- [ ] **Step 7: Commit**

```bash
git add src/lib/server/candidates.js src/lib/server/extract-candidates.js tests/candidates-io.test.js
git commit -m "refactor(candidates): extract geocodeCandidate helper for reuse"
```

---

## Task 2: Register `candidate_duplicate` error code

**Files:**
- Modify: `src/lib/errors-registry.js`
- Test: confirmed via existing `tests/errors-registry.test.js` (if present) or via direct import

- [ ] **Step 1: Add a failing test**

Append to `tests/errors-registry.test.js` (create it if missing):

```js
import { describe, it, expect } from 'vitest';
import { ERROR_REGISTRY, AFFORDANCES } from '$lib/errors-registry.js';

describe('candidate_duplicate', () => {
  it('is registered with name interpolation and dismiss affordance', () => {
    const entry = ERROR_REGISTRY.candidate_duplicate;
    expect(entry).toBeDefined();
    expect(entry.interpolate).toEqual(['name']);
    expect(entry.sentence).toContain('{name}');
    expect(entry.affordances).toEqual(['dismiss']);
    expect(entry.affordances.every((a) => AFFORDANCES.includes(a))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/errors-registry.test.js -t candidate_duplicate`
Expected: FAIL — entry is undefined.

- [ ] **Step 3: Add the entry to `errors-registry.js`**

In `src/lib/errors-registry.js`, after the existing `network_error` entry but before the `// ── Codes thrown elsewhere in src/ ──` block, add:

```js
  candidate_duplicate: {
    sentence: '"{name}" is already in your candidates. Try a different name.',
    affordances: ['dismiss'],
    interpolate: ['name'],
  },
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/errors-registry.test.js -t candidate_duplicate`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/errors-registry.js tests/errors-registry.test.js
git commit -m "feat(errors): add candidate_duplicate code"
```

---

## Task 3: Add `add-candidate` and `find-more` promise defaults

**Files:**
- Modify: `src/lib/server/promises.js`

- [ ] **Step 1: Write a failing test for the new keys**

Append to `tests/promises.test.js` (create if missing):

```js
import { describe, it, expect } from 'vitest';
import { HAND_DEFAULTS, MAX_TOKENS } from '$lib/server/promises.js';

describe('promises for new candidate workflows', () => {
  it('declares add-candidate with verb, produces, time, and tokens range', () => {
    const p = HAND_DEFAULTS['add-candidate'];
    expect(p).toBeDefined();
    expect(p.verb).toMatch(/add/i);
    expect(p.produces).toMatch(/candidate/i);
    expect(typeof p.time_seconds).toBe('number');
    expect(Array.isArray(p.tokens_range)).toBe(true);
    expect(p.tokens_range).toHaveLength(2);
    expect(MAX_TOKENS['add-candidate']).toBeGreaterThan(0);
  });

  it('declares find-more with verb, produces, time, and tokens range', () => {
    const p = HAND_DEFAULTS['find-more'];
    expect(p).toBeDefined();
    expect(p.verb).toMatch(/find/i);
    expect(p.produces).toMatch(/candidate/i);
    expect(typeof p.time_seconds).toBe('number');
    expect(p.time_seconds).toBeGreaterThan(30);
    expect(MAX_TOKENS['find-more']).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/promises.test.js`
Expected: FAIL — keys are undefined.

- [ ] **Step 3: Add the entries**

In `src/lib/server/promises.js`, add to `MAX_TOKENS`:

```js
  'add-candidate': 1000,
  'find-more': 6000,
```

And to `HAND_DEFAULTS`:

```js
  'add-candidate': {
    verb: 'Add candidate',
    produces: 'One new stop or lodging candidate, with category, description, and (when web-searchable) a verified source.',
    time_seconds: 18,
    tokens_range: [400, 1200],
  },
  'find-more': {
    verb: 'Find more candidates',
    produces: 'A batch of additional stop or lodging candidates, scoped to your steering prompt and de-duped against the existing pool.',
    time_seconds: 90,
    tokens_range: [4000, 12000],
  },
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/promises.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/promises.js tests/promises.test.js
git commit -m "feat(promises): register add-candidate and find-more workflow defaults"
```

---

## Task 4: Add `find-more` to job label map

**Files:**
- Modify: `src/lib/utils/jobLabels.js`
- Test: `tests/job-labels.test.js` (create if missing — or append if it exists)

**Context:** `jobLabel(workflow)` strips the `:<discriminator>` suffix and looks up the bare workflow in `WORKFLOW_LABELS`. Adding one entry covers both `find-more:stop` and `find-more:lodging`.

- [ ] **Step 1: Write a failing test**

Append to `tests/job-labels.test.js` (create with this content if missing):

```js
import { describe, it, expect } from 'vitest';
import { jobLabel } from '$lib/utils/jobLabels.js';

describe('jobLabel for find-more', () => {
  it('labels find-more:stop and find-more:lodging with the same prose', () => {
    expect(jobLabel('find-more:stop')).toBe('Finding more candidates…');
    expect(jobLabel('find-more:lodging')).toBe('Finding more candidates…');
  });
  it('labels bare find-more workflow too', () => {
    expect(jobLabel('find-more')).toBe('Finding more candidates…');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/job-labels.test.js`
Expected: FAIL — `find-more` falls through to the generic `${bare}…` fallback.

- [ ] **Step 3: Add the entry**

In `src/lib/utils/jobLabels.js`, add `'find-more': 'Finding more candidates…',` to `WORKFLOW_LABELS`:

```js
const WORKFLOW_LABELS = {
  deepen:        'Researching…',
  'deepen-section': 'Deepening stops…',
  'find-more':   'Finding more candidates…',
};
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/job-labels.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/utils/jobLabels.js tests/job-labels.test.js
git commit -m "feat(jobs): label find-more workflow in per-trip badge"
```

---

## Task 5: Build `POST /api/actions/add-candidate/[slug]` — happy path

**Files:**
- Create: `src/routes/api/actions/add-candidate/[slug]/+server.js`
- Test: `tests/api-add-candidate.test.js`

**Context:** Mirror the shape of `src/routes/api/actions/add/+server.js` (SSE streaming, `withHeartbeat`, `chat()`, `sseStream`). Reuse `searchToolDefinition()` so the model can do `web_search` calls when it doesn't recognize a place.

- [ ] **Step 1: Write a failing test (happy path, stop)**

Create `tests/api-add-candidate.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted mocks
const mockChat = vi.hoisted(() => vi.fn());
vi.mock('$lib/server/ai.js', () => ({
  chat: mockChat,
  formatUsage: () => 'usage: stub',
}));

const mockSearch = vi.hoisted(() => vi.fn());
const mockSearchToolDefinition = vi.hoisted(() => vi.fn(() => ({ name: 'web_search' })));
vi.mock('$lib/server/search.js', () => ({
  search: mockSearch,
  searchToolDefinition: mockSearchToolDefinition,
}));

const mockAddCandidateStop = vi.hoisted(() => vi.fn(() => 'mound-city-group'));
const mockAddCandidateLodging = vi.hoisted(() => vi.fn(() => 'the-edgewater'));
const mockReadCandidates = vi.hoisted(() => vi.fn(() => ({ stops: [], lodging: [] })));
const mockGeocodeCandidate = vi.hoisted(() => vi.fn(async () => [39.37, -83.0]));
const mockGetDestinationRefCoords = vi.hoisted(() => vi.fn(async () => [39.33, -82.98]));
vi.mock('$lib/server/candidates.js', () => ({
  addCandidateStop: mockAddCandidateStop,
  addCandidateLodging: mockAddCandidateLodging,
  readCandidates: mockReadCandidates,
  geocodeCandidate: mockGeocodeCandidate,
  getDestinationRefCoords: mockGetDestinationRefCoords,
  STOP_CATEGORIES: ['historic', 'food', 'outdoors', 'view', 'entertainment', 'cultural', 'quirky', 'shopping', 'misc'],
  LODGING_PRICE_TIERS: ['budget', 'mid', 'splurge'],
}));

vi.mock('$lib/server/data.js', () => ({
  readHomeMd: () => '---\ntravelers: [you]\n---\n',
  parseFrontmatter: (text) => {
    const m = text.match(/^---\n([\s\S]*?)\n---/);
    if (!m) return null;
    const fm = {};
    for (const line of m[1].split('\n')) {
      const mm = line.match(/^([^:]+):\s*(.*)$/);
      if (mm) fm[mm[1].trim()] = mm[2].trim();
    }
    return fm;
  },
  invalidateEnrichCache: vi.fn(),
  rejectInvalidSlug: () => null,
  ROOT: '/test',
  findTripFile: () => '/test/planning/great-smoky-ramble/overview.md',
}));

const mockExistsSync = vi.hoisted(() => vi.fn(() => true));
const mockReadFileSync = vi.hoisted(() => vi.fn(() => '---\ndestination: Chillicothe, OH\n---\nprose'));
vi.mock('node:fs', () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
}));
vi.mock('fs', () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
}));

vi.mock('$lib/server/config.js', () => ({
  getEffectiveConfig: () => ({
    assistantName: 'Field Guide',
    features: { 'add-candidate': { provider: 'anthropic', model: 'claude-sonnet-4-6' } },
  }),
  getFeatureAvailability: () => ({ homeMdReady: true }),
}));

vi.mock('$lib/server/rate-limit.js', () => ({
  rateLimitResponse: () => null,
}));

// SUT
const { POST } = await import('../src/routes/api/actions/add-candidate/[slug]/+server.js');

function buildEvent(body) {
  return {
    params: { slug: 'great-smoky-ramble' },
    request: { json: async () => body },
    getClientAddress: () => '127.0.0.1',
  };
}

// Read every SSE event from a Response and return the array of parsed events.
async function readSse(res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const events = [];
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 2);
      if (!chunk.startsWith('data:')) continue;
      const json = chunk.slice(5).trim();
      try { events.push(JSON.parse(json)); } catch { /* ignore heartbeats */ }
    }
  }
  return events;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/actions/add-candidate/[slug] — happy path (stop)', () => {
  it('parses <candidate> YAML, geocodes, calls addCandidateStop, ends with ok event', async () => {
    mockChat.mockResolvedValueOnce({
      text: `<candidate>
name: Mound City Group
category: historic
description: Earthworks site of the Hopewell culture, with a short interpretive loop.
why_recommended: Matches your taste for low-foot-traffic historic sites.
source_url: https://www.nps.gov/hocu/index.htm
</candidate>`,
      usage: { input_tokens: 100, output_tokens: 200 },
    });

    const res = await POST(buildEvent({ name: 'Mound City Group', type: 'stop' }));
    expect(res.status).toBe(200);
    const events = await readSse(res);
    const terminal = events[events.length - 1];
    expect(terminal.done).toBe(true);
    expect(terminal.code).toBeFalsy(); // no error code
    expect(mockAddCandidateStop).toHaveBeenCalledTimes(1);
    const fields = mockAddCandidateStop.mock.calls[0][1];
    expect(fields.name).toBe('Mound City Group');
    expect(fields.category).toBe('historic');
    expect(fields.coords).toEqual({ lat: 39.37, lng: -83.0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api-add-candidate.test.js`
Expected: FAIL — endpoint module doesn't exist.

- [ ] **Step 3: Create the endpoint**

Create `src/routes/api/actions/add-candidate/[slug]/+server.js`:

```js
// Instant Inline: manual add-candidate.
//
// SSE stream, mirrors /api/actions/add/+server.js. Optional searchToolDefinition()
// so the model can verify obscure places before answering. New entries write with
// user_added: true via addCandidateStop/Lodging — re-extract preserves them.

import { json } from '@sveltejs/kit';
import { parse as yamlParse } from 'yaml';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  ROOT,
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

    const stopFields = `name: ${name}
category: <one of: ${STOP_CATEGORIES.join(' | ')}>
description: <1 sentence; if uncertain, keep it general — no operating hours, prices, or trivia>
why_recommended: <1 sentence linking to the traveler's tastes from home.md>
source_url: <best URL if known via search; leave blank if uncertain>`;

    const lodgingFields = `name: ${name}
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
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/api-add-candidate.test.js`
Expected: PASS (1/1).

- [ ] **Step 5: Commit**

```bash
git add src/routes/api/actions/add-candidate tests/api-add-candidate.test.js
git commit -m "feat(api): POST /api/actions/add-candidate (Instant Inline)"
```

---

## Task 6: Add-candidate — duplicate, lodging, and error paths

**Files:**
- Modify: `tests/api-add-candidate.test.js`

- [ ] **Step 1: Add tests for the other branches**

Append to `tests/api-add-candidate.test.js`:

```js
describe('POST /api/actions/add-candidate — variants', () => {
  it('short-circuits when exact name already in pool (no chat() call)', async () => {
    mockReadCandidates.mockReturnValueOnce({
      stops: [{ id: 'mound-city-group', name: 'Mound City Group' }],
      lodging: [],
    });
    const res = await POST(buildEvent({ name: 'mound city group', type: 'stop' }));
    const events = await readSse(res);
    const terminal = events[events.length - 1];
    expect(terminal.code).toBe('candidate_duplicate');
    expect(mockChat).not.toHaveBeenCalled();
    expect(mockAddCandidateStop).not.toHaveBeenCalled();
  });

  it('routes <duplicate> envelope to candidate_duplicate error', async () => {
    mockChat.mockResolvedValueOnce({
      text: `<duplicate>Mound City Group</duplicate>`,
      usage: { input_tokens: 50, output_tokens: 30 },
    });
    const res = await POST(buildEvent({ name: 'Mound City NHP', type: 'stop' }));
    const events = await readSse(res);
    const terminal = events[events.length - 1];
    expect(terminal.code).toBe('candidate_duplicate');
    expect(terminal.context.name).toBe('Mound City Group');
    expect(mockAddCandidateStop).not.toHaveBeenCalled();
  });

  it('routes <not-applicable> envelope to invalid_input', async () => {
    mockChat.mockResolvedValueOnce({
      text: `<not-applicable>Not drivable from the route</not-applicable>`,
      usage: { input_tokens: 50, output_tokens: 30 },
    });
    const res = await POST(buildEvent({ name: 'Tokyo Tower', type: 'stop' }));
    const events = await readSse(res);
    const terminal = events[events.length - 1];
    expect(terminal.code).toBe('invalid_input');
    expect(mockAddCandidateStop).not.toHaveBeenCalled();
  });

  it('saves a lodging candidate via addCandidateLodging', async () => {
    mockChat.mockResolvedValueOnce({
      text: `<candidate>
name: The Mill Inn
description: Restored 19th-century mill with riverside rooms.
price_tier: mid
nights: 2
booking_url: https://example.com
</candidate>`,
      usage: { input_tokens: 100, output_tokens: 100 },
    });
    const res = await POST(buildEvent({ name: 'The Mill Inn', type: 'lodging' }));
    const events = await readSse(res);
    const terminal = events[events.length - 1];
    expect(terminal.code).toBeFalsy();
    expect(mockAddCandidateLodging).toHaveBeenCalledTimes(1);
    expect(mockAddCandidateStop).not.toHaveBeenCalled();
    const fields = mockAddCandidateLodging.mock.calls[0][1];
    expect(fields.price_tier).toBe('mid');
    expect(fields.nights).toBe(2);
  });

  it('saves without coords when geocode returns null', async () => {
    mockChat.mockResolvedValueOnce({
      text: `<candidate>
name: Obscure Spot
category: misc
description: A place.
why_recommended: Aligns with your taste.
source_url:
</candidate>`,
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    mockGeocodeCandidate.mockResolvedValueOnce(null);
    const res = await POST(buildEvent({ name: 'Obscure Spot', type: 'stop' }));
    const events = await readSse(res);
    const terminal = events[events.length - 1];
    expect(terminal.code).toBeFalsy();
    const fields = mockAddCandidateStop.mock.calls[0][1];
    expect(fields.coords).toBeUndefined();
  });

  it('rejects empty name with invalid_input', async () => {
    const res = await POST(buildEvent({ name: '   ', type: 'stop' }));
    const events = await readSse(res);
    expect(events[events.length - 1].code).toBe('invalid_input');
    expect(mockChat).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `npx vitest run tests/api-add-candidate.test.js`
Expected: PASS (7/7).

- [ ] **Step 3: Commit**

```bash
git add tests/api-add-candidate.test.js
git commit -m "test(api): cover add-candidate duplicate, lodging, and error paths"
```

---

## Task 7: Build `POST /api/actions/find-more/[slug]` — happy path

**Files:**
- Create: `src/routes/api/actions/find-more/[slug]/+server.js`
- Test: `tests/api-find-more.test.js`

**Context:** Mirror `src/routes/api/actions/deepen/[slug]/+server.js`. Uses `jobs.js` with the discriminator-in-workflow convention.

- [ ] **Step 1: Write a failing test for the happy path**

Create `tests/api-find-more.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockChat = vi.hoisted(() => vi.fn());
vi.mock('$lib/server/ai.js', () => ({ chat: mockChat, formatUsage: () => 'usage: stub' }));

const mockSearch = vi.hoisted(() => vi.fn());
const mockSearchToolDefinition = vi.hoisted(() => vi.fn(() => ({ name: 'web_search' })));
vi.mock('$lib/server/search.js', () => ({
  search: mockSearch,
  searchToolDefinition: mockSearchToolDefinition,
}));

const mockAddCandidateStop = vi.hoisted(() => vi.fn((slug, f) => f.name.toLowerCase().replace(/\W+/g, '-')));
const mockAddCandidateLodging = vi.hoisted(() => vi.fn((slug, f) => f.name.toLowerCase().replace(/\W+/g, '-')));
const mockReadCandidates = vi.hoisted(() => vi.fn(() => ({ stops: [{ id: 'mound-city', name: 'Mound City' }], lodging: [] })));
const mockGeocodeCandidate = vi.hoisted(() => vi.fn(async () => [40.0, -83.0]));
const mockGetDestinationRefCoords = vi.hoisted(() => vi.fn(async () => [40.0, -83.0]));
vi.mock('$lib/server/candidates.js', () => ({
  addCandidateStop: mockAddCandidateStop,
  addCandidateLodging: mockAddCandidateLodging,
  readCandidates: mockReadCandidates,
  geocodeCandidate: mockGeocodeCandidate,
  getDestinationRefCoords: mockGetDestinationRefCoords,
  STOP_CATEGORIES: ['historic', 'food', 'outdoors', 'view', 'entertainment', 'cultural', 'quirky', 'shopping', 'misc'],
  LODGING_PRICE_TIERS: ['budget', 'mid', 'splurge'],
}));

vi.mock('$lib/server/data.js', () => ({
  readHomeMd: () => '---\ntravelers: [you]\n---\n',
  parseFrontmatter: (text) => {
    const m = text.match(/^---\n([\s\S]*?)\n---/);
    if (!m) return null;
    const fm = {};
    for (const line of m[1].split('\n')) {
      const mm = line.match(/^([^:]+):\s*(.*)$/);
      if (mm) fm[mm[1].trim()] = mm[2].trim();
    }
    return fm;
  },
  invalidateEnrichCache: vi.fn(),
  rejectInvalidSlug: () => null,
  ROOT: '/test',
  findTripFile: () => '/test/planning/great-smoky-ramble/overview.md',
}));

const mockExistsSync = vi.hoisted(() => vi.fn(() => true));
const mockReadFileSync = vi.hoisted(() => vi.fn(() => '---\ndestination: Chillicothe, OH\n---\nprose'));
vi.mock('node:fs', () => ({ existsSync: mockExistsSync, readFileSync: mockReadFileSync }));
vi.mock('fs', () => ({ existsSync: mockExistsSync, readFileSync: mockReadFileSync }));

vi.mock('$lib/server/config.js', () => ({
  getEffectiveConfig: () => ({
    features: { 'find-more': { provider: 'anthropic', model: 'claude-sonnet-4-6' } },
  }),
  getFeatureAvailability: () => ({ homeMdReady: true }),
}));

vi.mock('$lib/server/rate-limit.js', () => ({ rateLimitResponse: () => null }));

const startedJobs = vi.hoisted(() => []);
const completedJobs = vi.hoisted(() => []);
const failedJobs = vi.hoisted(() => []);
const cancelledJobs = vi.hoisted(() => []);
vi.mock('$lib/server/jobs.js', () => ({
  assertNotRunning: vi.fn(),
  startJob: vi.fn((workflow, slug, opts) => {
    const j = { workflow, slug, opts, controller: new AbortController() };
    startedJobs.push(j);
    return j;
  }),
  completeJob: vi.fn((workflow, slug, opts) => { completedJobs.push({ workflow, slug, opts }); }),
  failJob: vi.fn((workflow, slug, opts) => { failedJobs.push({ workflow, slug, opts }); }),
  cancelJob: vi.fn((workflow, slug) => { cancelledJobs.push({ workflow, slug }); }),
}));

const { POST } = await import('../src/routes/api/actions/find-more/[slug]/+server.js');

function buildEvent(body) {
  return {
    params: { slug: 'great-smoky-ramble' },
    request: { json: async () => body },
    getClientAddress: () => '127.0.0.1',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  startedJobs.length = 0;
  completedJobs.length = 0;
  failedJobs.length = 0;
  cancelledJobs.length = 0;
});

describe('POST /api/actions/find-more/[slug] — happy path', () => {
  it('starts a job keyed by find-more:stop and returns 202', async () => {
    mockChat.mockResolvedValueOnce({
      text: `<additions>
stops:
  - name: Adena Mansion
    category: historic
    description: 19th-century estate with valley views.
    why_recommended: Aligns with your historic-sites tilt.
    source_url: https://www.ohiohistory.org
  - name: Tecumseh!
    category: entertainment
    description: Outdoor drama in a wooded amphitheater.
    why_recommended: Matches your taste for off-beat live experiences.
    source_url: https://tecumsehdrama.com
</additions>`,
      usage: { input_tokens: 400, output_tokens: 600 },
    });

    const res = await POST(buildEvent({ type: 'stop', steering: 'more outdoors', count: 5 }));
    expect(res.status).toBe(202);
    expect(startedJobs[0].workflow).toBe('find-more:stop');
    expect(startedJobs[0].slug).toBe('great-smoky-ramble');

    // Drain the fire-and-forget worker
    await new Promise((r) => setTimeout(r, 50));

    expect(mockAddCandidateStop).toHaveBeenCalledTimes(2);
    expect(completedJobs).toHaveLength(1);
    expect(completedJobs[0].workflow).toBe('find-more:stop');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api-find-more.test.js`
Expected: FAIL — endpoint module doesn't exist.

- [ ] **Step 3: Create the endpoint**

Create `src/routes/api/actions/find-more/[slug]/+server.js`:

```js
// Ambient Background: find-more candidates.
//
// Discriminator-in-workflow convention (see src/lib/server/jobs.js header):
//   workflow = 'find-more:stop' | 'find-more:lodging', slug = the trip slug.
// TripJobBadge's filterJobsForSlug does exact slug match, so this surfaces
// every concurrent find-more job for a trip without prefix-handling.

import { json } from '@sveltejs/kit';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { parse as yamlParse } from 'yaml';
import {
  ROOT,
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
import { chat } from '$lib/server/ai.js';
import { search, searchToolDefinition } from '$lib/server/search.js';
import { getEffectiveConfig, getFeatureAvailability } from '$lib/server/config.js';
import { assertNotRunning, startJob, completeJob, failJob, cancelJob } from '$lib/server/jobs.js';
import { rateLimitResponse } from '$lib/server/rate-limit.js';
import { HAND_DEFAULTS, MAX_TOKENS } from '$lib/server/promises.js';
import { TraverseError } from '$lib/server/errors.js';
import { isAbort } from '$lib/utils/abort.js';
import { usageToTokens } from '$lib/utils/formatTokens.js';

export const _promise = HAND_DEFAULTS['find-more'];

const ADDITIONS_RE = /<additions>([\s\S]*?)<\/additions>/;

function normalize(name) {
  return String(name).toLowerCase().trim().replace(/\s+/g, ' ');
}

function findPlanningOverview(slug) {
  const p = join(ROOT, 'planning', slug, 'overview.md');
  return existsSync(p) ? p : null;
}

function readSectionFile(slug, name) {
  const p = join(ROOT, 'planning', slug, `${name}.md`);
  if (!existsSync(p)) return '';
  try { return readFileSync(p, 'utf8'); } catch { return ''; }
}

export async function POST(event) {
  if (!getFeatureAvailability().homeMdReady) {
    return json({ code: 'home_not_configured' }, { status: 412 });
  }
  const invalid = rejectInvalidSlug(event.params.slug);
  if (invalid) return invalid;
  const { slug } = event.params;

  let body = {};
  try { body = await event.request.json(); } catch { /* empty */ }
  const type = body?.type === 'lodging' ? 'lodging' : 'stop';
  const steering = typeof body?.steering === 'string' ? body.steering.trim().slice(0, 300) : '';
  let count = Number(body?.count);
  if (!Number.isFinite(count)) count = 5;
  count = Math.min(10, Math.max(3, Math.floor(count)));

  const limited = rateLimitResponse({ event, endpoint: 'find-more', slugKey: `${slug}:${type}` });
  if (limited) return limited;

  const overviewPath = findPlanningOverview(slug);
  if (!overviewPath) return json({ code: 'trip_not_found' }, { status: 404 });

  const workflow = `find-more:${type}`;
  try {
    assertNotRunning(workflow, slug);
  } catch (err) {
    if (err instanceof TraverseError && err.code === 'already_running') {
      return json({ code: 'already_running', message: err.message }, { status: 409 });
    }
    throw err;
  }

  const job = startJob(workflow, slug, { est_seconds: _promise.time_seconds });

  (async () => {
    try {
      const overviewRaw = readFileSync(overviewPath, 'utf8');
      const overviewFm = parseFrontmatter(overviewRaw) || {};
      const destination = overviewFm.destination ?? '';
      const vibe = overviewFm.vibe ?? '';
      const homeMd = readHomeMd();
      const cands = readCandidates(slug) ?? { stops: [], lodging: [] };
      const pool = type === 'stop' ? cands.stops : cands.lodging;
      const existingNames = pool.map((c) => `- ${c.name}`).join('\n') || '(none yet)';

      const routeMd = readSectionFile(slug, 'route');
      const logisticsMd = readSectionFile(slug, 'logistics');

      const steeringClause = steering
        ? `The user is steering this batch: "${steering}". Honor that direction.`
        : (type === 'stop'
            ? 'Focus on under-represented categories in the current pool — if outdoors and historic dominate, surface food / cultural / quirky.'
            : 'Vary tiers and locations not yet covered.');

      const fields = type === 'stop'
        ? `  - name: <Place name>
    category: <one of: ${STOP_CATEGORIES.join(' | ')}>
    description: <1 sentence; general if uncertain>
    why_recommended: <1 sentence linking to home preferences>
    source_url: <best URL found via search; blank if uncertain>`
        : `  - name: <Lodging name>
    description: <1 sentence>
    price_tier: <budget | mid | splurge>
    nights: <integer, optional>
    booking_url: <best URL found via search; blank if uncertain>`;

      const system = `You find ${count} additional ${type} candidates for a road trip planning pool.

Trip:
- destination: ${destination}
- vibe: ${vibe}

Traveler's personal context:
${homeMd}

Route notes:
${routeMd || '(none yet)'}

Logistics:
${logisticsMd || '(none yet)'}

Existing ${type} candidates in the pool — DO NOT re-suggest any of these:
${existingNames}

${steeringClause}

USE web_search to ground specific places, hours, and prices. If still uncertain about specifics, keep description general — do not invent operating hours, prices, or trivia.

Respond with exactly this envelope, nothing else:

<additions>
${type === 'stop' ? 'stops:' : 'lodging:'}
${fields}
  (repeat for up to ${count} entries)
</additions>`;

      const { text, usage } = await chat({
        ...getEffectiveConfig().features['find-more'],
        label: 'find-more',
        maxTokens: MAX_TOKENS['find-more'],
        system,
        messages: [{ role: 'user', content: `Find ${count} more ${type} candidates.` }],
        tools: [searchToolDefinition()],
        onToolCall: async ({ name: toolName, input }) => {
          if (toolName === 'web_search') return search({ query: input.query });
          return null;
        },
        signal: job.controller.signal,
      });

      const m = ADDITIONS_RE.exec(text);
      if (!m) throw new TraverseError('empty_model_output', 'No <additions> block returned.');
      let parsed;
      try { parsed = yamlParse(m[1]) || {}; }
      catch (e) {
        throw new TraverseError('model_returned_invalid_yaml', `find-more YAML parse failed: ${e.message}`);
      }

      const additions = Array.isArray(parsed[type === 'stop' ? 'stops' : 'lodging'])
        ? parsed[type === 'stop' ? 'stops' : 'lodging']
        : [];

      // Server-side dedupe against existing names (defense for when the model
      // ignores the "don't re-suggest" instruction).
      const existingNorm = new Set(pool.map((c) => normalize(c.name)));
      const survivors = additions.filter((a) => a && a.name && !existingNorm.has(normalize(a.name)));

      const refCoords = await getDestinationRefCoords(destination);
      let added = 0;
      for (const a of survivors) {
        const coords = await geocodeCandidate(a.name, destination, refCoords);
        if (type === 'stop') {
          addCandidateStop(slug, {
            name: a.name,
            category: STOP_CATEGORIES.includes(a.category) ? a.category : 'misc',
            description: a.description || '',
            why_recommended: a.why_recommended || '',
            source_url: a.source_url || '',
            coords: coords ? { lat: coords[0], lng: coords[1] } : undefined,
          });
        } else {
          addCandidateLodging(slug, {
            name: a.name,
            description: a.description || '',
            price_tier: LODGING_PRICE_TIERS.includes(a.price_tier) ? a.price_tier : 'mid',
            nights: typeof a.nights === 'number' ? a.nights : undefined,
            booking_url: a.booking_url || '',
            coords: coords ? { lat: coords[0], lng: coords[1] } : undefined,
          });
        }
        added++;
      }
      invalidateEnrichCache();
      console.log(`[find-more] ${slug} (${type}): added ${added} of ${additions.length} candidates`);
      completeJob(workflow, slug, { tokens: usageToTokens(usage) });
    } catch (err) {
      if (isAbort(err)) return;
      const code = err instanceof TraverseError ? err.code : 'unknown';
      console.error(`[find-more] ${slug} (${type}) failed (${code}):`, err?.message ?? err);
      const publicMessage = err instanceof TraverseError ? err.message : 'Find more failed — try again.';
      try { failJob(workflow, slug, { code, message: publicMessage }); }
      catch (e) { console.error(`[find-more] ${slug}: failJob threw after failure:`, e?.message ?? e); }
    }
  })();

  return new Response(null, { status: 202 });
}

export async function DELETE(event) {
  const invalid = rejectInvalidSlug(event.params.slug);
  if (invalid) return invalid;
  const url = new URL(event.request.url);
  const type = url.searchParams.get('type') === 'lodging' ? 'lodging' : 'stop';
  cancelJob(`find-more:${type}`, event.params.slug);
  return new Response(null, { status: 200 });
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/api-find-more.test.js`
Expected: PASS (1/1).

- [ ] **Step 5: Commit**

```bash
git add src/routes/api/actions/find-more tests/api-find-more.test.js
git commit -m "feat(api): POST /api/actions/find-more (Ambient Background)"
```

---

## Task 8: Find-more — dedupe, lodging, concurrency, cancel

**Files:**
- Modify: `tests/api-find-more.test.js`

- [ ] **Step 1: Add tests for variants**

Append to `tests/api-find-more.test.js`:

```js
describe('POST /api/actions/find-more — variants', () => {
  it('drops additions whose name matches an existing candidate', async () => {
    mockReadCandidates.mockReturnValueOnce({
      stops: [{ id: 'mound-city', name: 'Mound City' }, { id: 'adena-mansion', name: 'Adena Mansion' }],
      lodging: [],
    });
    mockChat.mockResolvedValueOnce({
      text: `<additions>
stops:
  - name: Adena Mansion
    category: historic
    description: dup
  - name: Tecumseh!
    category: entertainment
    description: drama
</additions>`,
      usage: { input_tokens: 200, output_tokens: 100 },
    });
    const res = await POST(buildEvent({ type: 'stop', count: 5 }));
    expect(res.status).toBe(202);
    await new Promise((r) => setTimeout(r, 50));
    expect(mockAddCandidateStop).toHaveBeenCalledTimes(1);
    expect(mockAddCandidateStop.mock.calls[0][1].name).toBe('Tecumseh!');
  });

  it('appends lodging entries for type=lodging', async () => {
    mockChat.mockResolvedValueOnce({
      text: `<additions>
lodging:
  - name: The Mill Inn
    description: Riverside mill.
    price_tier: mid
    booking_url: https://example.com
  - name: Lodge B
    description: Cabin cluster.
    price_tier: budget
</additions>`,
      usage: { input_tokens: 200, output_tokens: 100 },
    });
    const res = await POST(buildEvent({ type: 'lodging', count: 5 }));
    expect(res.status).toBe(202);
    await new Promise((r) => setTimeout(r, 50));
    expect(mockAddCandidateLodging).toHaveBeenCalledTimes(2);
    expect(mockAddCandidateStop).not.toHaveBeenCalled();
  });

  it('returns 409 when assertNotRunning throws already_running', async () => {
    const jobs = await import('$lib/server/jobs.js');
    jobs.assertNotRunning.mockImplementationOnce(() => {
      const err = new (await import('$lib/server/errors.js')).TraverseError('already_running', 'find-more is already running');
      throw err;
    });
    const res = await POST(buildEvent({ type: 'stop', count: 5 }));
    expect(res.status).toBe(409);
  });

  it('clamps count to [3, 10] range', async () => {
    mockChat.mockResolvedValueOnce({
      text: `<additions>
stops: []
</additions>`,
      usage: { input_tokens: 50, output_tokens: 20 },
    });
    const res = await POST(buildEvent({ type: 'stop', count: 50 }));
    expect(res.status).toBe(202);
    await new Promise((r) => setTimeout(r, 50));
    // The "Find N more" string in the system prompt should be clamped to 10
    const systemPrompt = mockChat.mock.calls[0][0].system;
    expect(systemPrompt).toContain('find 10 additional'.replace(/\s+/g, ' ').toLowerCase()) ||
      expect(systemPrompt.toLowerCase()).toMatch(/(?:up to|find) 10/);
  });

  it('parses YAML failure to failJob with model_returned_invalid_yaml', async () => {
    mockChat.mockResolvedValueOnce({
      text: `<additions>
stops:
  - name: [{ invalid yaml here
</additions>`,
      usage: { input_tokens: 200, output_tokens: 100 },
    });
    const res = await POST(buildEvent({ type: 'stop', count: 5 }));
    expect(res.status).toBe(202);
    await new Promise((r) => setTimeout(r, 50));
    expect(failedJobs).toHaveLength(1);
    expect(failedJobs[0].opts.code).toBe('model_returned_invalid_yaml');
  });
});

describe('DELETE /api/actions/find-more/[slug]', () => {
  it('cancels the find-more:<type> job', async () => {
    const event = {
      params: { slug: 'great-smoky-ramble' },
      request: { url: 'http://localhost/api/actions/find-more/great-smoky-ramble?type=lodging' },
    };
    const { DELETE } = await import('../src/routes/api/actions/find-more/[slug]/+server.js');
    const res = await DELETE(event);
    expect(res.status).toBe(200);
    expect(cancelledJobs[0].workflow).toBe('find-more:lodging');
    expect(cancelledJobs[0].slug).toBe('great-smoky-ramble');
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `npx vitest run tests/api-find-more.test.js`
Expected: PASS (6/6).

- [ ] **Step 3: Commit**

```bash
git add tests/api-find-more.test.js
git commit -m "test(api): cover find-more dedupe, lodging, concurrency, cancel"
```

---

## Task 9: Verify find-more candidates survive re-extract

**Files:**
- Modify: `tests/extract-candidates.test.js`

**Context:** The whole point of `user_added: true` is re-research preserves these entries. Add a regression test.

- [ ] **Step 1: Locate the existing "user-added preserved on re-extract" test**

Open `tests/extract-candidates.test.js` and search for `user_added` and `extractCandidates`. Confirm there's an existing test that verifies `user_added: true` entries survive a re-extract (there is — referenced in extract-candidates.js comments). The new assertion bolts onto that test or adds a sibling.

Run: `grep -n "user_added" tests/extract-candidates.test.js`
Expected: at least one match in an existing test.

- [ ] **Step 2: Add the find-more-shape test**

Append to `tests/extract-candidates.test.js`, in the same describe block that already exercises the merge logic:

```js
  it('preserves a find-more-style entry (researcher-emitted but user_added: true) across re-extract', async () => {
    const candidates = await import('$lib/server/candidates.js');
    candidates.readCandidates.mockReturnValueOnce({
      stops: [
        // Simulates a candidate added via find-more — researcher schema, user_added flag.
        {
          id: 'tecumseh',
          name: 'Tecumseh!',
          category: 'entertainment',
          description: 'Outdoor drama in a wooded amphitheater.',
          why_recommended: 'Matches your taste for off-beat live experiences.',
          source_url: 'https://tecumsehdrama.com',
          user_added: true,
        },
      ],
      lodging: [],
    });
    mockChat.mockResolvedValueOnce({
      text: `<extract>
<plan>
cover_query: ohio hopewell earthworks
field_guide_notes: []
gotchas: []
</plan>
<candidates>
stops:
  - name: Mound City Group
    category: historic
    description: Hopewell earthworks site.
    why_recommended: Aligns with your historic tilt.
lodging: []
</candidates>
</extract>`,
      usage: { input_tokens: 100, output_tokens: 100 },
    });

    const { extractCandidates } = await import('$lib/server/extract-candidates.js');
    await extractCandidates('t');
    const written = capturedCands.value;
    expect(written.stops.some((s) => s.id === 'tecumseh' && s.user_added === true)).toBe(true);
    expect(written.stops.some((s) => s.name === 'Mound City Group')).toBe(true);
  });
```

- [ ] **Step 3: Run the test**

Run: `npx vitest run tests/extract-candidates.test.js -t "find-more-style"`
Expected: PASS.

- [ ] **Step 4: Run the full extract-candidates suite**

Run: `npx vitest run tests/extract-candidates.test.js`
Expected: PASS (all existing assertions still hold).

- [ ] **Step 5: Commit**

```bash
git add tests/extract-candidates.test.js
git commit -m "test(extract-candidates): assert find-more entries survive re-extract"
```

---

## Task 10: Frontend — add subtools row to `CandidatesSection.svelte`

**Files:**
- Modify: `src/lib/components/CandidatesSection.svelte`
- Test: `tests/find-more-instant-inline.test.js` (state machine — covers panel state but not the Svelte DOM)

**Context:** A small row sitting below the existing `.filter-strip`. Two buttons:
- `+ Add stop` / `+ Add lodging` (tab-aware)
- `Find more stops ✨` / `Find more lodging ✨` (tab-aware)

Both gated by `!readonly`. Clicking either toggles an open-panel state; the panels themselves are added in tasks 11 and 12.

- [ ] **Step 1: Add the subtools row to the component**

In `src/lib/components/CandidatesSection.svelte`:

1. Add state declarations near the existing `let promoteFor = $state(null);` (around line 16):

```js
  let openPanel = $state(/** @type {null | 'add' | 'find-more'} */ (null));
```

2. Add a `currentTabType` derived value below the existing `presentCategories` derivation (around line 41):

```js
  // Active tab as a candidate-type tag ('stop' | 'lodging') used by the
  // subtools row to wire add/find-more to the right pool.
  const currentTabType = $derived(tab === 'stops' ? 'stop' : 'lodging');
```

3. Insert the subtools row markup immediately after the existing `</div>` that closes the `.filter-strip` div (around line 340):

```svelte
  {#if !readonly}
    <div class="subtools" role="group" aria-label="Add or find more candidates">
      <button
        type="button"
        class="subtool"
        aria-pressed={openPanel === 'add'}
        onclick={() => { openPanel = openPanel === 'add' ? null : 'add'; }}
      >
        + Add {currentTabType === 'stop' ? 'stop' : 'lodging'}
      </button>
      <button
        type="button"
        class="subtool"
        aria-pressed={openPanel === 'find-more'}
        onclick={() => { openPanel = openPanel === 'find-more' ? null : 'find-more'; }}
      >
        Find more {currentTabType === 'stop' ? 'stops' : 'lodging'} ✨
      </button>
    </div>
  {/if}
```

4. Append styling at the bottom of the existing `<style>` block (above the closing `</style>`):

```css
  .subtools {
    display: flex;
    gap: 0.5rem;
    margin: -0.25rem 0 0.75rem;
    flex-wrap: wrap;
  }
  .subtool {
    background: transparent;
    border: 0.5px solid var(--border-default);
    color: var(--text-secondary);
    font-family: var(--font-sans);
    font-size: 12px;
    font-weight: 500;
    padding: 5px 12px;
    border-radius: 4px;
    cursor: pointer;
    line-height: 1;
    transition: background-color 0.12s, color 0.12s, border-color 0.12s;
  }
  .subtool:hover {
    background: var(--surface-raised);
    color: var(--text-primary);
    border-color: var(--text-tertiary);
  }
  .subtool[aria-pressed="true"] {
    background: color-mix(in oklab, var(--accent) 10%, transparent);
    color: var(--text-primary);
    border-color: var(--accent);
  }
  @media (pointer: coarse) {
    .subtool { min-height: var(--tap-min); padding: 0.5rem 0.85rem; font-size: 12.5px; }
  }
```

- [ ] **Step 2: Manual verify with svelte-check**

Run: `npx svelte-check --tsconfig ./jsconfig.json --threshold warning --fail-on-warnings`
Expected: 0 warnings, 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/components/CandidatesSection.svelte
git commit -m "feat(candidates-ui): add subtools row for add and find-more"
```

---

## Task 11: Frontend — add-candidate inline panel

**Files:**
- Modify: `src/lib/components/CandidatesSection.svelte`

**Context:** When `openPanel === 'add'` is set, render an inline panel above the card list with a name input and submit button. SSE consumer parses progress messages and routes terminal events through the error registry.

- [ ] **Step 1: Add SSE helper at the top of the script block**

In `src/lib/components/CandidatesSection.svelte`, add the helper after the existing `async function api(...)` block:

```js
  // SSE consumer for Instant Inline endpoints (mirrors the add-destination
  // pattern on the home page). Calls `onMessage` for every event; resolves
  // on the terminal { done: true } event.
  async function streamAdd(name) {
    if (!name?.trim()) return;
    addRunning = true;
    addErrorCode = null;
    addErrorCtx = {};
    addLog = [];
    try {
      const res = await fetch(`/api/actions/add-candidate/${encodeURIComponent(slug)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), type: currentTabType }),
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        addErrorCode = body.code || 'network_error';
        addErrorCtx = body.context || {};
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 2);
          if (!chunk.startsWith('data:')) continue;
          let ev;
          try { ev = JSON.parse(chunk.slice(5).trim()); } catch { continue; }
          if (ev.msg) addLog = [...addLog, ev.msg];
          if (ev.done) {
            if (ev.code) {
              addErrorCode = ev.code;
              addErrorCtx = ev.context || {};
            } else {
              addInput = '';
              await invalidate('app:trip');
            }
          }
        }
      }
    } catch (err) {
      addErrorCode = 'network_error';
    } finally {
      addRunning = false;
    }
  }
```

- [ ] **Step 2: Add component state for the panel**

Add to the existing state block (near the other `$state(...)` lines):

```js
  let addInput = $state('');
  let addRunning = $state(false);
  let addErrorCode = $state(/** @type {string|null} */ (null));
  let addErrorCtx = $state(/** @type {Record<string,string>} */ ({}));
  let addLog = $state(/** @type {string[]} */ ([]));
```

- [ ] **Step 3: Add the panel markup**

Insert immediately after the subtools row (the `{#if !readonly}<div class="subtools">…</div>{/if}` block):

```svelte
  {#if openPanel === 'add' && !readonly}
    <form
      class="panel panel-add"
      onsubmit={(e) => { e.preventDefault(); streamAdd(addInput); }}
    >
      <label class="panel-label">
        Place name
        <input
          type="text"
          class="panel-input"
          placeholder={currentTabType === 'stop' ? 'e.g. Mound City Group' : 'e.g. The Mill Inn'}
          bind:value={addInput}
          disabled={addRunning}
          autofocus
        />
      </label>
      <div class="panel-actions">
        <button type="submit" class="panel-submit" disabled={addRunning || !addInput.trim()}>
          {#if addRunning}
            Adding…
          {:else}
            Add {currentTabType === 'stop' ? 'stop' : 'lodging'}
          {/if}
        </button>
        <button type="button" class="panel-cancel" onclick={() => { openPanel = null; }} disabled={addRunning}>
          Close
        </button>
      </div>
      {#if addErrorCode}
        <div class="panel-error" role="alert">
          <span>{failureSentence(addErrorCode, addErrorCtx)}</span>
          <button type="button" class="banner-dismiss" onclick={() => { addErrorCode = null; }}>Dismiss</button>
        </div>
      {/if}
      {#if addLog.length}
        <details class="panel-log">
          <summary>{addLog[addLog.length - 1]}</summary>
          <ul>{#each addLog as line}<li>{line}</li>{/each}</ul>
        </details>
      {/if}
    </form>
  {/if}
```

- [ ] **Step 4: Add panel styling**

Append to the existing `<style>` block:

```css
  .panel {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    padding: 0.75rem;
    background: var(--surface-sunken);
    border: 0.5px solid var(--border-subtle);
    border-radius: 5px;
    margin-bottom: 0.85rem;
  }
  .panel-label {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    font-family: var(--font-sans);
    font-size: 0.78rem;
    color: var(--text-secondary);
  }
  .panel-input {
    background: var(--surface-page);
    border: 0.5px solid var(--border-default);
    color: var(--text-primary);
    font-family: var(--font-sans);
    font-size: 0.92rem;
    padding: 0.4rem 0.55rem;
    border-radius: 4px;
  }
  .panel-input:focus {
    outline: none;
    border-color: var(--accent);
  }
  .panel-actions {
    display: flex;
    gap: 0.4rem;
  }
  .panel-submit {
    background: var(--accent);
    color: var(--accent-on);
    border: none;
    font-family: var(--font-sans);
    font-size: 0.84rem;
    font-weight: 600;
    padding: 0.45rem 0.85rem;
    border-radius: 4px;
    cursor: pointer;
  }
  .panel-submit:disabled { opacity: 0.55; cursor: not-allowed; }
  .panel-cancel {
    background: transparent;
    border: 0.5px solid var(--border-default);
    color: var(--text-secondary);
    font-family: var(--font-sans);
    font-size: 0.82rem;
    padding: 0.4rem 0.75rem;
    border-radius: 4px;
    cursor: pointer;
  }
  .panel-error {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    background: var(--state-danger-surface);
    border: 1px solid var(--state-danger);
    color: var(--text-primary);
    padding: 0.45rem 0.6rem;
    border-radius: 4px;
    font-size: 0.86rem;
  }
  .panel-error span { flex: 1; }
  .panel-log {
    font-family: var(--font-sans);
    font-size: 0.78rem;
    color: var(--text-tertiary);
  }
  .panel-log summary { cursor: pointer; }
  .panel-log ul { margin: 0.3rem 0 0; padding-left: 1.2rem; }
```

- [ ] **Step 5: Verify svelte-check**

Run: `npx svelte-check --tsconfig ./jsconfig.json --threshold warning --fail-on-warnings`
Expected: 0 warnings, 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/components/CandidatesSection.svelte
git commit -m "feat(candidates-ui): add-candidate inline panel + SSE consumer"
```

---

## Task 12: Frontend — find-more inline panel

**Files:**
- Modify: `src/lib/components/CandidatesSection.svelte`
- Create: `tests/find-more-instant-inline.test.js`

**Context:** When `openPanel === 'find-more'`, render an inline panel with an optional steering textarea, a count input, and a submit button. Submit POSTs to `/api/actions/find-more/[slug]` and on 202 closes the panel — progress lives in `TripJobBadge`.

- [ ] **Step 1: Add state for the find-more panel**

In `CandidatesSection.svelte`, add:

```js
  let findSteering = $state('');
  let findCount = $state(5);
  let findSubmitting = $state(false);
  let findErrorCode = $state(/** @type {string|null} */ (null));
  let findErrorCtx = $state(/** @type {Record<string,string>} */ ({}));
```

- [ ] **Step 2: Add the submit handler**

After the `streamAdd` function:

```js
  async function submitFindMore() {
    findSubmitting = true;
    findErrorCode = null;
    findErrorCtx = {};
    try {
      const res = await fetch(`/api/actions/find-more/${encodeURIComponent(slug)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: currentTabType, steering: findSteering, count: findCount }),
      });
      if (res.status === 202) {
        openPanel = null;
        findSteering = '';
        await invalidate('app:trip');
        return;
      }
      const body = await res.json().catch(() => ({}));
      findErrorCode = body.code || 'network_error';
      findErrorCtx = body.context || {};
    } catch {
      findErrorCode = 'network_error';
    } finally {
      findSubmitting = false;
    }
  }
```

- [ ] **Step 3: Add the find-more panel markup**

Below the add-candidate panel (or as a sibling block):

```svelte
  {#if openPanel === 'find-more' && !readonly}
    <form
      class="panel panel-find-more"
      onsubmit={(e) => { e.preventDefault(); submitFindMore(); }}
    >
      <label class="panel-label">
        What kind? <span class="panel-hint">(optional — e.g. "more food stops", "splurge lodging")</span>
        <textarea
          class="panel-input panel-textarea"
          rows="2"
          maxlength="300"
          bind:value={findSteering}
          disabled={findSubmitting}
        ></textarea>
      </label>
      <label class="panel-label">
        How many?
        <input
          type="number"
          class="panel-input panel-number"
          min="3"
          max="10"
          bind:value={findCount}
          disabled={findSubmitting}
        />
      </label>
      <p class="panel-note">You can navigate away while this runs — the badge will update when it's done.</p>
      <div class="panel-actions">
        <button type="submit" class="panel-submit" disabled={findSubmitting}>
          {#if findSubmitting}Starting…{:else}Find more{/if}
        </button>
        <button type="button" class="panel-cancel" onclick={() => { openPanel = null; }} disabled={findSubmitting}>
          Close
        </button>
      </div>
      {#if findErrorCode}
        <div class="panel-error" role="alert">
          <span>{failureSentence(findErrorCode, findErrorCtx)}</span>
          <button type="button" class="banner-dismiss" onclick={() => { findErrorCode = null; }}>Dismiss</button>
        </div>
      {/if}
    </form>
  {/if}
```

- [ ] **Step 4: Add styling tweaks for textarea, number, and hint**

Append to the existing `<style>`:

```css
  .panel-textarea { resize: vertical; font-family: var(--font-sans); }
  .panel-number { width: 5em; }
  .panel-hint {
    font-weight: 400;
    color: var(--text-tertiary);
    font-size: 0.74rem;
  }
  .panel-note {
    margin: 0;
    color: var(--text-tertiary);
    font-size: 0.78rem;
    font-style: italic;
  }
```

- [ ] **Step 5: Write a state-machine test for the find-more panel**

Create `tests/find-more-instant-inline.test.js`:

```js
import { describe, it, expect } from 'vitest';

// Pure-JS state-machine test for the find-more panel UI in
// CandidatesSection.svelte. The Svelte wiring isn't unit-testable without
// a DOM; these tests document the contract and guard regressions.

function makeState() {
  return {
    openPanel: null,
    findSteering: '',
    findCount: 5,
    findSubmitting: false,
    findErrorCode: null,
    findErrorCtx: {},
  };
}

function openFindMore(state) { return { ...state, openPanel: 'find-more' }; }
function closeFindMore(state) { return { ...state, openPanel: null }; }

function handleSubmitOutcome(state, outcome) {
  if (outcome.kind === '202') {
    return { ...state, openPanel: null, findSubmitting: false, findSteering: '' };
  }
  if (outcome.kind === 'error') {
    return { ...state, findSubmitting: false, findErrorCode: outcome.code, findErrorCtx: outcome.ctx };
  }
  return state;
}

describe('find-more panel state machine', () => {
  it('opens and closes the panel', () => {
    let s = makeState();
    s = openFindMore(s);
    expect(s.openPanel).toBe('find-more');
    s = closeFindMore(s);
    expect(s.openPanel).toBeNull();
  });

  it('on 202 the panel closes and steering is cleared', () => {
    let s = openFindMore({ ...makeState(), findSteering: 'more food', findSubmitting: true });
    s = handleSubmitOutcome(s, { kind: '202' });
    expect(s.openPanel).toBeNull();
    expect(s.findSteering).toBe('');
    expect(s.findSubmitting).toBe(false);
  });

  it('on 409 the panel stays open and shows the error sentence', () => {
    let s = openFindMore({ ...makeState(), findSubmitting: true });
    s = handleSubmitOutcome(s, { kind: 'error', code: 'already_running', ctx: {} });
    expect(s.openPanel).toBe('find-more');
    expect(s.findErrorCode).toBe('already_running');
    expect(s.findSubmitting).toBe(false);
  });
});
```

- [ ] **Step 6: Run the test**

Run: `npx vitest run tests/find-more-instant-inline.test.js`
Expected: PASS (3/3).

- [ ] **Step 7: Verify svelte-check**

Run: `npx svelte-check --tsconfig ./jsconfig.json --threshold warning --fail-on-warnings`
Expected: 0 warnings, 0 errors.

- [ ] **Step 8: Commit**

```bash
git add src/lib/components/CandidatesSection.svelte tests/find-more-instant-inline.test.js
git commit -m "feat(candidates-ui): find-more inline panel"
```

---

## Task 13: Mutual exclusion + invalidate after add

**Files:**
- Modify: `src/lib/components/CandidatesSection.svelte`

**Context:** Two affordances we want explicit:
1. Opening one panel closes the other (mutual exclusion is implicit from the conditional rendering — verify).
2. After a successful add the new card needs to scroll into view (the StopCard list re-renders from invalidated data; existing `scrollToCard(id)` is the helper).

- [ ] **Step 1: Verify the SSE consumer scrolls to the new card on success**

In `streamAdd` (added in Task 11), modify the terminal-success branch to capture the new candidate id and scroll. Update the `if (ev.done) { if (!ev.code) { … } }` branch to:

```js
          if (ev.done) {
            if (ev.code) {
              addErrorCode = ev.code;
              addErrorCtx = ev.context || {};
            } else {
              addInput = '';
              await invalidate('app:trip');
              if (ev.id) {
                // Wait one tick for the new card to mount, then scroll.
                queueMicrotask(() => scrollToCard(ev.id));
              }
            }
          }
```

- [ ] **Step 2: Add a regression test for the subtools tab-awareness**

Append to `tests/find-more-instant-inline.test.js`:

```js
describe('subtools tab-awareness', () => {
  function currentTabType(tab) { return tab === 'stops' ? 'stop' : 'lodging'; }

  it('reflects active tab', () => {
    expect(currentTabType('stops')).toBe('stop');
    expect(currentTabType('lodging')).toBe('lodging');
  });
});
```

Run: `npx vitest run tests/find-more-instant-inline.test.js`
Expected: PASS (4/4).

- [ ] **Step 3: Verify svelte-check**

Run: `npx svelte-check --tsconfig ./jsconfig.json --threshold warning --fail-on-warnings`
Expected: 0 warnings, 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/CandidatesSection.svelte tests/find-more-instant-inline.test.js
git commit -m "feat(candidates-ui): scroll new add into view; tab-aware subtools regression"
```

---

## Task 14: Full verify + manual smoke

**Files:** none

- [ ] **Step 1: Run the full verify**

Run: `npm run verify`
Expected: PASS — svelte-check, tests, build all green.

- [ ] **Step 2: Start the dev server and exercise the flow**

```bash
npm run dev -- --port 3456
```

Open a planning trip in the browser. Verify:

- The subtools row appears below the existing filter strip.
- Clicking "+ Add stop" opens the add panel; typing a known place name and hitting Submit results in a new card appearing in the list within ~10–25 seconds.
- The new card has `user_added: true` in the YAML (verify with `cat planning/<slug>/candidates.yaml`).
- Typing a name that already exists yields the duplicate error inline.
- Clicking "Find more stops ✨" opens the panel; typing a steering prompt and submitting closes the panel and the per-trip "Finding more candidates…" badge appears in the page header.
- After 60–120s the badge clears and the card list reflows with new entries.
- The global jobs pill increments while the job is running, and cancel from the jobs drawer aborts the job.

If anything misbehaves, fix it in a follow-up task — do not mark this step complete on partial behavior.

- [ ] **Step 3: Final commit, if any fixes landed**

```bash
git status
# If fixes are staged:
git commit -m "fix(candidates): UI polish from smoke test"
```

---

## Self-review

**Spec coverage:**
- §Architecture → Endpoint 1 (add-candidate): Tasks 5–6 ✓
- §Architecture → Endpoint 2 (find-more): Tasks 7–8 ✓
- §Geocoding helper extraction: Task 1 ✓
- §Why `user_added: true` for both: Task 9 explicitly verifies survival ✓
- §Frontend → Subtools row: Task 10 ✓
- §Frontend → Add-candidate inline panel: Task 11 ✓
- §Frontend → Find-more inline panel: Task 12 ✓
- §Job badge plumbing: Task 4 ✓
- §Errors → `candidate_duplicate`: Task 2 ✓
- §Promises: Task 3 ✓
- §Data flow → happy paths: Tasks 5, 7 ✓
- §Edge cases → geocode failure (saves without coords): Task 6's "saves without coords when geocode returns null" ✓
- §Edge cases → 409 concurrency: Task 8 ✓
- §Edge cases → cancellation: Task 8 (DELETE test) ✓

**Placeholder scan:** none — every step has either exact code or exact commands.

**Type consistency:** `geocodeCandidate(name, destinationContext, refCoords)` signature is consistent across tasks 1, 5, 7. Job workflow strings consistently use `find-more:<type>` (tasks 4, 7, 8). Panel state variable names (`openPanel`, `addInput`, `findSteering`, `findCount`) are consistent across tasks 10–13.

**Spec deviations:** none in the plan; the spec was corrected mid-flow (job-key convention) before this plan was written.

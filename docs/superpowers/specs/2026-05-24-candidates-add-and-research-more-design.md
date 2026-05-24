# Candidates — manual add + "find more" batch (design)

**Date:** 2026-05-24
**Status:** Draft (pending review)

## Problem

The Candidates section on a planning trip is a discover-and-whittle surface: research seeds the pool, the user hides what they don't want, and promotes survivors into days. Two real gaps:

1. **No way to add a candidate the user already has in mind.** If you know you want "Mound City Group" included as a stop or "The Edgewater Hotel" as lodging, today you can't — the only entry into the pool is the canonical extract pass that runs after research.
2. **No way to ask for more.** Once the initial researcher pool is picked clean, there's no batch top-up affordance. Re-running deepen replaces the pool wholesale and overwrites prose — too heavy for "I want five more food stops."

Both gaps share a constraint: anything added has to survive a future re-research without being clobbered. `extract-candidates.js` already preserves entries with `user_added: true`, so the design hinges on funnelling both flows through that flag.

## Approach summary

Two new endpoints, two new UI affordances in `CandidatesSection.svelte`:

| Flow                  | Endpoint                                | Archetype          | Approx wall-clock |
|-----------------------|-----------------------------------------|--------------------|-------------------|
| Add one candidate     | `POST /api/actions/add-candidate/[slug]` | Instant Inline (SSE) | ~5–25s |
| Find more candidates  | `POST /api/actions/find-more/[slug]`     | Ambient Background  | ~60–120s |

Both reuse `chat()`, `searchToolDefinition()`, `geocode()`, and `addCandidateStop/Lodging`. Both write entries with `user_added: true` so re-extracts preserve them. Both are tab-aware (act on the current Stops/Lodging tab) and hidden when `readonly` (completed trips).

## Architecture

### Server

#### Endpoint 1: `POST /api/actions/add-candidate/[slug]` (Instant Inline)

Modeled on `src/routes/api/actions/add/+server.js`. SSE stream, button-as-spinner UX.

**Request:** `{ name: string, type: 'stop' | 'lodging' }`

**Flow:**

1. Gate on `getFeatureAvailability().homeMdReady` (412 if not configured).
2. `rateLimitResponse({ event, endpoint: 'add-candidate', slugKey: slug })`.
3. Reject invalid slug via `rejectInvalidSlug`.
4. Read `candidates.yaml` (`readCandidates(slug)`) and the trip's `overview.md` frontmatter (for `destination` context).
5. **Server-side duplicate guard** (cheap, deterministic): case-insensitively compare normalized input name against existing candidates *of the same type*. Exact match → emit terminal SSE event with `code: 'candidate_duplicate'`, context `{ name: <existing> }`. Stops processing.
6. Build the prompt. System message includes:
   - The home.md context.
   - The trip's destination, vibe, and any existing prose summary.
   - Existing candidate names of the same type, as a "don't re-suggest these" list (the model still might — server enforces, this is a hint).
   - "If you don't recognize this place with confidence, use web_search before responding. If still unsure, leave `description` generic and `source_url` blank. Do not invent operating hours, prices, or trivia."
   - Output envelope: exactly one of `<candidate>YAML</candidate>` (valid) or `<duplicate>existing name</duplicate>` (semantically duplicates an existing candidate) or `<not-applicable>brief reason</not-applicable>` (place isn't drivable to / doesn't exist near the destination).
7. Call `chat()` with `tools: [searchToolDefinition()]` and `onToolCall` wired to `search()`. The model decides whether to search; well-known places skip, obscure ones trigger 1–2 searches.
8. Parse the response:
   - `<duplicate>`: emit SSE error event with `code: 'candidate_duplicate'`, terminal.
   - `<not-applicable>`: emit SSE error with `code: 'invalid_input'` and the model's reason, terminal.
   - `<candidate>`: parse YAML; validate fields (category in `STOP_CATEGORIES`, price_tier in `LODGING_PRICE_TIERS`).
9. **Geocode** via the same destination-scoped + 200mi sanity check pattern from `extract-candidates.js::geocodeCandidates`. On scoped + sanity failure, save without coords (renders unmapped — consistent with brochure's unmapped treatment).
10. Call `addCandidateStop(slug, fields)` or `addCandidateLodging(slug, fields)`. Both set `user_added: true` (already wired). The user-supplied `name` becomes the candidate's `name` field verbatim.
11. `invalidateEnrichCache()`. Emit a final SSE success event with the new candidate's id.

**Response:** SSE stream. Final event carries `{ ok: true, id, tokens }` or `{ code, context }`.

**`_promise`** registered as `add-candidate` in `src/lib/server/promises.js`:

```js
'add-candidate': {
  verb: 'Add candidate',
  produces: 'One new stop or lodging candidate, with category, description, and (when web-searchable) a verified source.',
  time_seconds: 18,
  tokens_range: [400, 1200],
}
```

`MAX_TOKENS['add-candidate'] = 1000`.

#### Endpoint 2: `POST /api/actions/find-more/[slug]` (Ambient Background)

Modeled on `src/routes/api/actions/deepen/[slug]/+server.js`. Registers with `jobs.js`.

**Request:** `{ type: 'stop' | 'lodging', steering?: string, count?: number }` (default 5, clamped to [3, 10]).

**Job key:** discriminator goes in the **workflow** arg per the convention documented in `src/lib/server/jobs.js` (so `TripJobBadge.svelte`'s `filterJobsForSlug` exact-slug match still surfaces every concurrent job). Calls: `startJob('find-more:stop', slug)` → key `find-more:stop:<slug>`, `startJob('find-more:lodging', slug)` → key `find-more:lodging:<slug>`. Slug stays clean. Two same-type concurrent calls still 409; stops + lodging for the same trip can run concurrently.

**Flow:**

1. Gate on `homeMdReady`, rate-limit (`endpoint: 'find-more'`, `slugKey: ${slug}:${type}`), reject invalid slug.
2. Verify trip is planning stage (`findPlanningOverview` returns a path).
3. `assertNotRunning(`find-more:${type}`, slug)` — 409 if already running.
4. `startJob(`find-more:${type}`, slug, { est_seconds: _promise.time_seconds })`. This writes `running: 'find-more:<type>'` to the overview frontmatter (per-trip badge picks it up automatically).
5. Return `202 Accepted` immediately.
6. Background worker:
   - Reads `overview.md` prose, `route.md`, `logistics.md`, `candidates.yaml`, `home.md`.
   - Builds prompt:
     - Trip context + home preferences.
     - **Existing candidate names** of the requested type (don't re-suggest these — server will also dedupe by normalized name as a backstop).
     - Optional `steering` prompt embedded verbatim ("The user wants: <steering>"). If absent, the prompt says "Find under-represented categories in the current pool" for stops, or "Find tiers and locations not yet covered" for lodging.
     - Output envelope: `<additions>YAML</additions>` containing one of `stops:` or `lodging:` arrays with `count` entries.
   - `chat()` with `tools: [searchToolDefinition()]`, `signal: job.controller.signal`.
   - Parse YAML, validate fields (drop entries that fail validation rather than failing the whole batch — log a warning).
   - **Server-side dedupe**: filter out any new entry whose normalized name matches an existing candidate of the same type.
   - **Geocode** each survivor via the same `extract-candidates.js::geocodeCandidates` pattern.
   - For each survivor, call `addCandidateStop`/`addCandidateLodging` (each sets `user_added: true` and assigns a unique id via `makeCandidateId`).
   - `invalidateEnrichCache()`.
   - `completeJob(`find-more:${type}`, slug, { tokens })`.
7. On `AbortError`: swallow (`cancelJob` already wrote the failure event).
8. On other failure: log; `failJob(`find-more:${type}`, slug, { code, message })`.

**`DELETE`:** thin shim → `cancelJob(`find-more:${type}`, slug)`.

**`_promise`** registered as `find-more`:

```js
'find-more': {
  verb: 'Find more candidates',
  produces: 'A batch of additional stop or lodging candidates, scoped to your steering prompt and de-duped against the existing pool.',
  time_seconds: 90,
  tokens_range: [4000, 12000],
}
```

`MAX_TOKENS['find-more'] = 6000`.

### Why `user_added: true` for both

Both flows produce candidates the user explicitly asked for (typed-by-name, or batch-summoned with intent). The merge logic in `extract-candidates.js` (lines 184–217) preserves `user_added: true` entries across re-research runs and reassigns ids on slug collision. Treating both new flows as `user_added` keeps that logic unchanged and means find-more results accumulate across re-research — exactly the behavior implied by "I want more, please don't take them away later."

This is a deliberate semantic compromise: a "find-more" result is technically researcher-sourced, but functionally it's user-curated (the user pulled the trigger and steered the prompt). Setting `user_added: true` reflects ownership of the *decision to include*, which is what the merge logic actually cares about.

### Geocoding helper extraction

`extract-candidates.js` has a private `geocodeCandidates(cands, destinationContext)` function that does destination-scoped Nominatim lookups with 200-mile sanity bounds. Both new endpoints need the same logic. **Extract it** into `src/lib/server/candidates.js` as `geocodeCandidate(name, destinationContext)` returning `coords | null`. `extract-candidates.js` then calls it in a loop. This is the targeted improvement the brainstorming skill calls for when working in existing code.

### Frontend (CandidatesSection.svelte)

#### Toolbar additions

Add a thin **subtools row** below the existing filter-strip when not `readonly`:

```
[ + Add stop ]   [ Find more stops ✨ ]
```

Buttons reflect the active tab (`tab === 'stops'` shows "Add stop" / "Find more stops"; tab swap rebrands them). Both gated behind `!readonly`.

The subtools row's styling matches the existing filter-strip's secondary-button look — small, low-chrome, accessible. Live below the strip rather than inside it to avoid crowding the chips on narrow widths.

#### Add-candidate inline panel

Clicking "+ Add stop" (or "+ Add lodging") opens an **inline panel** above the card list (mutually exclusive with the find-more panel — only one can be open at a time).

Contents:

- Single text input: "Place name" (autofocus on open).
- Submit button: label tracks current tab ("Add stop" / "Add lodging").
- Cancel/close affordance.
- Below the input: an SSE status ticker (`<details>` collapsed by default, opens when an error occurs to expose the event log — power-user mode, per the rubric).

Wire-up:
- Submit POSTs to `/api/actions/add-candidate/[slug]` with `{ name, type: tab === 'stops' ? 'stop' : 'lodging' }`.
- Button-as-spinner during the call.
- SSE status events route through `failureSentence` from `errors-registry.js`. Terminal error events render the registry sentence + recovery affordances inline below the input.
- Terminal success: clear the input, `invalidate('app:trip')` (existing pattern), animate the new card into view (`scrollToCard(newId)` after invalidation).
- Duplicate error (`candidate_duplicate`): "{name} is already in your list" with a "Dismiss" affordance.

#### Find-more popover/panel

Clicking "Find more stops ✨" (or "Find more lodging ✨") opens an inline panel (same mutual-exclusion slot as add-candidate).

Contents:

- Optional textarea: "What kind? *(optional — e.g. 'more food stops', 'splurge lodging near the lake')*" with a short placeholder.
- Number input: "How many?" — default 5, min 3, max 10.
- Submit button: "Find more" (with promise tooltip showing `verb · ~time · ~tokens`).
- Cancel/close affordance.
- Below: brief note ("You can navigate away while this runs." — Ambient Background standard).

Wire-up:
- Submit POSTs to `/api/actions/find-more/[slug]` with `{ type, steering, count }`.
- On 202: panel closes, no further client polling needed — the global pill + per-trip badge surface progress.
- On 409 (`already_running`): panel stays open with the error sentence inline.
- On completion: existing Ambient Background invalidation flow refreshes the page, new cards appear with `user_added: true` styling (existing — `user_added` is already a visible property in the YAML).

#### Job badge plumbing

`TripJobBadge.svelte` needs to recognize the new `find-more` job kind so the per-trip header label reads "Finding more stops…" / "Finding more lodging…" rather than a generic fallback. Map the job kind via the type suffix in the job key: when key matches `<slug>:stop` show "stops", `<slug>:lodging` show "lodging".

### Errors

New entry in `src/lib/errors-registry.js` (and the matching `TraverseError` instance):

```js
candidate_duplicate: {
  sentence: '"{name}" is already in your candidates. Try a different name.',
  affordances: ['dismiss'],
  interpolate: ['name'],
}
```

All other failure modes route through existing codes: `empty_model_output`, `network_error`, `provider_error`, `cancelled`, `geocode_quota`, `timeout`, `invalid_input`.

### Files changed

**New:**
- `src/routes/api/actions/add-candidate/[slug]/+server.js`
- `src/routes/api/actions/find-more/[slug]/+server.js`
- `tests/add-candidate.test.js`
- `tests/find-more.test.js`

**Edited:**
- `src/lib/components/CandidatesSection.svelte` — subtools row + two inline panels.
- `src/lib/components/TripJobBadge.svelte` — recognize `find-more` job kind.
- `src/lib/server/promises.js` — `add-candidate` and `find-more` `_promise` entries + `MAX_TOKENS`.
- `src/lib/server/candidates.js` — export `geocodeCandidate(name, destinationContext)` helper.
- `src/lib/server/extract-candidates.js` — replace inline `geocodeCandidates` loop with calls to the extracted helper.
- `src/lib/errors-registry.js` — `candidate_duplicate` entry.
- `src/lib/server/errors.js` — register `candidate_duplicate` if needed for the registry test.

## Data flow

### Add-candidate happy path

```
User types "Mound City Group" in stops tab → submit
  ↓
SSE POST /api/actions/add-candidate/[slug]
  ↓
server: "Checking for duplicates…"
  ↓ dedup pass — no exact match
server: "Looking up Mound City Group…"
  ↓ chat() with web_search available
  ↓ model returns <candidate>YAML</candidate>
server: "Pinning location…"
  ↓ geocode("Mound City Group", "Chillicothe, OH") → coords
  ↓ addCandidateStop(slug, { name, category, description, why_recommended, source_url, coords })
server: { ok: true, id: 'mound-city-group', tokens: 612 } [terminal]
  ↓
client: invalidate('app:trip'), clear input, scroll new card into view
```

### Find-more happy path

```
User on stops tab, opens Find more panel, types "more outdoors near the southern leg", count=5
  ↓
POST /api/actions/find-more/[slug] body: { type: 'stop', steering, count: 5 }
  ↓
server: assertNotRunning('find-more', 'great-smoky-ramble:stop')
server: startJob → 202 Accepted, writes running: 'find-more' to overview frontmatter
  ↓
client: panel closes, badge appears, pill increments
worker: chat() with web_search, signal=job.controller.signal
worker: parses <additions><stops>YAML</stops></additions>
worker: filters out 2 names that already exist (server-side dedupe)
worker: geocode each survivor (3 survivors)
worker: addCandidateStop × 3
worker: completeJob({ tokens: 8400 })
  ↓
client: toast "Found 3 stops", pill decrements, badge clears, card list refreshes
```

### Edge cases and gotchas

- **Pre-research add-candidate**: Manual add requires `overview.md` to exist (for destination context). If absent, return 412 with `code: 'wrong_stage'`. In practice, CandidatesSection only renders on planning trips, so the UI never sends this — the server guard is a defense.
- **Geocode failure**: Save the candidate without `coords`. It renders unmapped on the map, consistent with the brochure's "unmapped" treatment. The user can still promote it to a day.
- **Model refuses ("place doesn't exist")**: The `<not-applicable>` envelope path emits an `invalid_input` error with the model's reason, terminal. No file written.
- **Re-extract after find-more**: A future `deepen` re-research wholesale-replaces researcher entries (`user_added: false`) but preserves user-added ones — find-more results survive, just as manual adds do.
- **Job key collision risk**: Encoding `type` in the job key (`find-more:${type}`, slug) means a slug literally containing `:stop` would collide. Slugs are kebab-case (`[^a-z0-9-]` is rejected by `rejectInvalidSlug`), so colons can't appear in user-provided slugs. Safe.
- **Two find-more jobs same type same trip**: Server returns 409 via `assertNotRunning`. The panel surfaces the error sentence inline.
- **Cancellation mid-search**: The job's `AbortController` flows into `chat()`. The model call aborts; partial state on disk is none (file writes happen only after the full extract is parsed). `failJob('find-more', ..., { code: 'cancelled' })` already wired by `cancelJob`.

## Testing

### `tests/add-candidate.test.js`

- Stub `chat()` to return a known `<candidate>` envelope; assert YAML parsed and `addCandidateStop` called with correct fields.
- Stub `geocode()` to return null; assert candidate is saved without coords (no throw).
- Stub `chat()` to return `<duplicate>existing</duplicate>`; assert terminal SSE event has `code: 'candidate_duplicate'`.
- Stub `chat()` to return `<not-applicable>reason</not-applicable>`; assert `code: 'invalid_input'`.
- Send exact-name duplicate; assert server-side dedup short-circuits before `chat()` is called.
- Stub `chat()` to return malformed YAML; assert `model_returned_invalid_yaml` error and no file write.

### `tests/find-more.test.js`

- Stub `chat()` to return an `<additions>` envelope with 5 stops; assert all 5 written with `user_added: true`.
- Include a name in the model's output that exists in the trip's `candidates.yaml`; assert server-side dedupe filters it out before write.
- Stub geocode to return null for one entry; assert that entry saves without coords, others with coords.
- Stub `chat()` to throw `AbortError`; assert `cancelJob`'s failure event is written and no candidates are added.
- Assert `assertNotRunning` returns 409 on a second concurrent call with the same `find-more:${type}`, slug key.
- Assert two concurrent calls with different `type` for the same slug both succeed.

### `tests/extract-candidates.test.js` (existing)

Add a test: seed `candidates.yaml` with three find-more-sourced entries (`user_added: true`), run `extractCandidates`, assert all three survive the merge.

## Open considerations

- **Re-research overwrite warning**: `deepen` already pops a 409 with `dirty_sections` if user-edited prose would be overwritten. find-more results don't affect the dirty-sections check (they live in `candidates.yaml`, which isn't a tracked "section"). They're protected by the `user_added: true` flag, not by the dirty check. This is the correct seam — no change to `_collectDirtySections` needed.
- **Cost transparency**: Both buttons get `PromiseTooltip` (existing component) for the short-form promise (`verb · ~time · ~tokens`). Find-more's panel body shows the long-form promise from `_promise.produces`.
- **Telemetry**: Both calls pass `label: 'add-candidate'` / `label: 'find-more'` to `chat()`, so `workflow-stats.js` records them and the resolved promise on the next page load reflects actual p50.

## Out of scope

- Inline editing of a candidate after creation (the user can hide + re-add, or delete and re-add). A separate ticket if there's demand.
- AI-driven category re-classification of existing candidates.
- A "find similar to this" affordance on an individual candidate card.
- A confirm modal before submitting find-more (the rubric calls for one on Ambient Background; the inline panel's "you can navigate away while this runs" copy + the submit button click stand in for the confirm step here, given the trigger is already in a panel the user explicitly opened).

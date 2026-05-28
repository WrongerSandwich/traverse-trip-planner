# Per-stop metadata: hours, address, website, phone (design)

**Date:** 2026-05-27
**Issue:** [#403](https://github.com/WrongerSandwich/traverse-trip-planner/issues/403)
**Milestone:** v0.1.2 In-trip companion
**Status:** Draft — pending plan + implementation

## Problem

The brochure renders `{#if stop.hours}` and `{#if stop.address}` (`src/lib/components/Brochure.svelte` lines 248–249, 271–272), but the candidates data model doesn't supply those fields, so the guards never fire. The typography promises a field guide; the data shape only fills a pre-trip card. On-the-road usefulness — "what time does this place open, where exactly is it, can I call them" — is missing across every surface that displays a stop.

This spec defines a four-field expansion of the candidate schema (`hours`, `address`, `website`, `phone`), the sourcing pipeline that populates them, the refresh model, and how the fields render across the three surfaces a stop appears on.

## Scope

**In scope (v0.1.2):**
- Extend the candidate schema with four new optional fields on stop entries
- Capture `address` as a byproduct of the existing geocode-candidates job (no new HTTP)
- Add a new `enrich-candidates` Ambient Background job that fills `hours`, `website`, `phone` via per-stop web search
- Wire auto-trigger so the chain runs after Research with no user action: `deepen → geocode-candidates → enrich-candidates`
- Manual `Refresh metadata` button in the Candidates section header
- Render in three places: Candidates section cards, Plan section day-cards, brochure stop entries

**Out of scope (deferred):**
- Lodging metadata enrichment — same shape applies but is its own ship; stop enrichment is the milestone driver
- Mobile-specific in-trip route (`/trips/<slug>/on-the-road` or similar) — belongs in [#405](https://github.com/WrongerSandwich/traverse-trip-planner/issues/405) (export formats) or [#406](https://github.com/WrongerSandwich/traverse-trip-planner/issues/406) (per-stop to-dos)
- Staleness badges / TTL on enriched fields — manual refresh handles this; revisit if users report missing rot
- Backfill of existing planning trips on first load after deploy — silent token burn surprises users; manual Refresh is the explicit path
- Inline-during-deepen sourcing — rejected because it bloats the critical-path prompt with 8–15 stops × 4 fields of web-search expansion

## Approach summary

| Layer | Change |
|---|---|
| **Schema** | Four flat optional fields on each stop in `candidates.yaml`: `address`, `hours`, `website`, `phone` |
| **Sourcing** | Two follow-on jobs in sequence after `deepen`: (1) `geocode-candidates` extended to also write `address` from Nominatim's `display_name`; (2) new `enrich-candidates` job runs `chat()` + `search()` per stop for hours/website/phone |
| **Refresh** | `Refresh metadata` button in the Candidates section header. Default click fills only missing fields; kebab `⌄` → "Re-fetch all" forces a re-run. Auto-runs once after Research; disabled on completed trips |
| **Rendering** | Compact meta row on candidate cards · expanded stop stack in Plan day-cards · plain-text fields in the brochure (existing slots already wired) |

## Data model

Four new optional fields on each stop entry in `candidates.yaml`, **flat at the top level**:

```yaml
stops:
  - id: sleeping-bear-dunes
    name: Sleeping Bear Dunes National Lakeshore
    category: outdoors
    description: Sand dunes on Lake Michigan with sweeping overlook climbs.
    why_recommended: Park-leaning trip vibe; aligns with home preferences.
    source_url: https://www.nps.gov/slbe/
    coords: { lat: 44.88, lng: -86.05 }
    address: 9922 Front St, Empire, MI 49630           # new — written by geocode-candidates
    hours: "Visitor Center 9am–4pm daily; park 24/7"   # new — written by enrich-candidates
    website: https://www.nps.gov/slbe                  # new — written by enrich-candidates
    phone: "(231) 326-4700"                            # new — written by enrich-candidates
    user_added: false
```

**Why flat, not nested under `contact:`:**
- The brochure already references `stop.hours` / `stop.address` directly; nesting would require renaming
- Matches the existing pattern (`description`, `source_url`, `why_recommended` are all top-level)
- One fewer indirection in every consumer

**Field semantics:**
- All four fields are **optional**. Missing fields stay `undefined`, not empty strings. Every consumer guards with `{#if stop.hours}`-style checks.
- `address` is a single human-readable string, not a structured object. Geocode-candidates builds it from Nominatim's structured `address` block when present (`<road>, <city>, <state> <postcode>`) and falls back to `display_name` otherwise.
- `hours` is free-form prose. We do not parse it into a structured weekly schedule; the value is "what does the LLM's web search say" rendered verbatim.
- `website` is a URL starting with `http://` or `https://`. The enrich job drops the field if validation fails rather than rejecting the whole stop.
- `phone` is a free-form string with at least one digit. Same drop-on-validation-fail rule.
- User edits to any field win — neither job overwrites a value that's already populated unless the kebab "Re-fetch all" path explicitly forces it.

The same shape *could* later extend to lodging candidates; this spec doesn't ship lodging enrichment but the schema update doesn't preclude it.

**Schema doc to update:** `docs/superpowers/specs/2026-05-22-planning-plan-and-candidates-design.md` (the currently-authoritative candidates spec).

## Sourcing — two follow-on jobs

Orchestration chain after Research is triggered:

```
deepen → geocode-candidates → enrich-candidates
  ✓        ✓ (extended)        ✓ (new)
```

Each leg transitions automatically on completion of the prior. Each is independently cancellable from the jobs drawer and independently re-runnable. All three are Ambient Background per `docs/ai-workflow-ux.md`.

### Job 1: `geocode-candidates` (extended, not replaced)

Today the job (`src/lib/server/geocode-job.js`) queries Nominatim with `?format=json` and stores `coords`. Nominatim's response already carries a `display_name` string and a structured `address` object — pure byproduct, zero extra HTTP.

**Changes to `geocode-job.js`:**
- Same loop, same inputs, same registration, same `assertNotRunning` gating
- On each successful Nominatim hit, build an address string and write `address: <built>` alongside `coords`
- Skip the address write if the candidate already has a non-empty `address` (preserve user edits)
- Address construction: prefer structured fields (`<road>, <city>, <state> <postcode>`) when present; fall back to `display_name` verbatim when the structured block is sparse
- All existing skip/abort/progress mechanics unchanged

No new endpoint, no new job type identifier. The job's label in `BackgroundJobsIndicator` remains `Geocoding` (the work is dominantly geocoding; address capture is a freebie).

### Job 2: `enrich-candidates` (new)

Mirrors the geocode-job shape but uses `chat()` + `search()` per stop instead of Nominatim.

**New files:**
- `src/lib/server/enrich-job.js` — the job loop, mirrors `geocode-job.js`
- `src/routes/api/actions/enrich-candidates/[slug]/+server.js` — POST starts, DELETE cancels

**New constants:**
- Job workflow id: `'enrich-candidates'`
- Error code: `ENRICH_ALL_FAILED` in `src/lib/errors-registry.js` (used when every stop in the loop fails)
- `chat()` label: `'enrich-candidates'` (so `workflow-stats.json` accumulates a p50 estimate for `PromiseTooltip`)

**POST `/api/actions/enrich-candidates/[slug]` flow:**
1. `rejectInvalidSlug(slug)`
2. `rateLimitResponse({ event, endpoint: 'enrich-candidates', slugKey: slug })`
3. Gate on `getFeatureAvailability().homeMdReady` (412 if not configured)
4. `assertNotRunning('enrich-candidates', slug)` — also reject 409 if `'deepen'` or `'geocode-candidates'` is running on the same slug
5. Parse optional body `{ force: boolean }` — when `true`, the loop ignores the "skip when all three set" guard. Used by the kebab "Re-fetch all" path.
6. `startJob('enrich-candidates', slug, { est_seconds: 90 })` (seed estimate; workflow-stats refines it from there)
7. Return 202 with `{ ok: true, jobId, est_seconds }`
8. Async inner loop:
   - Read fresh candidates from disk each iteration (so user edits within the run are seen)
   - Skip entries that are `hidden: true`
   - Skip entries where all three of `hours` / `website` / `phone` are already set **unless** `force === true`
   - Check `signal?.aborted` at the top of each iteration
   - One `chat()` call per candidate with a tight prompt asking for the three fields and a `web_search` tool wired in
   - Parse the YAML response, validate field shapes, write back via `writeCandidates(slug, fresh)` atomically
   - On per-stop failure: log, leave fields untouched, continue
9. On loop exit:
   - All stops succeeded or no-op skipped → `completeJob('enrich-candidates', slug, { tokens })` with a status message like `"Enriched 9 of 11 stops"`
   - Every attempted stop failed → `failJob('enrich-candidates', slug, { code: 'ENRICH_ALL_FAILED', message })`
   - Aborted (cancel or restart) → existing `sweepStaleJobs()` machinery sets `last_run_error: 'interrupted'` on next boot

**DELETE `/api/actions/enrich-candidates/[slug]`:**
- `cancelJob('enrich-candidates', slug)` — aborts the signal mid-loop, partial writes persist on disk

**Per-stop prompt envelope** (concrete shape, to be refined during implementation):

```
System: You are a research assistant. For the place named below, return current
operating hours, official website URL, and phone number. Use the web_search tool
if you are not certain. If a field is not findable, omit it. Do not invent.

User: Place: <stop.name>
      Context: <trip destination, e.g. "Northern Michigan; Sleeping Bear Dunes area">
      Address: <stop.address if present>

Respond with YAML only:
hours: <free-form string>
website: <https URL>
phone: <human-readable phone string>
```

The response is parsed with the existing YAML parser used for `<candidates>` blocks in deepen. Field validation:
- `hours` — non-empty string after trim
- `website` — must match `/^https?:\/\//i`; on failure, drop the field and log
- `phone` — must contain at least one digit; on failure, drop the field and log

**Why one `chat()` per stop, not one batched call:**
- Matches the geocode pattern (sequential, atomic, resumable)
- Progress UI gets per-stop tick events ("3 of 11 enriched")
- A single bad stop fails locally instead of poisoning the whole batch
- Partial success is the default outcome on real-world data
- Trade-off (~1–3 min total wall-clock per trip) is acceptable for Ambient Background

### Auto-trigger plumbing

`src/lib/server/geocode-job.js` currently calls `completeJob('geocode-candidates', slug, ...)` at the tail of its loop. Add a synchronous `_startEnrichCandidatesJob(slug)` call immediately after that, behind a guard that skips if `enrich-candidates` is already running on the slug. That way:

- Research-driven chain composes correctly: deepen → geocode → enrich (no UI changes needed; user sees three pills in sequence)
- A manual re-run of geocode-candidates also triggers enrich
- The manual Refresh button starts enrich-candidates directly, no geocode replay
- Existing planning trips that pre-date this work are NOT auto-enriched on page load — only an explicit user trigger (Research re-run or Refresh button) starts the chain

### Failure-mode summary

| Mode | Behavior |
|---|---|
| Single stop fails in enrich loop | Log, leave fields empty, continue. Job completes successfully with partial count. |
| All stops fail | `failJob('enrich-candidates', slug, { code: 'ENRICH_ALL_FAILED' })`. Trip frontmatter gets `last_run_error: 'enrich-candidates: ENRICH_ALL_FAILED'`. Existing "last background job failed" banner picks it up. |
| User cancels mid-run | `cancelJob` aborts signal. Partial writes persist. `sweepStaleJobs` marks frontmatter on boot if the cancel wasn't graceful. |
| Concurrent POST during deepen or geocoding | 409, no job started. |
| User-added candidate with no coords | Enrich runs anyway — `chat()` prompt uses destination context to disambiguate. Coords absence is not a gate. |

## Refresh UX

### Where the button lives

A single `↻ Refresh metadata` affordance in the **Candidates section header**, next to the existing Stops / Lodging tab toggles. Not in the `⋯` menu (that's trip-level lifecycle), not on each card (too noisy across 8–15 cards).

### Click behavior

- **Default click** → POST `/api/actions/enrich-candidates/[slug]` with no body. Server-side loop skips candidates that have all three of hours/website/phone. The 95% case: fill gaps.
- **Kebab `⌄` next to the button → "Re-fetch all"** → POST with `{ force: true }`. Ignores the skip guard, re-runs every non-hidden stop. The escape hatch for "this is stale."

The kebab is preferred over shift-click because shift-click isn't discoverable and Traverse doesn't use that idiom anywhere else.

### Button states

| State | Rendering |
|---|---|
| Idle | `↻ Refresh metadata` (with kebab `⌄`) |
| Running (this job) | Disabled; label swaps to `Refreshing 3 of 11…` sourced from the same job-progress channel that drives the global pill |
| Disabled (other job running on this trip) | Disabled outright when `deepen` or `geocode-candidates` is running on the slug. Reuses the `assertNotRunning` pattern; UI disables ahead of the API to avoid error toasts |
| Hidden | Zero candidates on the trip; the action would be a no-op |

### Completed trips

The Candidates section renders read-only on completed trips (per CLAUDE.md). The Refresh button is absent on completed trips. Metadata is frozen at completion. To refresh after the fact, un-complete the trip.

### Plan section

No separate refresh button. Plan is a view over candidates; refreshing candidates updates both surfaces.

### New user-added candidates

User-added stops added after enrichment has run won't auto-enrich. The default-click Refresh path handles them (fills missing fields). Could later add an auto-trigger on add, but YAGNI for v1 — the button is right there.

## Rendering — three surfaces

The data is the same across surfaces; density and link affordances scale with the user's intent at that view.

### Surface 1: Candidates section — `StopCard.svelte`

Cards are dense grid items. One compact **meta row** below the existing summary, rendered only when at least one metadata field is present:

```
┌─────────────────────────────────────────┐
│ [outdoors]                              │
│ Sleeping Bear Dunes National Lakeshore  │
│ Sand dunes on Lake Michigan with        │
│ sweeping overlook climbs. Park-leaning  │
│ trip vibe; aligns with home prefs.      │
│                                         │
│ [📍 Empire, MI] [⏰ 9am–4pm] [🌐 ↗] [☎ ↗] │
└─────────────────────────────────────────┘
```

*Mockup uses emoji glyphs for clarity. Implementation uses the project's existing icon library (confirm during implementation — likely the same one `BackgroundJobsIndicator` and other components already import).*

- **Address** → shown as `City, State` (parse from the structured Nominatim fields we capture). Chip opens a `geo:` URL on mobile, `https://www.google.com/maps/search/?api=1&query=<encoded address>` on desktop, both `target="_blank" rel="noopener"`.
- **Hours** → text only, no link, single line with ellipsis on overflow. `title` attribute carries the full string for native hover tooltip.
- **Website** → globe icon + `↗`. Opens `website` in a new tab.
- **Phone** → phone icon + `↗`. `tel:` link.
- Each chip self-hides when its field is absent. A stop with only `address` shows just that chip, no awkward gaps.

**Accessibility:** icon-only links get `aria-label="Website: <hostname>"`, `"Call <phone>"`, `"Open in maps"` so screen readers announce the target meaningfully.

### Surface 2: Plan section — day-cards

Plan is the in-trip companion view; this is where metadata earns its keep. Per-stop rows currently show position number + name + a brief note. Expand the row into a vertical stack when metadata is present:

```
┌─ Day 3 · Sat Jun 14 · Empire → Traverse City · 42 mi ───────────┐
│                                                                  │
│  ① Sleeping Bear Dunes National Lakeshore       [outdoors] ↑↓   │
│     9922 Front St, Empire, MI 49630                  → Maps     │
│     Visitor Center 9am–4pm daily; park 24/7                     │
│     nps.gov/slbe ↗   (231) 326-4700 ↗                           │
│     Notes: Dune Climb is the must-do; bring water.              │
│                                                                  │
│  ② Lake Michigan overlook — Pierce Stocking Drive   [view] ↑↓   │
│     (no address yet)                                             │
│     Notes: Sunset is the move.                                  │
└──────────────────────────────────────────────────────────────────┘
```

- Always-expanded — phone-in-passenger-seat use case demands zero interaction.
- Address sits on its own line as the most prominent link (large tap target `→ Maps`).
- Hours below address (chronological reading: "where → when → how to reach them").
- Website + phone on the bottom row, smaller, grouped.
- Notes (existing field) stay at the bottom, italicized.
- When the candidate has no metadata yet, the row collapses to its current minimal form — no empty placeholders.

This is the largest single UI piece of work. If it slips it can be carved out, but it's the surface that justifies the milestone name "In-trip companion" and should be held in scope.

### Surface 3: Brochure — `Brochure.svelte` + `derive-brochure.js`

Existing slots `{#if stop.hours}` (line 248) and `{#if stop.address}` (line 271) already render. Two changes needed:

1. **`derive-brochure.js` line ~77** — extend the candidate projection from `{ name, category, description, notes, coords }` to also pass `address`, `hours`, `website`, `phone`. One-line addition per field.
2. **`Brochure.svelte`** — add two new guarded blocks for `website` and `phone` near the existing hours/address slots. Print-optimized: no `↗` chips, no `tel:` / `geo:` links (URLs and phone numbers should print as plain readable text — clickability is meaningless on paper). Same italic-caption styling as `stop.hours`.

The brochure is derived at request time from current candidate state (`deriveBrochure()`), so refreshing metadata also refreshes the brochure on next view. No cache to invalidate.

### Cross-cutting link helper

Three surfaces all need `tel:`, `geo:` / Google Maps, and website `target="_blank"` logic. Extract to a small utility (`src/lib/utils/links.js` or similar) so the logic isn't triplicated. Keep it dumb — no SSR detection, no platform sniffing, just URL constructors.

## Testing

Match existing patterns. The repo's test files document the contracts.

| New / extended test file | Coverage |
|---|---|
| `tests/candidates-io.test.js` (extend) | `readCandidates` / `writeCandidates` round-trip the four new optional fields. Missing fields stay `undefined`, never become empty strings. Existing candidates without the fields still parse. |
| `tests/realize-plan.test.js` (extend) | When the LLM emits the new fields in `<candidates>` YAML, they flow through to disk. When omitted, the candidate object doesn't carry the keys. User-added candidates with pre-existing metadata aren't overwritten by a re-research pass. |
| `tests/geocode-job.test.js` (extend or create) | Mock Nominatim with a structured `address` block. Verify `address` is written alongside `coords`. Verify candidates that already have an `address` aren't clobbered. Verify fallback to `display_name` when the structured block is sparse. |
| `tests/enrich-job.test.js` (new) | Per-stop loop with a mocked `chat()`: writes hours/website/phone; skips candidates that have all three (unless `force: true`); skips `hidden: true`; respects `signal.aborted` mid-loop; continues past a single-stop parse failure; completes with partial-success status; fails through `failJob` when every stop fails. |
| `tests/derive-brochure.test.js` (extend) | New fields project through to the brochure shape. |
| `tests/routes/enrich-candidates.test.js` (new, if the geocode route has a sibling test) | POST starts the job and returns 202. DELETE cancels. Second POST while running returns 409. POST during `deepen` or `geocode-candidates` returns 409. POST with `{ force: true }` overrides the skip guard. |

**`npm run verify`** is the canonical go/no-go (svelte-check + tests + build), per CLAUDE.md.

**`npm run smoke`** is required after this work because it adds a new `chat()` call site with `label: 'enrich-candidates'`.

### Manual verification checklist

CLAUDE.md mandates browser verification for UI changes. Cover at minimum:

- New idea → Research → wait for chain → all three pills (`Researching → Geocoding → Enriching`) appear and resolve
- Candidate cards: meta row renders only chips for present fields; cards with no metadata are unchanged from today
- Plan day-cards: stack layout when metadata is present; collapses to today's form when absent
- Refresh metadata button: default click fills gaps only; kebab "Re-fetch all" forces re-run; disabled while any AI workflow is running on the trip
- Brochure (Cmd-P print preview): all four fields render without link styling
- Completed trip: Candidates section read-only, Refresh button absent
- Cancel mid-enrich from jobs drawer: partial writes persist; trip frontmatter gets `last_run_error: 'interrupted'`
- `tel:` link on mobile actually offers the call dialog; `geo:` URL opens the default maps app

## Open implementation questions

To resolve during the plan or implementation, not before:

1. **Address shape from Nominatim** — verbatim `display_name` (verbose, includes county/country) vs. cleaned `road / city / state / postcode` build-up. *Lean: cleaned, with `display_name` fallback when structured fields are sparse.*
2. **"Re-fetch all" affordance** — kebab `⌄` next to the refresh button vs. shift-click on the button. *Lean: kebab. Shift-click isn't discoverable and Traverse doesn't use it elsewhere.*
3. **Icon library** — quick grep during implementation for `lucide-svelte` / `@heroicons` / inline SVGs in `src/lib/components/`. Inherit the existing pattern, don't add a new dep.
4. **LLM response validation** — log-and-drop bad website/phone strings vs. reject the whole stop. *Lean: log-and-drop the field; the rest of the candidate still wins.*
5. **`PromiseTooltip` seed estimate** for enrich-candidates. *Lean: `est_seconds: 90` for a typical 8–15-stop trip; workflow-stats refines from there.*
6. **No-coords candidates** — gate enrich on coords presence? *Lean: no — pass destination context to the prompt for disambiguation.*
7. **Auto-enrich existing planning trips on first load after deploy?** *Lean: no. Silent token burn surprises users. Manual Refresh is the explicit path; mention in CHANGELOG.*
8. **Plan day-card layout depth** — the rendering in Surface 2 is the largest single UI change. Could carve out to a follow-up if it slips, but it's load-bearing for the "in-trip companion" framing. *Lean: hold in scope.*
9. **Cost framing in CHANGELOG** — Refresh metadata triggers ~8–15 web-search `chat()` calls per click. *Lean: note in CHANGELOG; no in-UI warning (users already understand AI workflows have cost).*

## Files touched (anticipated)

**New:**
- `src/lib/server/enrich-job.js`
- `src/routes/api/actions/enrich-candidates/[slug]/+server.js`
- `src/lib/utils/links.js`
- `tests/enrich-job.test.js`
- `tests/routes/enrich-candidates.test.js` (if pattern matches)

**Modified:**
- `src/lib/server/geocode-job.js` — capture address from Nominatim, auto-trigger enrich on completion
- `src/lib/server/realize-plan.js` — pass through the four new fields from LLM-emitted YAML
- `src/routes/api/actions/deepen/[slug]/+server.js` — extend the `<candidates>` YAML hint in the prompt envelope (the LLM is free to emit hours/website/phone if it already knows them; enrich-candidates is still authoritative)
- `src/lib/components/StopCard.svelte` — meta row
- Plan day-card component(s) under `src/lib/components/` — per-stop stack layout
- `src/lib/components/Brochure.svelte` — add `website` and `phone` guarded blocks
- `src/lib/server/derive-brochure.js` — pass through the four new fields
- `src/lib/components/BackgroundJobsIndicator.svelte` — label for `enrich-candidates` workflow
- `src/lib/errors-registry.js` — `ENRICH_ALL_FAILED` code
- `src/lib/server/promises.js` — register `enrich-candidates` for `PromiseTooltip`
- `tests/candidates-io.test.js`, `tests/realize-plan.test.js`, `tests/geocode-job.test.js`, `tests/derive-brochure.test.js` — extend
- `docs/superpowers/specs/2026-05-22-planning-plan-and-candidates-design.md` — note the four new optional fields in the candidate schema section
- `CHANGELOG.md` — entry for the v0.1.2 ship

## Related issues

- **#382** — geocoding follow-on job pattern. This work follows the same template.
- **#405** — additional export formats. Likely consumers of the new metadata once it lands.
- **#406** — per-stop to-dos and instructions. Future bridge from "the brochure tells you about the trip" to "the app helps you actually do the trip"; per-stop metadata is the foundation it builds on.

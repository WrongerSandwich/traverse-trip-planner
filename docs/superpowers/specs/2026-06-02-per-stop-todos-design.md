# Per-stop to-dos and in-trip instructions (design)

**Date:** 2026-06-02
**Issue:** [#406](https://github.com/WrongerSandwich/traverse-trip-planner/issues/406)
**Milestone:** v0.1.2 In-trip companion
**Status:** Draft — pending plan + implementation

## Problem

[#403](https://github.com/WrongerSandwich/traverse-trip-planner/issues/403) gave each
stop the facts you'd want on a card: hours, address, website, phone. That answers
"what is this place." It does not answer the two questions a traveler actually has
while planning and while standing in the parking lot:

1. **Pre-trip:** what do I have to *do* before I leave so this stop works out?
   (book timed-entry tickets, check seasonal hours, reserve parking, download an
   offline map of the area, bring cash.)
2. **In-trip:** how do I *do* this stop well once I'm there? (which entrance, where
   to park, what to bring, when the light is good, what to skip.)

Today that knowledge exists only diffusely — some of it is buried in the trip-level
`logistics.md` prose, some in `plan.yaml` gotchas, most of it nowhere. Nothing
attaches it to the specific stop it applies to, and nothing lets you check a
pre-trip task off.

This spec defines a two-field expansion of the candidate schema (`tips`, `todos`),
a new follow-on job that populates them from the research Traverse already did, the
persistence + re-research behavior, and how they render across the surfaces a stop
appears on.

## Scope

**In scope (v0.1.2):**
- Extend the candidate schema with two new optional fields on stop entries:
  `tips` (read-only in-trip instructions) and `todos` (checkable pre-trip prep)
- Add a new `stop-prep` Ambient Background job that fills both fields via one
  `chat()` per stop — **no web search**, grounded in the trip-level prose deepen
  already produced
- Wire the auto-trigger so the chain runs after Research with no user action:
  `deepen → geocode-candidates → enrich-candidates → stop-prep`
- Persist to-do completion inline on the stop (`done` flag per item), survive
  re-research
- A manual `Refresh prep` affordance (+ forced "Re-generate all") in the Plan
  section's trip-prep roll-up
- Render in three places: Plan section day-cards, a trip-prep roll-up panel atop
  the Plan section, brochure stop entries

**Out of scope (deferred):**
- Lodging prep — same shape could apply, but stops are the milestone driver
- Promoted-only *generation* — v1 generates for all visible stops (see "Why
  generate for all stops" below); a promoted-only optimization is a later ship
- Web-searched prep — rejected for v1 (see "Why no web search"); revisit only if
  output quality proves insufficient on real trips
- Due-date / reminder semantics on to-dos — they are flat checkable items, not
  scheduled tasks
- Backfill of existing planning trips on first load after deploy — silent token
  burn surprises users; the manual refresh is the explicit path
- Reordering / hand-editing individual to-dos in the UI — generation + check-off
  only for v1; manual edit is a follow-up

## Approach summary

| Layer | Change |
|---|---|
| **Schema** | Two flat optional fields on each stop in `candidates.yaml`: `tips: string[]` and `todos: [{ id, text, done }]` |
| **Sourcing** | New follow-on job `stop-prep`, last in the post-deepen chain. One `chat()` per stop, `modelDefault` slot, **no web_search**. Reads `logistics.md` + plan `gotchas` + `field_guide_notes` once at job start and passes them as shared context to every per-stop call |
| **Persistence** | `done` flag lives on each to-do in `candidates.yaml`. A thin endpoint toggles it. `realizePlan()` preserves `tips` + `todos` (with `done` flags) forward across re-research, mirroring the existing coords-preservation block |
| **Refresh** | `↻ Refresh prep` (fills only stops with no `todos`) + kebab "Re-generate all" (force) in the trip-prep roll-up header. Auto-runs once after the chain; absent on completed trips |
| **Rendering** | Plan day-cards (tips read-only, todos as checkboxes) · trip-prep roll-up panel aggregating todos across promoted stops · brochure (tips as text, todos as printable ☐ boxes). NOT on Candidates browse cards |

## Data model

Two new optional fields on each stop entry in `candidates.yaml`, **flat at the top
level**, consistent with the #403 fields:

```yaml
stops:
  - id: sleeping-bear-dunes
    name: Sleeping Bear Dunes National Lakeshore
    category: outdoors
    description: Sand dunes on Lake Michigan with sweeping overlook climbs.
    why_recommended: Park-leaning trip vibe; aligns with home preferences.
    source_url: https://www.nps.gov/slbe/
    coords: { lat: 44.88, lng: -86.05 }
    address: 9922 Front St, Empire, MI 49630
    hours: "Visitor Center 9am–4pm daily; park 24/7"
    website: https://www.nps.gov/slbe
    phone: "(231) 326-4700"
    tips:                                              # new — written by stop-prep
      - Start at the Dune Climb early; the lot fills by mid-morning in summer.
      - Pierce Stocking Scenic Drive is one-way — do it after the climb, not before.
      - Bring water and real shoes; the sand climb is deceptively strenuous.
    todos:                                             # new — written by stop-prep
      - id: buy-park-pass
        text: Buy an America the Beautiful or Sleeping Bear pass (no on-site booth in shoulder season).
        done: false
      - id: download-offline-map
        text: Download an offline map of the lakeshore — cell coverage drops on the scenic drive.
        done: false
    user_added: false
```

**Field semantics:**

- Both fields are **optional**. A stop with neither stays exactly as it is today —
  no empty arrays written, no placeholder rows.
- `tips: string[]` — a short list of in-trip instructions. Free-form prose, one
  actionable sentence each. **Read-only** everywhere; the model authors them and the
  user does not check them off. Typically 2–5 per stop; the prompt caps the count.
- `todos: [{ id, text, done }]` — checkable pre-trip prep items.
  - `id` — a stable text-slug derived from `text` (reuse `makeCandidateId(text,
    existingIds)` from `candidates.js` so the dedupe + slug logic isn't
    re-implemented), deduped **within the stop**. The id is what the toggle endpoint
    addresses, so it must be stable across reads.
  - `text` — the task, one imperative sentence.
  - `done` — boolean, defaults `false`. This is the *only* mutable bit of prep data;
    everything else is regenerated, `done` is preserved.
  - Typically 0–4 per stop. A stop with nothing to prepare gets an empty/absent
    `todos` — the model is told not to manufacture busywork.

**Why flat, not nested under `prep:`:**
- Matches the existing top-level pattern (`tips` and `todos` sit beside
  `description`, `hours`, `address`)
- Every consumer guards with `{#if stop.todos?.length}`-style checks — one fewer
  indirection
- The candidates parser already passes stop fields through verbatim (#403), so the
  two new arrays round-trip with **no parser change** — only serialization ordering
  and the new mutators touch `candidates.js`

**Schema doc to update:**
`docs/superpowers/specs/2026-05-22-planning-plan-and-candidates-design.md` (the
currently-authoritative candidates spec) — add `tips` and `todos` to the stop
schema section.

## Sourcing — the `stop-prep` job

### Where it sits in the chain

```
deepen → geocode-candidates → enrich-candidates → stop-prep
  ✓             ✓                     ✓               ✓ (new, last)
```

Each leg transitions automatically on completion of the prior, fire-and-forget.
`stop-prep` is the new terminal leg. It is independently cancellable from the jobs
drawer and independently re-runnable. It is Ambient Background per
`docs/ai-workflow-ux.md`. The user sees a fourth pill in sequence after the existing
three (`Researching → Geocoding → Enriching → Prepping`).

It runs **last** deliberately: by the time it runs, each stop already has its
`address` (from geocode) and `hours`/`website`/`phone` (from enrich), so the prep
prompt can reference concrete facts ("hours are X, so the to-do is 'arrive before
X'") instead of guessing.

### Why no web search

The deepen pass already web-searched the destination and wrote its findings into
trip-level prose: `logistics.md` carries booking timelines, cash needs, offline-map
warnings, restaurant-hours caveats; `plan.yaml`'s `gotchas` and `field_guide_notes`
carry seasonal closures and timing facts. enrich-candidates then web-searched each
stop's hours/website/phone. **The prep-relevant facts already exist in the trip.**

`stop-prep` is therefore a *redistribute-and-concretize* pass, not a fresh-discovery
pass: it pulls trip-level findings down onto the specific stop they apply to and
layers the model's parametric knowledge of named, well-known places on top. Skipping
web search saves ~8–15 search round-trips per trip and keeps the job fast and cheap.

**The grounding refinement (load-bearing):** the job reads three trip-level sources
**once at job start** and passes them as shared context in *every* per-stop call:

1. `logistics.md` — full prose body (booking timelines, cash, connectivity, etc.)
2. `plan.yaml` → `gotchas` (array of strings)
3. `plan.yaml` → `field_guide_notes` (array of strings)

Without this, prep quality degrades to generic ("bring water, check hours"). With
it, the model can write "download an offline map — logistics note says cell coverage
drops past Empire" — stop-specific, grounded, non-obvious. This was the explicit
design decision: keep no-web-search **and** feed trip prose as shared context.

The prompt also instructs the model to **only emit genuinely stop-specific items**
and **not echo trip-wide notes already on the brochure** — the roll-up would be
noise if every stop repeated "bring cash."

### New files

- `src/lib/server/stop-prep-job.js` — the job loop, mirrors
  `src/lib/server/enrich-job.js` closely
- `src/routes/api/actions/stop-prep/[slug]/+server.js` — POST starts, DELETE
  cancels; mirrors
  `src/routes/api/actions/enrich-candidates/[slug]/+server.js` exactly, including
  the exported `_startStopPrepJob(slug, opts)` kickoff helper

### New constants

- Job workflow id: `'stop-prep'`
- Error code: `stop_prep_all_failed` in `src/lib/errors-registry.js`
- `chat()` label: `'stop-prep'` (so `workflow-stats.json` accumulates a p50 for
  `PromiseTooltip`)
- `FEATURE_SLOT['stop-prep'] = 'modelDefault'` in `src/lib/server/config.js` —
  **not** added to the `searchDependent` set (line ~148), because the job makes no
  search call. This is the one deliberate divergence from the enrich template, whose
  feature *is* search-dependent.
- `HAND_DEFAULTS['stop-prep']` + `MAX_TOKENS['stop-prep']` in
  `src/lib/server/promises.js`
- `BackgroundJobsIndicator.svelte`: `WORKFLOW_LABELS['stop-prep'] = 'Prep'` and
  `ESTIMATES_S['stop-prep'] = 60`

### Job loop (`stop-prep-job.js`)

Mirrors `enrich-job.js`. Reproduced concretely so the plan doesn't have to
reverse-engineer it:

1. **Once, at job start:** read the trip-level grounding context:
   - `logistics.md` body via the existing section reader (empty string if absent)
   - `plan.yaml` `gotchas` and `field_guide_notes` via the existing plan reader
     (empty arrays if absent)
   Build a single `tripContext` string used in every per-stop prompt.
2. Build the work list from the *visible* (non-`hidden`) stops in the current
   `candidates.yaml`.
3. For each stop, in sequence:
   - Check `signal?.aborted` at the top of the iteration; bail if set.
   - **Skip** the stop if it already has a non-empty `tips` array **unless**
     `force === true`. (`tips` presence is the "this stop was prepped" marker — the
     resumability + idempotency guard, same role as enrich's "skip if all three
     set". `tips` rather than `todos` because a prepped stop almost always yields
     tips, whereas a stop with nothing to prepare legitimately yields zero `todos`;
     see "Empty-prep marker" below.)
   - One `chat()` call: `{ label: 'stop-prep', ...getEffectiveConfig().features['stop-prep'] }`,
     **no search tool wired in**, prompt = system + per-stop user message (below).
   - Parse the `<prep>` YAML block from the response with the same YAML parser
     deepen uses for `<candidates>`.
   - Validate (see "Validation"); coerce to the schema shape; assign stable `id`s to
     each to-do via `makeCandidateId`.
   - **Re-read** `candidates.yaml` from disk, splice the new `tips`/`todos` onto the
     matching stop by `id`, and `writeCandidates(slug, fresh)` atomically. (Re-read
     before write so a concurrent user edit elsewhere in the file isn't clobbered —
     same pattern as enrich.)
   - On per-stop failure (parse error, validation reject, chat throw that isn't an
     abort): log, leave the stop untouched, continue.
4. On loop exit:
   - At least one stop prepped (or all no-op skipped) →
     `completeJob('stop-prep', slug, { tokens })` with a status message like
     `"Prepped 9 of 11 stops"`.
   - Every *attempted* stop failed (`attempted > 0 && prepped === 0 && failed > 0`)
     → throw `stop_prep_all_failed` `TraverseError`; the endpoint's failure tail
     calls `failJob`.
   - Aborted → the IIFE's `isAbort(err)` check returns early; `cancelJob` owns the
     failure event; `sweepStaleJobs()` handles a hard interrupt on next boot.

**Empty-prep marker:** a stop the model judges to need *zero* to-dos still must be
distinguishable from a never-prepped stop, or the skip guard re-runs it forever.
That's why `tips` (not `todos`) is the marker the skip guard checks: a prepped stop
almost always produces tips, whereas a genuinely no-prep stop produces `todos: []`
(or absent). A prepped stop with no real prep tasks therefore gets `tips: [...]` and
no `todos` — still distinguishable from never-prepped. The only case where a prepped
stop has neither is "model returned nothing usable," which the Validation section
deliberately treats as a per-stop **failure** so the stop isn't marked prepped.

### Per-stop prompt envelope (concrete shape, refine in implementation)

```
System: You help a road-tripper prepare for a specific stop on a trip they've
already researched. You will be given trip-wide context (logistics notes, gotchas,
field-guide notes) and one stop. Produce:
  - tips: 2–5 short in-trip instructions specific to THIS stop (best entrance,
    where to park, what to bring, light timing, what to skip). One sentence each.
  - todos: 0–4 pre-trip tasks the traveler must DO before leaving for this stop to
    work out (book tickets, check seasonal hours, reserve parking, download offline
    map, bring cash). One imperative sentence each. Omit the list if there's nothing
    genuine to prepare — do not invent busywork.
Rules: Only emit items SPECIFIC to this stop. Do NOT repeat trip-wide notes the
traveler already has (they're on the brochure). Ground items in the provided context
and the known character of the named place. Do not invent facts you're unsure of —
prefer fewer, real items over many generic ones.

User: Trip: <destination>
      Trip context:
      <tripContext: logistics.md body + gotchas + field_guide_notes>
      ---
      Stop: <stop.name> (<stop.category>)
      <stop.description>
      Address: <stop.address if present>
      Hours: <stop.hours if present>

Respond with YAML only:
<prep>
tips:
  - <string>
todos:
  - <string>     # plain strings; the job assigns ids and done:false
</prep>
```

The job receives `todos` as plain strings from the model and wraps each into
`{ id: makeCandidateId(text, seen), text, done: false }`. The model never sees or
sets `id`/`done` — those are server-owned.

### Validation

- `tips` — array; keep entries that are non-empty strings after trim; drop the rest.
  Cap at 5 (truncate extras).
- `todos` — array; for each, require a non-empty `text` string after trim; assign a
  stable `id` (dedupe within the stop); `done: false`. Drop malformed entries. Cap
  at 4.
- If both end up empty after validation, still write `tips: []`? No — write a
  minimal non-empty `tips` only if the model produced one; if the model produced
  literally nothing usable, treat the stop as a per-stop **failure** (so it isn't
  marked prepped and a later non-forced re-run retries it). This keeps the skip
  marker honest.

### Auto-trigger plumbing

`src/routes/api/actions/enrich-candidates/[slug]/+server.js` is where the chain's
prior leg completes. In the enrich kickoff's completion tail (the
`completeJob('enrich-candidates', …)` path inside `_startEnrichCandidatesJob`'s
async IIFE), add a synchronous `_startStopPrepJob(slug)` call, behind the same
already-running guard the chain uses elsewhere (skip if `stop-prep` is already
running on the slug). That gives:

- Research-driven chain composes: deepen → geocode → enrich → prep, no UI changes
  beyond the new pill label
- A manual re-run of enrich-candidates also triggers prep afterward
- The manual `Refresh prep` button starts `stop-prep` directly, no chain replay
- Existing planning trips that pre-date this work are **not** auto-prepped on page
  load — only an explicit trigger (Research re-run or Refresh prep) starts it

### Failure-mode summary

| Mode | Behavior |
|---|---|
| Single stop fails in prep loop | Log, leave stop untouched, continue. Job completes with partial count. |
| Model returns nothing usable for a stop | Counts as a per-stop failure; stop stays un-prepped so a non-forced re-run retries it. |
| All stops fail | `failJob('stop-prep', slug, { code: 'stop_prep_all_failed' })`. Frontmatter gets `last_run_error`; existing failure banner picks it up. |
| User cancels mid-run | `cancelJob` aborts the signal. Partial writes persist. `sweepStaleJobs` marks frontmatter on a hard interrupt. |
| Concurrent POST during deepen / geocode / enrich / stop-prep | 409, no job started. |
| Re-research while prep exists | `realizePlan` preserves `tips` + `todos` (with `done`) forward; non-forced prep re-run skips already-prepped stops, so check-offs survive. |

## Persistence & re-research

### Toggling a to-do

`done` is the only user-mutable prep field. Two pieces:

1. **`candidates.js` mutator** — `setTodoDone(slug, stopId, todoId, done)`:
   - Read candidates, find the stop by `id`, find the to-do by `id`, set `done`,
     `writeCandidates` atomically. Returns the updated stop (or throws a typed error
     if stop/to-do not found).
   - Mirrors the existing `setCandidateHidden(slug, id, hidden)` shape in
     `candidates.js`.
2. **Endpoint** — a thin route under the existing candidates-mutation convention:
   `PATCH /api/candidates/[slug]/stops/[id]/todos/[todoId]` with body
   `{ done: boolean }`. Mirrors the existing per-stop candidate endpoints under
   `src/routes/api/candidates/[slug]/stops/[id]/`. Validates slug + ids, calls
   `setTodoDone`, returns the updated stop (or 404). No rate-limit needed (no AI, no
   external call — it's a local file patch like hide/un-hide).

### Surviving re-research (`realize-plan.js`)

`realizePlan()` already preserves prior `coords` onto a fresh same-`id` candidate
when re-research regenerates `candidates.yaml` (the coords-preservation block).
Extend that same block to also carry forward `tips` and `todos` (including each
to-do's `done` flag) from the prior candidate onto the fresh same-`id` candidate.

- Match by stop `id` (same key coords uses).
- Carry `tips` and `todos` verbatim from the prior version — deepen does not produce
  them, so without this they'd be wiped on every re-research.
- A *forced* `stop-prep` re-run (kebab "Re-generate all") is the explicit path to
  discard and regenerate; ordinary re-research must not silently lose a user's
  check-offs.

This is the direct analog of the #403 precedent and the coords precedent: user/job
state that deepen doesn't author is preserved across re-research by `id`.

## Refresh UX

### Where it lives

The refresh affordance lives in the **trip-prep roll-up header** in the Plan section
(see Surface 2), not on each card and not in the trip-level `⋯` menu. Prep is a
Plan-section concern (it's about *doing* the trip), so the control sits with the
roll-up that summarizes it.

### Click behavior

- **`↻ Refresh prep`** → POST `/api/actions/stop-prep/[slug]` with no body. Server
  loop skips stops that already have `tips`. The 95% case: prep stops added since the
  last run.
- **Kebab `⌄` → "Re-generate all"** → POST with `{ force: true }`. Ignores the skip
  guard, regenerates every visible stop. The escape hatch for "this prep is stale /
  I edited the plan a lot." Forced regeneration **does** discard existing `tips`
  /`todos` for re-generated stops, including `done` flags — it's the explicit
  "start over" path, called out in the confirm copy.

### Button states

| State | Rendering |
|---|---|
| Idle | `↻ Refresh prep` (with kebab `⌄`) |
| Running (this job) | Disabled; label swaps to `Prepping 3 of 11…` from the job-progress channel that drives the global pill |
| Disabled (other job running) | Disabled when `deepen` / `geocode-candidates` / `enrich-candidates` / `stop-prep` is running on the slug. UI disables ahead of the API to avoid error toasts |
| Hidden | Zero visible stops, or the trip is completed |

### Completed trips

Plan renders read-only on completed trips (per CLAUDE.md). The Refresh prep control
is absent; to-do checkboxes render **static** (checked/unchecked, not interactive).
Prep is frozen at completion.

## Rendering — three surfaces

### Why generate for all stops (not promoted-only)

At the moment Research completes, `plan.yaml` `days` is typically empty — the user
builds days *afterward* by promoting candidates. A promoted-only generation filter
would make the auto-chain produce nothing, defeating the "it's just there after
research" goal. So the job **generates for all visible stops**, consistent with
geocode and enrich. *Display* is promoted-only in the roll-up (below) — you only see
prep for stops you've actually committed to a day. Promoted-only generation is noted
as a deferred cost optimization in Scope.

### Surface 1: Plan section day-cards — `StopCard.svelte` (compact mode)

`StopCard` in `compact` mode is the per-stop row inside a Plan day-card. It already
renders the #403 meta-stack (address/hours/website/phone). Add, below that:

- **Tips** — a small read-only list (bulleted), rendered only when
  `stop.tips?.length`. Muted/italic styling consistent with the existing notes line.
  No interaction.
- **To-dos** — a checkbox list rendered only when `stop.todos?.length`. Each row is
  a checkbox + label.
  - **Planning trip:** interactive. Toggling fires the PATCH endpoint
    (optimistic update, revert on failure via the standard error path). Checked
    items get strikethrough/muted styling.
  - **Completed trip:** static — render the box in its `done` state, no handler.

```
┌─ Day 3 · Sat Jun 14 · Empire → Traverse City · 42 mi ───────────┐
│  ① Sleeping Bear Dunes National Lakeshore       [outdoors] ↑↓    │
│     9922 Front St, Empire, MI 49630                  → Maps      │
│     Visitor Center 9am–4pm daily; park 24/7                     │
│     nps.gov/slbe ↗   (231) 326-4700 ↗                           │
│     Tips:                                                        │
│       • Start at the Dune Climb early; the lot fills by mid-AM. │
│       • Scenic drive is one-way — do it after the climb.        │
│     Prep:                                                        │
│       ☑ Buy a park pass (no shoulder-season booth)              │
│       ☐ Download an offline map of the lakeshore               │
│     Notes: Dune Climb is the must-do; bring water.              │
└──────────────────────────────────────────────────────────────────┘
```

When the stop has neither `tips` nor `todos`, the row is unchanged from today — no
empty "Tips:" / "Prep:" headers.

### Surface 2: Trip-prep roll-up panel (atop the Plan section)

A single panel rendered above the day list in the Plan section, aggregating the
**to-dos of promoted stops only** (stops actually placed on a day) into one
pre-trip checklist, grouped by stop. It answers "what do I still have to do before
this trip" in one place.

- Header: `Trip prep` + a progress count `X of Y done` (counts checkable to-dos
  across promoted stops) + the `↻ Refresh prep` control (with kebab) described above.
- Body: grouped by stop (stop name as a subheading), each to-do a checkbox bound to
  the same PATCH endpoint as the day-card checkboxes — checking in one place updates
  the other (shared state).
- **Hidden entirely** when no promoted stop has any to-do (e.g. before prep has run,
  or a trip genuinely needs no prep). No empty panel.
- **Completed trips:** the panel renders read-only (static checkboxes, no refresh
  control) — a frozen record of what was prepped.

Tips are **not** aggregated into the roll-up — they're in-trip instructions, not a
checklist, and belong next to the stop in the day-card. The roll-up is to-dos only.

### Surface 3: Brochure — `Brochure.svelte` + `derive-brochure.js`

The brochure is print-optimized and derived at request time from current candidate
state — no cache to invalidate.

1. **`derive-brochure.js`** — extend the per-stop projection to also pass `tips` and
   `todos` through. (The projection currently whitelists fields; add the two arrays.)
2. **`Brochure.svelte`** — add two guarded blocks in the stop entry:
   - `tips` → a plain bulleted list under the stop, same caption styling as the
     existing hours/notes lines. No interactivity.
   - `todos` → a printable checklist: each item prefixed with a ☐ glyph (an empty
     box you can pen-check on paper). Render the box per the to-do's `done` state on
     a completed trip's brochure (☑ for done), or always-empty ☐ on a planning
     brochure (it's a take-with-you checklist). No `tel:`/link chrome — print plain.

### NOT on Candidates browse cards

`StopCard` in its **non-compact** (Candidates browse) mode does **not** render tips
or todos. The Candidates section is "what could this stop be" (browse + promote);
prep is "how do I do this stop" and belongs in the Plan view where you've committed
the stop to a day. Keeping prep out of the browse grid avoids 8–15 noisy cards and
keeps the two mental modes distinct.

## Testing

Match existing patterns. The repo's test files document the contracts.

| New / extended test file | Coverage |
|---|---|
| `tests/candidates-io.test.js` (extend) | `readCandidates` / `writeCandidates` round-trip `tips` and `todos` (with `done` flags). Missing fields stay absent. Existing candidates without the fields still parse. `setTodoDone` flips the flag, returns the stop, and throws on unknown stop/to-do id. |
| `tests/realize-plan.test.js` (extend) | Prior `tips`/`todos` (with `done: true`) on a stop are carried forward onto the fresh same-`id` candidate after a re-research pass; a stop whose `id` disappears drops them; deepen-only output (no prep) doesn't fabricate the fields. |
| `tests/stop-prep-job.test.js` (new) | Per-stop loop with a mocked `chat()`: writes `tips`/`todos`; assigns stable deduped ids; defaults `done:false`; skips stops that already have `tips` (unless `force:true`); skips `hidden:true`; respects `signal.aborted` mid-loop; continues past a single-stop parse failure; completes with partial status; throws `stop_prep_all_failed` when every stop fails. Asserts the trip-context (logistics + gotchas + field_guide_notes) is read once and present in the per-stop prompt. Asserts **no search tool** is passed to `chat()`. |
| `tests/routes/stop-prep.test.js` (new, if enrich route has a sibling test) | POST starts the job → 202; DELETE cancels; second POST while running → 409; POST during deepen/geocode/enrich → 409; `{ force: true }` overrides the skip guard. |
| `tests/routes/candidates-todos.test.js` (new, or extend the candidates-route test) | PATCH toggles `done`; unknown stop/to-do id → 404; invalid slug → rejected. |
| `tests/derive-brochure.test.js` (extend) | `tips` and `todos` project through to the brochure shape; absent when the stop has none. |

**`npm run verify`** is the canonical go/no-go (svelte-check `--fail-on-warnings` +
tests + build), per CLAUDE.md.

**`npm run smoke`** is required after this work — it adds a new `chat()` call site
with `label: 'stop-prep'`.

### Manual verification checklist

CLAUDE.md mandates browser verification for UI changes. Cover at minimum:

- New idea → Research → wait for chain → all four pills
  (`Researching → Geocoding → Enriching → Prepping`) appear and resolve
- Promote a few stops to days → trip-prep roll-up appears with aggregated to-dos and
  an `X of Y done` count
- Check a to-do in the day-card → the roll-up count updates (shared state); reload →
  the `done` state persisted to disk
- `↻ Refresh prep` default click preps only stops without tips; kebab "Re-generate
  all" regenerates everything (with a confirm that warns it discards check-offs)
- Re-run Research on the trip → existing check-offs survive (preserve-forward works)
- Brochure (Cmd-P print preview): tips render as text, todos as printable ☐ boxes,
  no link chrome
- Completed trip: Plan read-only, checkboxes static, no Refresh prep control,
  roll-up read-only
- Cancel mid-prep from the jobs drawer: partial writes persist; frontmatter gets
  `last_run_error: 'interrupted'`
- A stop with no genuine prep shows no "Tips:"/"Prep:" rows (no manufactured
  busywork)

## Open implementation questions

To resolve during the plan or implementation, not before:

1. **To-do id stability across re-generation** — `makeCandidateId(text, seen)`
   gives a text-derived slug, so editing the model's wording changes the id. That's
   acceptable: a forced regenerate is a "start over." But confirm the
   preserve-forward block keys on `id` (not array index) so an *unforced* re-research
   matches reliably. *Lean: key on `id`; identical text → identical id → match.*
2. **`tips` as the skip marker vs. a dedicated flag** — using `tips` presence as
   "this stop was prepped" is implicit. Alternative: a `prepped: true` boolean.
   *Lean: `tips` presence — one fewer field, and a prepped stop essentially always
   has tips. Revisit if a stop legitimately yields zero tips.*
3. **PATCH vs. POST for the to-do toggle** — REST-leaning PATCH on the nested
   resource vs. a POST action. *Lean: PATCH on
   `/api/candidates/[slug]/stops/[id]/todos/[todoId]`, matching the resource-y
   candidate routes.*
4. **Roll-up grouping** — by stop (chosen) vs. by day vs. flat. *Lean: by stop;
   it's how prep maps to reality and matches the day-card source.*
5. **`HAND_DEFAULTS['stop-prep']` seed estimate** — `time_seconds`. *Lean: 60 for a
   typical 8–15-stop trip, no search so faster than enrich's 90; workflow-stats
   refines.* `MAX_TOKENS['stop-prep']`: *Lean: 1500 (tight per-stop output).*
6. **Forced-regenerate confirm copy** — it discards `done` flags. *Lean: a one-line
   `ConfirmModal` ("Re-generate all prep? This clears your check-offs.").*
7. **Brochure todos on a planning trip** — always-empty ☐ (take-with-you list) vs.
   reflect current `done`. *Lean: always-empty ☐ on planning brochure (it's a
   to-take checklist); reflect `done` on a completed-trip brochure (record).*

## Files touched (anticipated)

**New:**
- `src/lib/server/stop-prep-job.js`
- `src/routes/api/actions/stop-prep/[slug]/+server.js`
- `src/routes/api/candidates/[slug]/stops/[id]/todos/[todoId]/+server.js` (toggle)
- `tests/stop-prep-job.test.js`
- `tests/routes/stop-prep.test.js` (if pattern matches)
- `tests/routes/candidates-todos.test.js` (or fold into existing candidates-route test)

**Modified:**
- `src/lib/server/candidates.js` — `setTodoDone` mutator; serialization ordering for
  `tips`/`todos`
- `src/lib/server/realize-plan.js` — preserve `tips`/`todos` (with `done`) forward by
  `id`, alongside the coords-preservation block
- `src/routes/api/actions/enrich-candidates/[slug]/+server.js` — auto-trigger
  `_startStopPrepJob(slug)` in the completion tail
- `src/lib/components/StopCard.svelte` — tips list + todos checkboxes in compact mode
- Plan section component(s) under `src/lib/components/` — trip-prep roll-up panel
- `src/lib/components/Brochure.svelte` — `tips` + `todos` guarded blocks
- `src/lib/server/derive-brochure.js` — project `tips`/`todos` through
- `src/lib/components/BackgroundJobsIndicator.svelte` — `stop-prep` label + estimate
- `src/lib/errors-registry.js` — `stop_prep_all_failed` code
- `src/lib/server/promises.js` — `HAND_DEFAULTS` + `MAX_TOKENS` for `stop-prep`
- `src/lib/server/config.js` — `FEATURE_SLOT['stop-prep'] = 'modelDefault'` (not
  search-dependent)
- `tests/candidates-io.test.js`, `tests/realize-plan.test.js`,
  `tests/derive-brochure.test.js` — extend
- `docs/superpowers/specs/2026-05-22-planning-plan-and-candidates-design.md` — add
  `tips`/`todos` to the candidate stop schema
- `CHANGELOG.md` — entry for the v0.1.2 ship

## Related issues

- **#403** — per-stop metadata (hours/address/website/phone). Direct predecessor;
  this reuses its schema-extension, job-template, and preserve-forward patterns and
  builds prep on top of the facts it supplies.
- **#382** — geocoding follow-on job pattern. The chain template `stop-prep` extends.
- **#405** — export formats. Likely consumer of prep data (a printable/exportable
  pre-trip checklist).

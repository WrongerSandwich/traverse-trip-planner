# In-trip capture — mark stops visited/skipped + jot notes, feeding the retro (#444)

**Milestone:** v0.1.3 Offline support
**Status:** Design approved, ready for implementation plan
**Date:** 2026-06-08

## Problem

Today, capture only happens **after** a trip: the Mark-as-completed retro modal
asks its questions days or weeks later, and the model writes `notes.md` from cold
recollection. The richest material — which stop you bailed on, the better lunch
you found, "light was perfect at 7am" — is lost by then. This feature lets you
record it **during** the trip, against the day you're actually living, and have
that material seed the retro instead of a blank page.

## Scope

**In scope (v0.1.3):**
- Per-stop **visited / skipped** status and a per-stop **note**.
- A per-day freeform **note**.
- Capture affordances on the live **Today view** (#469).
- Captured material **feeds the retro**: grounds the AI prompt and is preserved
  verbatim in `notes.md`.

**Out of scope (deferred):**
- Live re-planning / mutating the itinerary. Capture is **append-only, human
  authored** — it records what happened; it never reorders or removes plan stops.
- Offline capture. See "Connectivity" below.
- Receipts / expense capture (separate, disabled — #367).

## Connectivity: online-only

Capture is the one in-trip action that **writes**. #443 shipped a **read-only**
offline bundle with **no service worker and no write queue** (the PWA path is
deferred, TLS-gated). So capture is **online-only**: it writes live to the home
server and works whenever that server is reachable (e.g. evening back at the
lodging on Wi-Fi), not from a dead-zone trailhead. The offline bundle stays
read-only and grows **no** capture controls. This is acceptable: jotting the same
evening still beats reconstructing weeks later, and it honors #443's decision
rather than reopening it.

## Data model (piggyback on existing files; separate overlay)

Capture state lives **with its subject**, reusing the existing `todos`
mutable-state precedent rather than introducing a new file.

- **Candidate stop** (`candidates.yaml`) gains two optional fields:
  - `status: visited | skipped` — absent means unmarked. A pure **overlay**: it
    never removes the stop from a day or re-plans (resolves the ticket's
    "same axis as promotion?" question — it is a *separate* axis).
  - `note: <string>` — the in-trip jotting for that stop.
- **Plan day** (`plan.yaml`) gains:
  - `log: <string>` — the per-day freeform note, kept **distinct from** the
    existing `notes` field (which is the research-authored plan note). `notes` =
    intent; `log` = what happened.
- **Preservation across re-research:** `realizePlan()`
  (`src/lib/server/realize-plan.js`) must carry `status` / `note` / `log` through
  when a deepen re-run merges with existing candidates/plan — capture is never
  wiped by re-research. (The merge already preserves user-added candidates; this
  extends that guarantee to these fields.)

These fields are ignored by the print brochure (intent-only); they surface only
on the Today view and in the retro hand-off.

## Write path (online-only, Instant Inline)

A new **`capture` API namespace**, mirroring the existing
`PATCH /api/candidates/[slug]/stops/[id]/todos/[todoId]` (`setTodoDone`) pattern:

- `PATCH /api/capture/[slug]/stops/[id]` — body `{ status?, note? }`.
  Read candidates → mutate the stop (set/clear `status`, set `note`) →
  `writeCandidates()` (atomic) → `invalidateEnrichCache()` → return the updated
  stop.
- `PATCH /api/capture/[slug]/days/[number]` — body `{ note }`.
  Read plan → set `day.log` → `writePlan()` (atomic) → invalidate → return ok.

Conventions:
- Guards: `rejectInvalidSlug`; 404 on missing stop/day; operates on **planning**
  trips only — capture is the in-trip window, and this matches the codebase's
  read-only-on-completed convention for all editing. A completed trip returns
  `wrong_stage`. (The captured fields still travel into `completed/` with the
  folder move, where the retro *reads* them.) Typed failures map to
  `ERROR_REGISTRY` codes (`src/lib/errors-registry.js`) — no inline catch
  sentences.
- `status` accepts `"visited"`, `"skipped"`, or `null` (clear). Any other value →
  `invalid_input`.
- `note` / `log` capped at 2000 characters → `invalid_input` when exceeded.
- Last-write-wins via atomic write (same concurrency model as `todos.done`) —
  acceptable for the single-user, self-hosted deployment.

**UX archetype = Instant Inline** ([`docs/ai-workflow-ux.md`](../../ai-workflow-ux.md)):
no AI, sub-second. Toggles apply optimistically and reconcile on the response;
the note textarea saves on blur. No background job, no pill.

## Read path & capture UX

- `deriveBrochure()` (`src/lib/server/derive-brochure.js`) projects `status` +
  `note` per stop and `log` per day; the Today loader
  (`src/routes/trips/[slug]/today/+page.server.js`) passes them through (after the
  existing coord normalization).
- **`TodayStopCard.svelte`** gains a **dedicated capture row** below the action
  buttons:
  - Segmented **Visited / Skip** toggles — mutually exclusive, tapping the active
    one clears it. One tap = one `PATCH` (optimistic).
  - An **✎ Add a note** affordance that expands an inline `<textarea>` pre-filled
    with any existing `note`; saves on blur.
  - The card reflects current status subtly: visited = check accent / slight dim,
    skipped = strikethrough name / dim. Status styling must not fight the
    category color system.
- **Per-day note:** a small expandable **"Day notes"** field at the end of the
  day's content (after the stops / lodging), bound to `day.log`, same
  save-on-blur behavior via the day endpoint.
- The Today view becomes **interactive** (client `fetch` for the PATCHes). This is
  a progressive enhancement over the current read-only page; the existing
  `?day=N` GET day-picker keeps working without JS, capture controls require JS.
- **Completed trips:** the Today view renders captured `status` / `note` / `log`
  **read-only** (no capture row, no Day-notes input), consistent with completed
  trips being read-only everywhere else. Capture is created during planning and
  simply displayed afterward.

**Offline bundle** (`renderOfflineToday`, from #443): renders captured `status`
and `note` **read-only** when present (they are already in the derived data) — a
small addition (a status marker + the note text), **no controls**. Keeps the
downloaded snapshot faithful to what you'd captured at generation time without
reintroducing a write path. *(Separable; can be dropped to trim scope.)*

## Retro hand-off (ground the AI + preserve verbatim)

When the trip is marked completed, `candidates.yaml` / `plan.yaml` (carrying
capture) travel to `completed/` via the existing atomic folder move. The retro
handlers (`src/routes/api/actions/retro/[slug]/+server.js`) then use the capture:

1. **Ground the AI.** Both the **question-generation (POST)** and
   **notes-writing (PUT)** handlers assemble an **"In-trip capture" context
   block** — each stop's `visited`/`skipped` status and `note`, and each day's
   `log` — and inject it into the `chat()` prompt. Questions lean toward what was
   actually done/skipped; the generated prose is grounded in real notes.
2. **Preserve verbatim.** The PUT handler also writes an **`## In-trip notes`**
   section into `notes.md` (via the `appendToNotes()` / receipts section pattern)
   containing the **raw** jottings — per-day `log` and per-stop `note`, attributed
   to their stop/day — so the user's exact words survive regardless of AI
   paraphrase.

Resulting `notes.md` = AI prose (+ `## Highlights`, lifted to frontmatter as
today) followed by `## In-trip notes` (verbatim). When nothing was captured, the
context block and the verbatim section are both omitted — the retro behaves
exactly as it does today.

## Testing

- **Capture IO** (`tests/`): set/clear `status`, set `note` on a candidate stop;
  set `log` on a plan day; round-trips through `writeCandidates`/`writePlan`.
- **`realizePlan` preservation:** a deepen re-run merge keeps existing
  `status`/`note`/`log`.
- **`deriveBrochure` passthrough:** `status`/`note`/`log` reach the projected
  shape.
- **Endpoints:** `PATCH` stop/day — happy path, `invalid_input` (bad status,
  over-length note), 404 (missing stop/day), atomic write + cache invalidation.
- **Retro context:** the assembled prompt includes the capture block; the PUT
  writes `## In-trip notes` verbatim; both omitted when capture is empty.
- **Component:** `TodayStopCard` renders the capture row and applies the optimistic
  status toggle.

## Edge cases

- **Clear status:** tapping the active toggle sets `status` back to absent.
- **Skipped stop still renders** in the day (overlay only; not removed).
- **Empty capture:** no `## In-trip notes` section, empty retro context block —
  retro is unchanged from today.
- **Stop deleted after capture:** `status`/`note` live on the candidate and are
  removed with it; no dangling state.
- **Re-research after capture:** preserved (see Data model).
- **Note length** over the cap is rejected, not truncated.

## Manual QA pass

Playwright-MCP checklist (see `docs/manual-qa.md`), seeded trip, phone viewport:
- [ ] Today stop card shows the capture row (Visited / Skip + ✎ Add a note).
- [ ] Tapping **Visited** marks the stop (optimistic); reload persists it; tapping
      again clears it. Same for **Skip** (mutually exclusive with Visited).
- [ ] Jot a **stop note** and a **Day note**; reload → both persist.
- [ ] Skipped stop still appears in the day, visibly de-emphasized.
- [ ] Re-download the offline bundle → captured status + notes appear **read-only**
      (no controls).
- [ ] Mark the trip completed → retro questions reflect what was done/skipped, and
      `notes.md` contains an `## In-trip notes` section with the verbatim jottings.

Exploratory coverage of the live capture write/read loop; not a regression net.

## Decisions (locked)

- Online-only capture (offline write-queue/PWA stays deferred, per #443).
- Visited/skipped is a separate status **overlay**, never mutating the plan.
- Storage piggybacks existing files: stop `status`/`note` on `candidates.yaml`,
  day `log` on `plan.yaml` (distinct from `notes`).
- Retro hand-off both grounds the AI prompt and preserves jottings verbatim under
  `## In-trip notes`.
- Capture UX = a dedicated, always-visible capture row on the Today stop card.
- Offline bundle shows captured state read-only (separable; droppable to trim).

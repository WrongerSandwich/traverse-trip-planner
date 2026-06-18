# Reactive shaping bench — direct-manipulation Candidates + Plan (design)

**Status:** approved (2026-06-17)
**Issue:** #404 — "Revisit Candidates + Plan UX for direct, reactive trip-shaping" (milestone: v0.1.5 Planning craft)
**Primary components:** new `ShapingBench.svelte` wrapper; `PlanSection.svelte`, `CandidatesSection.svelte`, `TripMap.svelte` (candidates mode); `src/routes/trips/[slug]/+page.svelte` (planning composition only)
**Reuses (no contract change):** `POST /api/plan/[slug]/promote`, `POST /api/plan/[slug]/move-stop`, `PUT /api/plan/[slug]/day/[number]/stops` (`reorderStops`), `POST /api/plan/[slug]/un-promote`

## Problem

The Candidates + Plan surface works but feels like list management, not trip-shaping.
Promotion is a "pick a target day" modal; reordering is ↑↓ arrows; moving a stop between
days is limited; and the map updates only *after* an action settles (server round-trip +
reload), never reactively. `PRODUCT.md`'s principle is "the map is the interface" — but
for the actual user, **the map is the *output* of planning (a visualization that confirms
what's been decided), not the *input* (the surface where decisions are made).** Planning
happens in lists/text; the map grounds and confirms it.

The fix is to make the lists *reactive* — direct manipulation (drag) as the fast path,
the map updating live as a confirmation surface — without making the map an input device.

## Guiding principle

**Lists are the spine; the map is a live visualization, never an input.** This is the
explicit rejection of a map-first workbench (explored and declined): making the map the
place you *promote* and *assign* stops fights how the user actually plans. Every decision
below follows from this. (Worth a one-line clarification to `PRODUCT.md` principle #1 —
"the map is the interface" → "the map is the primary *visualization*; shaping happens in
the lists it confirms" — proposed, not made here.)

## Goal

On planning trips, shaping a trip should feel like arranging cards with the map confirming
in your peripheral vision: drag a candidate into a day, drag a stop between days, drag to
reorder, drag back to the pool — with the map's pins reacting instantly and the matching
card/pin highlighting both ways. Keep every gesture reachable without drag (touch, keyboard,
a11y).

## Non-goals / out of scope

- **Map as input.** No promote/assign/triage *from* a pin. Clicking a pin highlights its
  card; it never mutates the plan. (Rejected, not deferred.)
- **AI auto-arrange** — "decide for me" build-from-candidates is **#408**, a sibling ticket.
- **Plan coherence lint** — timing/distance/season warnings are **#447**.
- **Field-guide command palette** changes — the palette stays as-is; it is not the spine.
- **Touch-drag on phones** — mobile shapes via the existing non-drag fallbacks (see §Mobile).
- **Completed trips** — render unchanged (stacked, read-only). The bench is planning-only.
- **Candidate data / schema / enrich-geocode chain / prompts** — untouched.

## Design

### Layout — the shaping bench (C2)

A new `ShapingBench.svelte` composes the existing `PlanSection` (day rail) and
`CandidatesSection` (candidate pool) into one surface for **planning trips only**, and owns
the shared drag, highlight, and optimistic state. It does not absorb their internals — the
two components keep their rendering; the bench coordinates them.

- **Desktop planning (≥ the existing two-column breakpoint, ~960px):** Plan and Candidates
  render **side-by-side** inside the content column (Plan left / day rail, Candidates right /
  pool). The **sticky trip rail map** (established by the 2026-06-13 visual refresh) is the
  live-visualization surface — it is already always-visible while shaping, so it plays the
  "map above" role from the mockups. To avoid two maps, the **inline Candidates-section map
  is suppressed on desktop** when the bench is active; the rail map carries pins +
  bidirectional highlight instead.
- **Mobile / below breakpoint:** collapses to **stacked** (Plan above, Candidates below) —
  today's single-column flow with the inline overview/candidates map. Accepted tradeoff.
- **Completed (any width):** unchanged — independent stacked read-only sections; the bench
  is not mounted.

The planning detail page (`+page.svelte`) currently renders `plan` and `candidates` as two
independent entries in its `canonicalSections` loop. For planning trips it instead mounts
`ShapingBench` in place of those two section bodies (their headers/section semantics are
preserved — the bench renders the two `<section>` regions, just laid out as a grid at
desktop width). Completed trips keep the existing per-section loop rendering.

**Column-width note (QA):** the content column is capped ~720px. A 2-column split yields
~340px columns. Recent card-compaction work (candidate progressive-disclosure,
2026-06-15/2026-06-16 card specs; compact rail StopCards) makes this viable at rest, but the
comfortable-width feel must be
verified in manual QA; if too tight, the bench may widen its band beyond the 720px cap on
planning trips (documented as the fallback, not the default).

### Gestures

Drag is the **fast path**; a non-drag fallback is **always present** (touch, keyboard, a11y).

| Gesture (drag) | Drop target | Persistence call(s) | Non-drag fallback (kept) |
|---|---|---|---|
| Pool candidate → a day, at an index | day's stop list | `promote` (append) → `reorderStops(day, fullOrder)` | existing "Promote to day…" picker |
| Stop → another day, at an index | other day's stop list | `move-stop` (append) → `reorderStops(toDay, fullOrder)` | (new) target picker reusing promote UI |
| Reorder within a day | same day | `reorderStops(day, fullOrder)` — single call | existing ↑↓ arrows |
| Stop → pool (un-promote) | candidate pool | `un-promote` | existing "Un-promote" button |

The fallbacks are retained deliberately: drag-across-a-scroll-gap is painful on touch, and
keyboard/AT users need a non-pointer path. Drag never becomes the *only* way to do anything.

### Data flow — optimistic, Instant Inline

Archetype: **Instant Inline** (per `docs/ai-workflow-ux.md`) — no AI, sub-second, button/
gesture-as-its-own-feedback.

1. On drop, the bench mutates **local** plan/candidates state immediately (optimistic).
2. The map re-renders pins from that state instantly (reusing candidates-mode pin sync) —
   pins appear / renumber **on drop**, not during the drag (during-drag route redraw is both
   costly and meaningless: the OSRM route line follows trip `waypoints`, not per-stop order).
3. Persistence calls fire in the background.
4. On failure, the bench **reverts** local state to the server truth and surfaces the error
   via an `ERROR_REGISTRY` code (no inline catch sentences). A short re-sync re-reads plan/
   candidates.

### Persistence — client-composed reorder (approach A)

The existing mutation endpoints **append**; ordering is a separate `reorderStops` PUT. For a
positional drop the bench already holds the desired ordering, so:

- **Reorder within a day:** one `reorderStops(day, fullOrderedIds)` call. No partial-failure
  window.
- **Promote-to-index / move-to-index:** the append mutation (`promote` / `move-stop`) **then**
  `reorderStops(targetDay, fullOrderedIds)`.

**Partial-failure semantics (accepted):** if the second call (reorder) fails after the first
(append) succeeds, the stop is correctly *in* the day but **appended rather than at the
dropped index** — a position-only discrepancy, never data loss or a lost stop. The optimistic
UI shows the intended order; on reorder failure we surface the error and re-sync, after which
the user can re-drag. This benign worst-case is why approach A (reuse existing endpoints) was
chosen over adding an atomic `position` param to the mutation endpoints.

### Map — bidirectional highlight only

Reuse `TripMap` `'candidates'` mode, which already plots stop + lodging pins and implements
**card → pin** hover sync (`attachCandidateInteractions`, external-hover effect). Two additions:

- **Pin → card (new direction):** hovering/clicking a pin highlights the matching card and
  scrolls it into view within the bench. Shared highlight state (`highlightedId`) lives in the
  bench and is passed to both the map and the lists.
- **No promote affordance on pins** — clicking a pin never opens an "add to day" control.

On desktop the highlighted surface is the **rail map**; on mobile it's the inline section map.

### Component architecture

- `ShapingBench.svelte` (new) — planning-only. Owns: optimistic `plan`/`candidates` working
  state, drag context (source + drop target + index), `highlightedId`, and the persistence
  orchestration (append→reorder, revert-on-failure). Renders the two `<section>` regions in a
  CSS grid at desktop width, stacked below the breakpoint. Mounts the candidates-mode map
  binding to the rail (desktop) or inline (mobile).
- `PlanSection.svelte` — gains drop targets (per day, per inter-stop gap) and drag handles on
  stops; keeps ↑↓ arrows and `+ Add stop` picker as fallbacks. Drag/drop emit events the bench
  handles; the component does not call endpoints directly when mounted in the bench (the bench
  owns persistence). Standalone/completed use keeps its current direct behavior.
- `CandidatesSection.svelte` — pool cards become drag sources; keeps "Promote to day…" /
  "Un-promote". On desktop-bench, suppresses its inline map (rail map is authoritative).
- `TripMap.svelte` — add pin→card emission + accept an external `highlightedId` for the second
  highlight direction.

A drag library is an implementation choice for the plan; prefer a small, a11y-aware approach
(native HTML5 DnD or a minimal dnd helper) over a heavy dependency, and keep keyboard reorder
working via the retained arrows.

### Mobile

Below the breakpoint: stacked layout, **no touch-drag**. All shaping is via the retained
fallbacks (picker, arrows, buttons), consistent with `PRODUCT.md`'s "phone = reference & quick
reads, not a deep-work session." This avoids the fiddly long-press-drag-with-edge-autoscroll
problem entirely.

## Accessibility

- Every drag gesture has a non-pointer equivalent (pickers, ↑↓ arrows, buttons) — the bench is
  fully operable without drag.
- Drag handles get discernible labels; drop targets announce via `aria-live` on drop ("Diner
  added to Day 2").
- Tap targets keep the `@media (pointer: coarse)` ≥44px floors. The highlight state must not
  rely on color alone (pair with outline/weight).
- Verify AA contrast for any new highlight treatment in light **and** dark.

## Testing

- Behavioral contracts (`plan-io`, `candidates-io`, `realize-plan`, `derive-brochure`,
  frontmatter) are unchanged and must stay green — endpoints are reused, not modified.
- Extract the bench's pure ordering logic (compute `fullOrderedIds` after a drop given source,
  target, index) into a tested helper — it's the one piece of genuine logic and the source of
  the partial-failure reasoning.
- Optimistic-revert path: a unit/integration test that a failed `reorderStops` reverts local
  state and routes to an `ERROR_REGISTRY` code.
- `npm run verify` (svelte-check `--fail-on-warnings` + tests + build) is the go/no-go.
- Watch the worktree svelte-check gotcha (explicit `--tsconfig` if checking from a worktree).

## Manual QA pass

Per `docs/manual-qa.md`, exploratory Playwright-MCP pass on a planning trip:

- [ ] Desktop ≥960px: Plan | Candidates render side-by-side; rail map is the live map; no
      duplicate inline candidates map. Column widths feel comfortable (the width gate above).
- [ ] Drag a pool candidate into Day 2 at a specific position → lands at that index; rail map
      pin appears/renumbers instantly; persists across reload.
- [ ] Drag a stop from Day 1 → Day 3; reorder within a day; drag a stop back to the pool.
- [ ] Each gesture's non-drag fallback still works (picker, ↑↓, un-promote button).
- [ ] Hover/click a card → pin highlights; hover/click a pin → card highlights and scrolls
      into view. No promote affordance on pins.
- [ ] Force a `reorderStops` failure → local state reverts, error surfaces via registry.
- [ ] Mobile (coarse pointer, `hasTouch:true`): stacked layout, no drag, fallbacks operate.
- [ ] Completed trip: unchanged stacked read-only; bench not mounted.
- [ ] Dark mode: highlight + bench chrome AA-safe.

## Future extensions

- Atomic positional insert (`position` param on `promote`/`move-stop`) if the two-call
  partial-failure window ever proves annoying in practice.
- Touch-drag on mobile (deferred here).
- AI auto-arrange (#408) and plan-coherence lint (#447) compose onto this surface later.

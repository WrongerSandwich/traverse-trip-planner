# Reactive Shaping Bench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make planning-trip shaping feel direct by laying Candidates beside Plan in a side-by-side "bench," updating the map optimistically on drop, and sharing one highlight state across both columns.

**Architecture:** A new `ShapingBench.svelte` wraps the existing (already drag-enabled) `PlanSection` + `CandidatesSection` for planning trips only. It owns a `local` optimistic snapshot of `{ plan, candidates }` (seeded and reconciled from the page loader's `data`), a single `mutate()` orchestrator (optimistic-apply → fetch → reconcile/revert), one shared candidates-mode `TripMap`, and one shared `hoveredId`. The children render from an injected `store` and route the six shaping gestures through an injected `mutate` (falling back to today's `fetch → invalidate` when standalone/completed). The optimistic state transitions live in a pure, unit-tested `src/lib/plan-mutations.js`.

**Tech Stack:** SvelteKit (Svelte 5 runes), Vitest, Leaflet (via `TripMap.svelte`), CSS custom-property tokens.

## Global Constraints

- Svelte 5 runes only (`$props`, `$state`, `$derived`, `$effect`, `$bindable`, `$state.snapshot`). Match existing component idiom.
- **Reuse existing endpoints verbatim** — no server / `plan.js` / route-handler changes. The contract:
  - Reorder within day: `PUT /api/plan/[slug]/day/[n]/stops` body `{ order: [id…] }`
  - Promote → day: `POST /api/plan/[slug]/day/[n]/stops` body `{ id }`
  - Move between days: `POST /api/plan/[slug]/move-stop` body `{ fromDay, toDay, stopId }`
  - Remove from day: `DELETE /api/plan/[slug]/day/[n]/stops/[id]`
  - Set day lodging: `PUT /api/plan/[slug]/day/[n]/lodging` body `{ id }`
  - Un-promote: `POST /api/plan/[slug]/un-promote` body `{ id }`
- Errors route through `ERROR_REGISTRY` codes (`src/lib/errors-registry.js`) — no inline catch sentences. The fallback code on a non-ok response is `body.code || 'action_failed'`; on a thrown fetch it is `'network_error'`.
- The bench is **planning-stage only**. Completed trips render exactly as today (independent stacked read-only sections). No touch-drag on mobile — fallbacks (pickers, ↑↓ arrows, buttons) stay.
- Use CSS custom-property tokens from `src/app.css`, not raw color literals.
- Desktop breakpoint is `960px` (matches the existing `.layout` two-column grid).
- Go/no-go: `npm run verify` (`svelte-check --fail-on-warnings` + `vitest run` + `vite build`). There is **no Svelte component test harness** — component tasks verify via `npm run check`, `npm run build`, and the manual Playwright pass (Task 5). Only Task 1 (pure module) is TDD.
- `npm run check` can vacuously report "0 files" in a git worktree — if working in a worktree, run `npx svelte-check --tsconfig ./tsconfig.json` explicitly.

---

### Task 1: Pure optimistic reducers (`src/lib/plan-mutations.js`)

The single piece of real logic and the only TDD task. Six pure functions, each taking an immutable `state = { plan, candidates }` and returning the next state. They mirror `src/lib/server/plan.js` semantics so the optimistic guess matches the post-`invalidate` refetch.

**Files:**
- Create: `src/lib/plan-mutations.js`
- Test: `tests/plan-mutations.test.js`

**Interfaces:**
- Produces (each is `(state, args) => state`, where `state = { plan, candidates }`, `plan = { days: [{ number, stops: [id], lodging_id? }] }`, `candidates = { stops: [{id,…}], lodging: [{id,…}] }`):
  - `applyReorder(state, { dayNumber, order })`
  - `applyPromote(state, { id, dayNumber })` — `dayNumber` nullable (→ first day; creates day 1 if none)
  - `applyMoveStop(state, { fromDay, toDay, stopId })`
  - `applyRemoveStop(state, { dayNumber, id })`
  - `applySetLodging(state, { dayNumber, id })` — `id` null clears
  - `applyUnpromote(state, { id })`
- All return a **new** object (no mutation of the input); callers pass `$state.snapshot(local)`.

- [ ] **Step 1: Write the failing tests**

```javascript
// tests/plan-mutations.test.js
import { describe, it, expect } from 'vitest';
import {
  applyReorder, applyPromote, applyMoveStop,
  applyRemoveStop, applySetLodging, applyUnpromote,
} from '../src/lib/plan-mutations.js';

const base = () => ({
  plan: { days: [
    { number: 1, stops: ['a', 'b'] },
    { number: 2, stops: ['c'] },
  ] },
  candidates: {
    stops: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }],
    lodging: [{ id: 'inn' }],
  },
});

describe('applyReorder', () => {
  it('sets a day stops to the new order', () => {
    const next = applyReorder(base(), { dayNumber: 1, order: ['b', 'a'] });
    expect(next.plan.days[0].stops).toEqual(['b', 'a']);
  });
  it('does not mutate the input', () => {
    const s = base();
    applyReorder(s, { dayNumber: 1, order: ['b', 'a'] });
    expect(s.plan.days[0].stops).toEqual(['a', 'b']);
  });
});

describe('applyPromote', () => {
  it('appends a stop candidate to the target day', () => {
    const next = applyPromote(base(), { id: 'd', dayNumber: 2 });
    expect(next.plan.days[1].stops).toEqual(['c', 'd']);
  });
  it('is idempotent if the stop is already in the day', () => {
    const next = applyPromote(base(), { id: 'c', dayNumber: 2 });
    expect(next.plan.days[1].stops).toEqual(['c']);
  });
  it('null dayNumber targets the first day', () => {
    const next = applyPromote(base(), { id: 'd', dayNumber: null });
    expect(next.plan.days[0].stops).toEqual(['a', 'b', 'd']);
  });
  it('sets lodging_id when the candidate is lodging', () => {
    const next = applyPromote(base(), { id: 'inn', dayNumber: 1 });
    expect(next.plan.days[0].lodging_id).toBe('inn');
    expect(next.plan.days[0].stops).toEqual(['a', 'b']);
  });
  it('creates day 1 when no days exist', () => {
    const empty = { plan: { days: [] }, candidates: base().candidates };
    const next = applyPromote(empty, { id: 'a', dayNumber: null });
    expect(next.plan.days).toEqual([{ number: 1, stops: ['a'] }]);
  });
});

describe('applyMoveStop', () => {
  it('removes from source and appends to target', () => {
    const next = applyMoveStop(base(), { fromDay: 1, toDay: 2, stopId: 'a' });
    expect(next.plan.days[0].stops).toEqual(['b']);
    expect(next.plan.days[1].stops).toEqual(['c', 'a']);
  });
  it('does not duplicate if already in target', () => {
    const s = base(); s.plan.days[1].stops = ['c', 'a'];
    const next = applyMoveStop(s, { fromDay: 1, toDay: 2, stopId: 'a' });
    expect(next.plan.days[1].stops).toEqual(['c', 'a']);
  });
});

describe('applyRemoveStop', () => {
  it('removes the stop from the day', () => {
    const next = applyRemoveStop(base(), { dayNumber: 1, id: 'a' });
    expect(next.plan.days[0].stops).toEqual(['b']);
  });
});

describe('applySetLodging', () => {
  it('sets lodging_id', () => {
    const next = applySetLodging(base(), { dayNumber: 1, id: 'inn' });
    expect(next.plan.days[0].lodging_id).toBe('inn');
  });
  it('clears lodging_id when id is null', () => {
    const s = base(); s.plan.days[0].lodging_id = 'inn';
    const next = applySetLodging(s, { dayNumber: 1, id: null });
    expect(next.plan.days[0].lodging_id).toBeUndefined();
  });
});

describe('applyUnpromote', () => {
  it('removes the id from every day stops and lodging', () => {
    const s = base(); s.plan.days[0].lodging_id = 'inn';
    const next = applyUnpromote(s, { id: 'a' });
    expect(next.plan.days[0].stops).toEqual(['b']);
    const next2 = applyUnpromote(s, { id: 'inn' });
    expect(next2.plan.days[0].lodging_id).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/plan-mutations.test.js`
Expected: FAIL — "Failed to resolve import '../src/lib/plan-mutations.js'".

- [ ] **Step 3: Implement the reducers**

```javascript
// src/lib/plan-mutations.js
//
// Pure optimistic state transitions for the shaping bench. Each takes an
// immutable { plan, candidates } snapshot and returns the next one, mirroring
// the server semantics in src/lib/server/plan.js so the optimistic guess
// matches what an `invalidate('app:trip')` refetch returns. No Svelte, no I/O.

/** Deep-ish clone sufficient for plan/candidates (arrays of plain objects). */
function clone(state) {
  return {
    plan: { ...state.plan, days: (state.plan?.days ?? []).map((d) => ({ ...d, stops: [...(d.stops ?? [])] })) },
    candidates: state.candidates,
  };
}

function findDay(plan, dayNumber) {
  return plan.days.find((d) => d.number === dayNumber);
}

export function applyReorder(state, { dayNumber, order }) {
  const next = clone(state);
  const day = findDay(next.plan, dayNumber);
  if (day) day.stops = [...order];
  return next;
}

export function applyPromote(state, { id, dayNumber }) {
  const next = clone(state);
  if (next.plan.days.length === 0) next.plan.days.push({ number: 1, stops: [] });
  const target = dayNumber == null ? next.plan.days[0] : findDay(next.plan, dayNumber);
  if (!target) return next;
  const isLodging = (next.candidates?.lodging ?? []).some((l) => l.id === id);
  if (isLodging) target.lodging_id = id;
  else if (!target.stops.includes(id)) target.stops.push(id);
  return next;
}

export function applyMoveStop(state, { fromDay, toDay, stopId }) {
  const next = clone(state);
  const from = findDay(next.plan, fromDay);
  const to = findDay(next.plan, toDay);
  if (from) from.stops = from.stops.filter((x) => x !== stopId);
  if (to && !to.stops.includes(stopId)) to.stops.push(stopId);
  return next;
}

export function applyRemoveStop(state, { dayNumber, id }) {
  const next = clone(state);
  const day = findDay(next.plan, dayNumber);
  if (day) day.stops = day.stops.filter((x) => x !== id);
  return next;
}

export function applySetLodging(state, { dayNumber, id }) {
  const next = clone(state);
  const day = findDay(next.plan, dayNumber);
  if (!day) return next;
  if (id == null) delete day.lodging_id;
  else day.lodging_id = id;
  return next;
}

export function applyUnpromote(state, { id }) {
  const next = clone(state);
  for (const day of next.plan.days) {
    day.stops = day.stops.filter((x) => x !== id);
    if (day.lodging_id === id) delete day.lodging_id;
  }
  return next;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/plan-mutations.test.js`
Expected: PASS (all describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/plan-mutations.js tests/plan-mutations.test.js
git commit -m "feat(plan): pure optimistic plan-mutation reducers (#404)"
```

---

### Task 2: Inject `store` / `mutate` / shared highlight into the two section components

Make `PlanSection` and `CandidatesSection` render from an optional injected snapshot and route the six shaping gestures through an optional injected `mutate`, with today's behavior preserved when those props are absent. Lift `hoveredId`/`onHover` to props so the bench can share one highlight state, and add a `showMap` flag so the bench can own the single shared map.

**Files:**
- Modify: `src/lib/components/PlanSection.svelte` (props block ~line 12; `api()` ~line 330; gesture call sites ~lines 178–414; stop `StopCard` ~line 784)
- Modify: `src/lib/components/CandidatesSection.svelte` (props block ~line 13; `api()` ~line 169; gesture call sites ~lines 274–295; map block ~line 478; pool `StopCard` ~line 724)

**Interfaces:**
- Consumes (from Task 1): `applyReorder, applyPromote, applyMoveStop, applyRemoveStop, applySetLodging, applyUnpromote` from `$lib/plan-mutations.js`.
- Produces (consumed by Task 3 — the bench passes these props):
  - Both components accept: `store = null` (`{ plan, candidates } | null`), `mutate = null` (`(arg: { apply, request: { path, opts }, errorCtx }) => Promise<boolean>`), `hoveredId = null`, `onHover = null` (`(id|null) => void`).
  - `PlanSection` additionally accepts: `showMap` is N/A (it has no map) — skip.
  - `CandidatesSection` additionally accepts: `showMap = true` (when `false`, its inline `.map-block` is not rendered).
  - When `store` is set, the component renders `store.plan` / `store.candidates`; otherwise its own `plan` / `candidates` props.
  - When `mutate` is set, the six gestures call it (optimistic); otherwise they call the existing `api()` (`fetch → invalidate`).

- [ ] **Step 1: PlanSection — props + render-from-store + a `persist()` wrapper**

In `src/lib/components/PlanSection.svelte`, change the props destructure (currently `let { plan, candidates, slug, readonly = false, working = $bindable(false) } = $props();`) to alias plan/candidates and add the new props, then derive the render source:

```svelte
<script>
  import { applyReorder, applyPromote, applyMoveStop, applyRemoveStop, applySetLodging } from '$lib/plan-mutations.js';
  // …existing imports…

  let {
    plan: planProp,
    candidates: candsProp,
    slug,
    readonly = false,
    working = $bindable(false),
    store = null,
    mutate = null,
    hoveredId = null,
    onHover = null,
  } = $props();

  // Render source: the bench's optimistic snapshot when injected, else our own props.
  const plan = $derived(store?.plan ?? planProp);
  const candidates = $derived(store?.candidates ?? candsProp);

  // Route a shaping gesture through the bench's optimistic mutate when present,
  // else fall back to the existing fetch+invalidate api(). `apply` is a reducer
  // thunk (ignored standalone); path/opts are the unchanged REST call.
  async function persist({ apply, path, opts, errorCtx }) {
    if (mutate) return mutate({ apply, request: { path, opts }, errorCtx });
    return api(path, opts);
  }
</script>
```

(Keep the existing `api()` function as-is — it remains the standalone path and is still used by non-shaping mutations like day metadata, add-day, todos.)

- [ ] **Step 2: PlanSection — route the four plan-side gestures through `persist()`**

Replace the bodies of these four functions so they call `persist()` with a reducer thunk plus the same REST call they already make. Exact replacements:

`addStop` (promote candidate into this day):
```svelte
async function addStop(dayNumber, candidateId) {
  await persist({
    apply: (s) => applyPromote(s, { id: candidateId, dayNumber }),
    path: `/api/plan/${slug}/day/${dayNumber}/stops`,
    opts: { method: 'POST', body: JSON.stringify({ id: candidateId }) },
    errorCtx: { action: 'add a stop' },
  });
  pickerOpen = null;
}
```

`moveStopAcrossDays`:
```svelte
async function moveStopAcrossDays(fromDay, toDay, stopId) {
  const ok = await persist({
    apply: (s) => applyMoveStop(s, { fromDay, toDay, stopId }),
    path: `/api/plan/${slug}/move-stop`,
    opts: { method: 'POST', body: JSON.stringify({ fromDay, toDay, stopId }) },
    errorCtx: { action: 'move a stop' },
  });
  if (ok) {
    const cand = candidateById(stopId);
    queueHideToast({ kind: 'move', name: cand?.name ?? stopId, fromDay, toDay, stopId });
  }
  return ok;
}
```

`removeStopWithUndo`:
```svelte
async function removeStopWithUndo(dayNumber, id) {
  const cand = candidateById(id);
  const name = cand?.name ?? id;
  const ok = await persist({
    apply: (s) => applyRemoveStop(s, { dayNumber, id }),
    path: `/api/plan/${slug}/day/${dayNumber}/stops/${id}`,
    opts: { method: 'DELETE' },
    errorCtx: { action: 'remove a stop' },
  });
  if (ok) queueHideToast({ kind: 'stop', dayNumber, candidateId: id, name });
}
```

`setLodging`:
```svelte
async function setLodging(dayNumber, candidateId) {
  await persist({
    apply: (s) => applySetLodging(s, { dayNumber, id: candidateId }),
    path: `/api/plan/${slug}/day/${dayNumber}/lodging`,
    opts: { method: 'PUT', body: JSON.stringify({ id: candidateId }) },
    errorCtx: { action: 'set lodging' },
  });
}
```

- [ ] **Step 3: PlanSection — reorder gestures through `persist()`**

The within-day reorder lives in `onStopDrop` (computes `order`) and `nudgeStop`. Both currently call `api(\`/api/plan/${slug}/day/${dayNumber}/stops\`, { method:'PUT', body: JSON.stringify({ order }) })`. Replace each such call with:

```svelte
await persist({
  apply: (s) => applyReorder(s, { dayNumber, order }),
  path: `/api/plan/${slug}/day/${dayNumber}/stops`,
  opts: { method: 'PUT', body: JSON.stringify({ order }) },
  errorCtx: { action: 'reorder stops' },
});
```

(In `onStopDrop` the day variable is the drop target's `dayNumber`; in `nudgeStop` it is the function's `dayNumber` param. Use whichever is in scope — the `order` array is already computed locally in both.)

- [ ] **Step 4: PlanSection — wire stop hover into the shared highlight**

On the stop `StopCard` (~line 784), add `hovered` + a mouseenter/leave that calls `onHover`, so hovering a planned stop highlights its map pin. Wrap or extend the existing `.stop-row` `<li>`:

```svelte
<li
  class="stop-row"
  class:reorder-target={reorderOverIdx === i && reorderDrag?.dayNumber === day.number}
  ondragover={(e) => onStopDragOver(day.number, i, e)}
  ondrop={(e) => onStopDrop(day.number, i, e)}
  onmouseenter={() => onHover?.(id)}
  onmouseleave={() => onHover?.(null)}
>
```

and pass `hovered={hoveredId === id}` to that `<StopCard>`.

- [ ] **Step 5: Run svelte-check + build for PlanSection changes**

Run: `npm run check && npm run build`
Expected: PASS, no new warnings. (If in a worktree and check reports "0 files", run `npx svelte-check --tsconfig ./tsconfig.json`.)

- [ ] **Step 6: CandidatesSection — props + render-from-store + `persist()` + `showMap`**

Mirror Steps 1 in `src/lib/components/CandidatesSection.svelte`. Change the destructure (currently `let { candidates, plan = null, slug, destination = null, home = null, readonly = false, jobs = [], features = null } = $props();`) to:

```svelte
<script>
  import { applyPromote, applyUnpromote, applySetLodging } from '$lib/plan-mutations.js';
  // …existing imports…

  let {
    candidates: candsProp,
    plan: planProp = null,
    slug,
    destination = null,
    home = null,
    readonly = false,
    jobs = [],
    features = null,
    store = null,
    mutate = null,
    hoveredId = $bindable(null),
    onHover = null,
    showMap = true,
  } = $props();

  const candidates = $derived(store?.candidates ?? candsProp);
  const plan = $derived(store?.plan ?? planProp);

  async function persist({ apply, path, opts, errorCtx }) {
    if (mutate) return mutate({ apply, request: { path, opts }, errorCtx });
    return api(path, opts);
  }
</script>
```

Note the local `hoveredId`/`setHover` (lines 23/361) are replaced by the props: delete `let hoveredId = $state(null);` and change `setHover` to defer to the prop when present:

```svelte
function setHover(id) {
  if (onHover) onHover(id);
  else hoveredId = id; // standalone fallback
}
```

To keep a standalone fallback, keep an internal state only when no `onHover` is injected:
```svelte
let localHover = $state(null);
const effHovered = $derived(onHover ? hoveredId : localHover);
function setHover(id) { if (onHover) onHover(id); else localHover = id; }
```
Use `effHovered` everywhere the template currently reads `hoveredId` (the `hovered={hoveredId === stop.id}` card props and the `hoveredId={hoveredId}` map prop).

- [ ] **Step 7: CandidatesSection — route promote/un-promote/set-lodging through `persist()`**

`promoteStop`:
```svelte
async function promoteStop(stopId, dayNumber) {
  const ok = await persist({
    apply: (s) => applyPromote(s, { id: stopId, dayNumber }),
    path: `/api/plan/${slug}/promote`,
    opts: { method: 'POST', body: JSON.stringify({ id: stopId, day: dayNumber }) },
    errorCtx: { action: 'promote a candidate' },
  });
  if (ok) promoteFor = null;
}
```

`unPromoteStop`:
```svelte
async function unPromoteStop(stopId) {
  await persist({
    apply: (s) => applyUnpromote(s, { id: stopId }),
    path: `/api/plan/${slug}/un-promote`,
    opts: { method: 'POST', body: JSON.stringify({ id: stopId }) },
    errorCtx: { action: 'un-promote a stop' },
  });
}
```

`setLodgingForDay`:
```svelte
async function setLodgingForDay(dayNumber, lodgingId) {
  const ok = await persist({
    apply: (s) => applySetLodging(s, { dayNumber, id: lodgingId }),
    path: `/api/plan/${slug}/day/${dayNumber}/lodging`,
    opts: { method: 'PUT', body: JSON.stringify({ id: lodgingId }) },
    errorCtx: { action: 'set lodging' },
  });
  if (ok) promoteFor = null;
}
```

- [ ] **Step 8: CandidatesSection — gate the inline map on `showMap`**

Wrap the `.map-block` (line ~478) so the bench can suppress it:

```svelte
{#if showMap}
  <div class="map-block">
    <TripMap
      mode="candidates"
      stops={visibleStops}
      lodging={visibleLodging}
      home={Array.isArray(home) ? home : null}
      destination={destinationCoords}
      promotedIds={promotedIds}
      hoveredId={effHovered}
      onHover={setHover}
      onClick={scrollToCard}
      visibleCategories={visibleCategories}
    />
  </div>
{/if}
```

Also update the pool `StopCard` `hovered` prop (line ~728) and `LodgingCard` `hovered` (line ~786) to read `effHovered` instead of `hoveredId`.

- [ ] **Step 9: Run svelte-check + build for CandidatesSection changes**

Run: `npm run check && npm run build`
Expected: PASS, no new warnings.

- [ ] **Step 10: Commit**

```bash
git add src/lib/components/PlanSection.svelte src/lib/components/CandidatesSection.svelte
git commit -m "feat(plan): inject store/mutate/shared-highlight into Plan + Candidates sections (#404)"
```

---

### Task 3: `ShapingBench.svelte` — optimistic store, shared map, two-column layout

The coordinator. Holds the optimistic `local` snapshot, reconciles from loader data, owns one `mutate()` orchestrator and one `hoveredId`, renders one shared candidates-mode map, and lays Plan + Candidates side by side at ≥960px.

**Files:**
- Create: `src/lib/components/ShapingBench.svelte`

**Interfaces:**
- Consumes (from Task 2): `PlanSection` and `CandidatesSection` accepting `store`, `mutate`, `hoveredId`, `onHover`, and (Candidates) `showMap`.
- Consumes: `applyReorder` et al. are used *inside the children's thunks*, not here — the bench only invokes `arg.apply(local)`.
- Produces (consumed by Task 4): default export component with props `plan`, `candidates`, `slug`, `home`, `destination`, `candidatesPinHint`, `readonly`, `jobs`, `features`.

- [ ] **Step 1: Create the bench component**

```svelte
<!-- src/lib/components/ShapingBench.svelte -->
<script>
  import { invalidate } from '$app/navigation';
  import PlanSection from './PlanSection.svelte';
  import CandidatesSection from './CandidatesSection.svelte';
  import TripMap from './TripMap.svelte';

  let {
    plan, candidates, slug,
    home = null, destination = null,
    candidatesPinHint = null,
    readonly = false, jobs = [], features = null,
  } = $props();

  // Optimistic snapshot. Seeded from loader data and re-seeded whenever the
  // loader data changes (i.e. after every successful invalidate('app:trip') —
  // the server truth replaces the optimistic guess, normally identically).
  let local = $state({ plan: $state.snapshot(plan), candidates: $state.snapshot(candidates) });
  $effect(() => {
    // Re-read on prop change. Touch both so Svelte tracks them.
    const p = plan, c = candidates;
    local = { plan: $state.snapshot(p), candidates: $state.snapshot(c) };
  });

  let working = $state(false);
  let hoveredId = $state(null);
  let errorCode = $state(null);
  let errorCtx = $state({});

  // Single optimistic orchestrator handed to both children. Apply the reducer
  // thunk to local immediately, fire the request, then reconcile via invalidate
  // (which re-seeds `local` through the effect above). On failure, invalidate
  // pulls server truth back (reverting the optimistic change) and we surface a
  // registry code.
  async function mutate({ apply, request, errorCtx: ctx }) {
    working = true;
    errorCode = null;
    errorCtx = {};
    if (typeof apply === 'function') local = apply($state.snapshot(local));
    try {
      const res = await fetch(request.path, { headers: { 'content-type': 'application/json' }, ...request.opts });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        errorCode = body.code || 'action_failed';
        errorCtx = body.context || ctx || { action: 'update the plan' };
        await invalidate('app:trip');
        return false;
      }
      await invalidate('app:trip');
      return true;
    } catch {
      errorCode = 'network_error';
      await invalidate('app:trip');
      return false;
    } finally {
      working = false;
    }
  }

  function onHover(id) { hoveredId = id; }

  // Map inputs derived from the optimistic snapshot so pins react on drop.
  const visibleStops = $derived((local.candidates?.stops ?? []).filter((s) => !s.hidden));
  const visibleLodging = $derived((local.candidates?.lodging ?? []).filter((l) => !l.hidden));
  const promotedIds = $derived.by(() => {
    const ids = new Set();
    for (const d of local.plan?.days ?? []) {
      for (const id of d.stops ?? []) ids.add(id);
      if (d.lodging_id) ids.add(d.lodging_id);
    }
    return ids;
  });
  function scrollToCard(id) {
    const el = document.getElementById(`candidate-${id}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    hoveredId = id;
  }
</script>

<div class="shaping-bench">
  {#if Array.isArray(destination)}
    <div class="bench-map">
      <TripMap
        mode="candidates"
        stops={visibleStops}
        lodging={visibleLodging}
        home={Array.isArray(home) ? home : null}
        destination={destination}
        promotedIds={promotedIds}
        hoveredId={hoveredId}
        onHover={onHover}
        onClick={scrollToCard}
        visibleCategories={null}
      />
    </div>
  {/if}

  <div class="bench-grid">
    <section class="section bench-col" id="section-plan" aria-label="Plan">
      <header class="section-header"><h2 class="section-heading-serif">Plan</h2></header>
      <PlanSection
        {slug}
        store={local}
        {mutate}
        {hoveredId}
        {onHover}
        bind:working
        readonly={readonly}
      />
    </section>

    <section class="section bench-col" id="section-candidates" aria-label="Candidates">
      <header class="section-header">
        <h2 class="section-heading-serif">Candidates</h2>
        {#if candidatesPinHint}<span class="section-header-hint" aria-live="polite">{candidatesPinHint}</span>{/if}
      </header>
      <CandidatesSection
        {slug}
        store={local}
        {mutate}
        bind:hoveredId
        {onHover}
        showMap={false}
        destination={destination}
        home={home}
        readonly={readonly}
        jobs={jobs}
        features={features}
      />
    </section>
  </div>
</div>

<style>
  .bench-map { margin-bottom: 1rem; }
  .bench-grid { display: flex; flex-direction: column; gap: 1.4rem; }
  @media (min-width: 960px) {
    .bench-grid {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: 1.5rem;
      align-items: start;
    }
    .bench-col { min-width: 0; }
  }
</style>
```

Note: `PlanSection`/`CandidatesSection` still receive `slug` and continue to read their own `plan`/`candidates` props as the *fallback* — but since `store` is injected, the derived render source is `store`. Pass the originals too so prop reactivity stays intact: add `plan={local.plan}` / `candidates={local.candidates}` to each child if svelte-check flags the aliased props as required. (They are not required — both default — so omit unless check complains.)

- [ ] **Step 2: Verify it compiles**

Run: `npm run check && npm run build`
Expected: PASS. (No runtime mount yet — Task 4 wires it into the page.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/components/ShapingBench.svelte
git commit -m "feat(plan): ShapingBench wrapper with optimistic store + shared map (#404)"
```

---

### Task 4: Mount the bench on planning trips in the detail page

Replace the two separate `plan` + `candidates` section iterations with a single `ShapingBench` when the trip is planning-stage; leave the completed-stage loop untouched.

**Files:**
- Modify: `src/routes/trips/[slug]/+page.svelte` (the `{#each canonicalSections}` block ~lines 1465–1530; import + a derived list)

**Interfaces:**
- Consumes (from Task 3): `ShapingBench` default export with props `plan, candidates, slug, home, destination, candidatesPinHint, readonly, jobs, features`.
- Consumes existing page state: `data.plan`, `data.candidates`, `data.trip._slug`, `data.home?.coords`, `trip?._coords`, `candidatesPinHint`, `isPlanning`, `isCompleted`, `allJobs`, `data.features`.

- [ ] **Step 1: Import the bench and compute a bench-aware section list**

Near the other component imports (`import PlanSection …`):
```svelte
import ShapingBench from '$lib/components/ShapingBench.svelte';
```

Add a derived that drops `plan` and `candidates` from the looped sections when the bench will render them (planning only):
```svelte
const loopSections = $derived(
  isPlanning ? canonicalSections.filter((s) => s !== 'plan' && s !== 'candidates') : canonicalSections
);
```

- [ ] **Step 2: Render the bench above the section loop (planning only)**

Immediately before `{#each canonicalSections as section}` (line ~1465), insert:
```svelte
{#if isPlanning}
  <ShapingBench
    plan={data.plan}
    candidates={data.candidates}
    slug={data.trip._slug}
    home={data.home?.coords}
    destination={trip?._coords}
    candidatesPinHint={candidatesPinHint}
    readonly={false}
    jobs={allJobs}
    features={data.features}
  />
{/if}
```

- [ ] **Step 3: Loop over the bench-aware list**

Change the loop header from `{#each canonicalSections as section}` to:
```svelte
{#each loopSections as section}
```

This leaves the existing per-section rendering (including the `{:else if section === 'candidates'}` and `{#if section === 'plan'}` branches) in place for completed trips, where `loopSections === canonicalSections`. On planning trips those two branches are simply never reached because the list excludes them.

- [ ] **Step 4: Suppress the page's now-duplicated section headers for plan/candidates**

The bench renders its own `Plan` / `Candidates` headers. The per-section `<header>` for those ids only renders inside the loop, which no longer includes them on planning trips — so nothing further is needed. Confirm by checking that `section-plan-meta` and `+ Add day` (header actions for `plan`) are not separately required outside the loop; the `+ Add day` button is inside the looped header (lines ~1499–1507) and is therefore dropped on planning trips. **Re-add `+ Add day` inside the bench's Plan header** so the affordance is not lost: in `ShapingBench.svelte` Plan `<header>`, add a button bound to the PlanSection instance.

In `ShapingBench.svelte`, add `let planRef = $state(null);` and `bind:this={planRef}` on `<PlanSection>`, and in the Plan header:
```svelte
<header class="section-header">
  <h2 class="section-heading-serif">Plan</h2>
  {#if !readonly}
    <div class="section-header-actions">
      <button class="btn btn-secondary btn-compact" onclick={() => planRef?.addDay()} disabled={working}>+ Add day</button>
    </div>
  {/if}
</header>
```

- [ ] **Step 5: Run verify**

Run: `npm run verify`
Expected: PASS (`svelte-check` clean, all vitest green incl. Task 1, build succeeds).

- [ ] **Step 6: Commit**

```bash
git add src/routes/trips/[slug]/+page.svelte src/lib/components/ShapingBench.svelte
git commit -m "feat(plan): mount shaping bench on planning trips (#404)"
```

---

### Task 5: Manual QA pass (Playwright-MCP)

Exploratory manual pass per `docs/manual-qa.md`, driving a real planning trip in the dev server. Not a regression net — verify the bench feels right and the optimism is correct.

**Files:** none (manual). Run `npm run dev -- --port 3456` and drive with Playwright-MCP.

- [ ] **Step 1: Desktop layout** — at ≥960px on a planning trip, Plan and Candidates render side by side under one shared map; no duplicate inline candidates map; column widths feel comfortable (the §Layout width gate — if too tight, note it and widen `.bench-grid` band). Completed trip: unchanged stacked read-only, no bench.

- [ ] **Step 2: Optimistic drops** — drag a pool candidate into Day 2: the pin restyles as promoted and the day updates **instantly** (before the network settles); reload shows it persisted. Reorder within a day, move a stop Day 1→Day 3, drag a stop back to the pool (un-promote) — each reflects instantly and persists.

- [ ] **Step 3: Fallbacks** — every gesture still works without drag: "Promote to day…" picker, ↑↓ arrows, "Move" picker, "Un-promote" button, "+ Add day".

- [ ] **Step 4: Shared highlight** — hover a candidate card → its pin highlights; hover a **planned** stop in the Plan column → its pin highlights; click a pin → the matching card scrolls into view. No promote affordance appears on pins.

- [ ] **Step 5: Failure revert** — with devtools, throw on one `PUT …/stops` (or stop the server mid-drag): the optimistic change reverts to server truth and an `ERROR_REGISTRY` sentence surfaces.

- [ ] **Step 6: Mobile** — emulate a coarse-pointer device with `hasTouch:true`: layout is stacked (Plan above Candidates), no drag, fallbacks operate. (Trust screenshots over rect math inside closed `<details>`.)

- [ ] **Step 7: Dark mode** — bench chrome + highlight states are AA-safe in both themes.

- [ ] **Step 8: Final verify + commit any QA fixes**

```bash
npm run verify
git add -A && git commit -m "fix(plan): shaping bench manual-QA polish (#404)"
```

---

## Self-Review

**Spec coverage:**
- C2 side-by-side layout → Task 3 (`.bench-grid`) + Task 4 (mount). ✓
- Optimistic-on-drop + revert → Task 1 (reducers) + Task 2 (route gestures) + Task 3 (`mutate` orchestrator). ✓
- Bench-wide shared map + highlight → Task 2 (lift `hoveredId`/`onHover`, plan-stop hover, `showMap`) + Task 3 (shared map, `promotedIds`/`visibleStops` from optimistic snapshot). ✓
- Endpoints unchanged → all gesture `path`/`opts` copied verbatim from current call sites. ✓
- Fallbacks retained → pickers/arrows/buttons untouched; only the persistence call swapped to `persist()`. ✓
- Completed unchanged → bench is `isPlanning`-gated; `loopSections` only filters when planning. ✓
- `+ Add day` preserved → Task 4 Step 4 re-adds it inside the bench header. ✓
- No-component-test-harness reality → Task 1 is TDD; component tasks verify via check/build/manual. ✓ (honest, not a placeholder).

**Placeholder scan:** No TBD/TODO; every code step has concrete code. The one judgment call (column-width comfort) is an explicit QA gate with a documented fallback, not a placeholder.

**Type consistency:** `mutate({ apply, request: { path, opts }, errorCtx })` is defined identically in Task 3 and consumed identically by `persist()` in Task 2. Reducer names (`applyPromote` etc.) match Task 1's exports. `store` shape `{ plan, candidates }` is consistent across the bench (`local`) and the children's `store?.plan` deriveds. `hoveredId`/`onHover` prop names match between bench and children. `promotedIds` is a `Set` in both the bench and `TripMap`'s `promotedIds` default (`new Set()`).

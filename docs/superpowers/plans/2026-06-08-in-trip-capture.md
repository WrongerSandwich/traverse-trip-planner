# In-Trip Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a traveler mark stops visited/skipped and jot per-stop and per-day notes on the live Today view, and have that captured material feed the post-trip retro.

**Architecture:** Capture state piggybacks existing files — `status`/`note` on candidate stops in `candidates.yaml` (mirroring the `todos.done` precedent), `log` on plan days in `plan.yaml`. Two `PATCH` endpoints under a new `/api/capture` namespace write it (planning-stage only, Instant Inline). `deriveBrochure` projects it to the Today view, which gains a capture row. At completion, the retro handlers read it (it travels into `completed/` with the folder move): they ground the AI prompt and preserve raw jottings verbatim under `## In-trip notes`.

**Tech Stack:** SvelteKit (adapter-node), Svelte 5 runes, Vitest, `yaml`.

**Spec:** `docs/superpowers/specs/2026-06-08-in-trip-capture-design.md`

---

## File Structure

- **Modify** `src/lib/server/candidates.js` — add `setStopCapture(slug, stopId, { status, note })`.
- **Modify** `src/lib/server/plan.js` — add `setDayLog(slug, dayNumber, log)`.
- **Modify** `src/lib/server/realize-plan.js` — extend the `priorPrepById` preservation to carry `status`/`note` across re-research.
- **Modify** `src/lib/server/derive-brochure.js` — project stop `status`/`note` and day `log`.
- **Create** `src/routes/api/capture/[slug]/stops/[id]/+server.js` — PATCH stop capture.
- **Create** `src/routes/api/capture/[slug]/days/[number]/+server.js` — PATCH day log.
- **Create** `src/lib/server/retro-capture.js` — pure `buildCaptureContext({ plan, candidates })` → `{ promptBlock, verbatimSection }`.
- **Modify** `src/routes/api/actions/retro/[slug]/+server.js` — inject `promptBlock` into POST + PUT prompts; append `verbatimSection` to the notes body.
- **Modify** `src/lib/components/TodayStopCard.svelte` — capture row (Visited/Skip + note), gated by an `editable` prop.
- **Modify** `src/routes/trips/[slug]/today/+page.svelte` — pass `editable` (planning stage), render the Day-notes field, hold optimistic capture state.
- **Modify** `src/routes/trips/[slug]/today/+page.server.js` — expose `editable` (stage === 'planning'). (Stop `status`/`note` and day `log` already flow through `normalizeStopCoords`/`normalizeDayCoords`, which spread the object — verified, no change needed for those.)
- **Modify** `src/lib/server/render-offline-today.js` — render captured `status`/`note` read-only in the bundle (separable task).
- **Tests** under `tests/`.

**Data shapes (consistent across tasks):**
- Stop gains `status: 'visited' | 'skipped'` (field absent = unmarked) and `note: string`.
- Plan day gains `log: string`.
- `deriveBrochure` projects `status: c.status ?? null`, `note: c.note ?? null` per stop and `log: d.log ?? null` per day.

---

## Task 1: `setStopCapture` in candidates.js

**Files:**
- Modify: `src/lib/server/candidates.js`
- Test: `tests/capture-io.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/capture-io.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the disk layer: candidatesPath/readCandidates/writeCandidates back onto an
// in-memory object so we test the mutation logic without a filesystem.
let store;
vi.mock('../src/lib/server/data.js', () => ({
  findTripLocation: () => ({ kind: 'dir', path: '/x', stage: 'planning' }),
  geocode: vi.fn(),
}));

import * as cand from '../src/lib/server/candidates.js';

beforeEach(() => {
  store = {
    stops: [
      { id: 'main-st', name: 'Main St', todos: [{ id: 't1', text: 'x', done: false }] },
      { id: 'museum', name: 'Museum' },
    ],
    lodging: [],
  };
  vi.spyOn(cand, 'readCandidates').mockImplementation(() => JSON.parse(JSON.stringify(store)));
  vi.spyOn(cand, 'writeCandidates').mockImplementation((_slug, c) => { store = c; return '/x'; });
});

describe('setStopCapture', () => {
  it('sets status and note on a stop', () => {
    const out = cand.setStopCapture('t', 'main-st', { status: 'visited', note: 'Loved it' });
    expect(out.status).toBe('visited');
    expect(out.note).toBe('Loved it');
    expect(store.stops[0].status).toBe('visited');
    expect(store.stops[0].note).toBe('Loved it');
  });

  it('clears status when status is null, leaving note untouched', () => {
    cand.setStopCapture('t', 'main-st', { status: 'visited', note: 'hi' });
    const out = cand.setStopCapture('t', 'main-st', { status: null });
    expect('status' in out).toBe(false);
    expect(out.note).toBe('hi');
  });

  it('clears note when note is empty string', () => {
    cand.setStopCapture('t', 'main-st', { note: 'hi' });
    const out = cand.setStopCapture('t', 'main-st', { note: '' });
    expect('note' in out).toBe(false);
  });

  it('only touches the field that is provided', () => {
    cand.setStopCapture('t', 'main-st', { status: 'skipped' });
    const out = cand.setStopCapture('t', 'main-st', { note: 'later' });
    expect(out.status).toBe('skipped'); // status preserved when only note given
    expect(out.note).toBe('later');
  });

  it('returns null for an unknown stop', () => {
    expect(cand.setStopCapture('t', 'nope', { status: 'visited' })).toBe(null);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- capture-io`
Expected: FAIL — `setStopCapture` is not exported.

- [ ] **Step 3: Implement `setStopCapture`**

In `src/lib/server/candidates.js`, after `setTodoDone` (around line 278), add:

```js
/**
 * Set in-trip capture fields on a candidate stop.
 *   - status: 'visited' | 'skipped' to set; null to clear the field.
 *   - note: a string to set; '' to clear the field.
 * Only the keys present in `patch` are touched. Returns the mutated stop, or
 * null if the stop id matches nothing.
 *
 * @param {string} slug
 * @param {string} stopId
 * @param {{ status?: 'visited'|'skipped'|null, note?: string }} patch
 */
export function setStopCapture(slug, stopId, patch) {
  const cands = loadOrInit(slug);
  const stop = cands.stops.find((s) => s.id === stopId);
  if (!stop) return null;
  if ('status' in patch) {
    if (patch.status == null) delete stop.status;
    else stop.status = patch.status;
  }
  if ('note' in patch) {
    if (!patch.note) delete stop.note;
    else stop.note = patch.note;
  }
  writeCandidates(slug, cands);
  return stop;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- capture-io`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/candidates.js tests/capture-io.test.js
git commit -m "feat(capture): add setStopCapture for per-stop visited/skipped + note"
```

---

## Task 2: `setDayLog` in plan.js

**Files:**
- Modify: `src/lib/server/plan.js`
- Test: `tests/capture-io.test.js` (extend)

- [ ] **Step 1: Add failing tests**

Append a new block to `tests/capture-io.test.js`. Add this mock + import near the top (after the existing imports), and the describe at the end:

```js
// --- plan.js setDayLog ---
let planStore;
vi.mock('../src/lib/server/plan.js', async (importOriginal) => await importOriginal());
import * as plan from '../src/lib/server/plan.js';

describe('setDayLog', () => {
  beforeEach(() => {
    planStore = { cover_query: null, field_guide_notes: [], gotchas: [], days: [
      { number: 1, stops: ['main-st'] },
      { number: 2, stops: [] },
    ] };
    vi.spyOn(plan, 'readPlan').mockImplementation(() => JSON.parse(JSON.stringify(planStore)));
    vi.spyOn(plan, 'writePlan').mockImplementation((_s, p) => { planStore = p; return '/x'; });
  });

  it('sets a day log', () => {
    const day = plan.setDayLog('t', 1, 'Rained all afternoon');
    expect(day.log).toBe('Rained all afternoon');
    expect(planStore.days[0].log).toBe('Rained all afternoon');
  });

  it('clears the log when empty', () => {
    plan.setDayLog('t', 1, 'x');
    const day = plan.setDayLog('t', 1, '');
    expect('log' in day).toBe(false);
  });

  it('returns null for an unknown day', () => {
    expect(plan.setDayLog('t', 99, 'x')).toBe(null);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- capture-io`
Expected: FAIL — `setDayLog` not exported.

- [ ] **Step 3: Implement `setDayLog`**

In `src/lib/server/plan.js`, after `setDayMetadata` (around line 226), add:

```js
/**
 * Set the in-trip `log` on a day (distinct from the planning `notes` field).
 * Empty/blank clears the field. Returns the mutated day, or null if the day
 * number matches nothing (so callers can 404 rather than 500).
 *
 * @param {string} slug
 * @param {number} dayNumber
 * @param {string} log
 */
export function setDayLog(slug, dayNumber, log) {
  const plan = loadOrInit(slug);
  const day = plan.days.find((d) => d.number === dayNumber);
  if (!day) return null;
  if (log == null || String(log).trim() === '') delete day.log;
  else day.log = log;
  writePlan(slug, plan);
  return day;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- capture-io`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/plan.js tests/capture-io.test.js
git commit -m "feat(capture): add setDayLog for per-day in-trip note"
```

---

## Task 3: Preserve capture across re-research (realize-plan.js)

**Files:**
- Modify: `src/lib/server/realize-plan.js`
- Test: `tests/realize-plan.test.js` (extend — confirm the file exists; it does per CLAUDE.md)

Context: `realizePlan` rebuilds researcher candidates from scratch, but a `priorPrepById` block (realize-plan.js:161-173) re-applies `tips`/`todos` from the prior candidates by id. Extend it to carry `status`/`note` too. Day `log` already survives because `plan.days = existingPlan.days` (line 136) preserves days untouched — add a test asserting that, but no code change for days.

- [ ] **Step 1: Add a failing test**

Add to `tests/realize-plan.test.js` (match the file's existing setup style for invoking `realizePlan`; the assertion is what matters):

```js
it('preserves a stop’s in-trip status/note across re-research, and day log', async () => {
  // 1. Initial realize creates researcher stop "old-mill".
  await realizePlan(SLUG, { plan: {}, candidates: { stops: [{ name: 'Old Mill' }], lodging: [] } });
  // 2. User captures status/note on it and a day log (simulate by writing them in).
  const cands = readCandidates(SLUG);
  cands.stops.find((s) => s.id === 'old-mill').status = 'visited';
  cands.stops.find((s) => s.id === 'old-mill').note = 'Closed early';
  writeCandidates(SLUG, cands);
  const plan = readPlan(SLUG) || { days: [{ number: 1, stops: ['old-mill'] }] };
  plan.days = [{ number: 1, stops: ['old-mill'], log: 'Great day' }];
  writePlan(SLUG, plan);
  // 3. Re-research re-extracts the same researcher stop.
  await realizePlan(SLUG, { plan: {}, candidates: { stops: [{ name: 'Old Mill' }], lodging: [] } });
  // 4. Capture survived.
  const after = readCandidates(SLUG);
  const stop = after.stops.find((s) => s.id === 'old-mill');
  expect(stop.status).toBe('visited');
  expect(stop.note).toBe('Closed early');
  expect(readPlan(SLUG).days[0].log).toBe('Great day');
});
```

(Use the imports the existing test file already establishes for `realizePlan`, `readCandidates`, `writeCandidates`, `readPlan`, `writePlan`, and `SLUG`. If the file uses a temp data dir fixture, follow that pattern.)

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- realize-plan`
Expected: FAIL — status/note are wiped by the fresh researcher rebuild.

- [ ] **Step 3: Extend the preservation block**

In `src/lib/server/realize-plan.js`, replace the `priorPrepById` block (lines ~161-173) with:

```js
    const priorPrepById = new Map();
    for (const s of existingCands.stops ?? []) {
      if (s.id && (s.tips || s.todos || s.status || s.note)) {
        priorPrepById.set(s.id, { tips: s.tips, todos: s.todos, status: s.status, note: s.note });
      }
    }
    for (const c of cands.stops) {
      const prior = priorPrepById.get(c.id);
      if (prior) {
        if (prior.tips) c.tips = prior.tips;
        if (prior.todos) c.todos = prior.todos;
        if (prior.status) c.status = prior.status;
        if (prior.note) c.note = prior.note;
      }
    }
```

(Day `log` needs no change — `plan.days = existingPlan.days` already carries it.)

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- realize-plan`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/realize-plan.js tests/realize-plan.test.js
git commit -m "feat(capture): preserve stop status/note across re-research"
```

---

## Task 4: Project capture in deriveBrochure

**Files:**
- Modify: `src/lib/server/derive-brochure.js`
- Test: `tests/derive-brochure.test.js` (extend)

- [ ] **Step 1: Add a failing test**

Add to `tests/derive-brochure.test.js` (follow the file's fixture style — it writes plan.yaml/candidates.yaml for a temp slug, then calls `deriveBrochure`). The assertion:

```js
it('projects stop status/note and day log', () => {
  // Fixture: candidates with a captured stop, plan day with a log.
  // (use the file's existing helper to write candidates/plan for TEST_SLUG)
  writeCandidates(TEST_SLUG, { stops: [
    { id: 'mill', name: 'Mill', category: 'historic', status: 'visited', note: 'Closed early' },
  ], lodging: [] });
  writePlan(TEST_SLUG, { cover_query: null, field_guide_notes: [], gotchas: [],
    days: [{ number: 1, stops: ['mill'], log: 'Rainy' }] });
  const b = deriveBrochure(TEST_SLUG);
  expect(b.days[0].log).toBe('Rainy');
  expect(b.days[0].stops[0].status).toBe('visited');
  expect(b.days[0].stops[0].note).toBe('Closed early');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- derive-brochure`
Expected: FAIL — `status`/`note`/`log` are `undefined` in the projection.

- [ ] **Step 3: Add the fields to the projection**

In `src/lib/server/derive-brochure.js`, in the day-stops `.map((c) => ({ ... }))` (around lines 74-86), add three fields — `id` (needed by the capture write path in Task 9), plus `status` and `note`:

```js
        tips: c.tips,
        todos: c.todos,
        id: c.id,
        status: c.status ?? null,
        note: c.note ?? null,
```

And in the per-day return object (around lines 94-101), add `log`:

```js
      n: d.number,
      date: d.date ?? null,
      theme: null,
      drive_distance_mi: d.drive_distance_mi ?? null,
      notes: d.notes ?? '',
      log: d.log ?? null,
      stops: dayStops,
      lodging: dayLodging,
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- derive-brochure`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/derive-brochure.js tests/derive-brochure.test.js
git commit -m "feat(capture): project stop status/note + day log in deriveBrochure"
```

---

## Task 5: Capture endpoints (PATCH stop + day)

**Files:**
- Create: `src/routes/api/capture/[slug]/stops/[id]/+server.js`
- Create: `src/routes/api/capture/[slug]/days/[number]/+server.js`
- Test: `tests/capture-endpoint.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/capture-endpoint.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const setStopCapture = vi.fn();
const setDayLog = vi.fn();
const invalidateEnrichCache = vi.fn();
let stage = 'planning';

vi.mock('../src/lib/server/data.js', () => ({
  rejectInvalidSlug: (s) => (/^[a-z0-9-]+$/.test(s) ? null : new Response('bad', { status: 400 })),
  invalidateEnrichCache: () => invalidateEnrichCache(),
  findTripLocation: () => ({ kind: 'dir', path: '/x', stage }),
}));
vi.mock('../src/lib/server/candidates.js', () => ({ setStopCapture: (...a) => setStopCapture(...a) }));
vi.mock('../src/lib/server/plan.js', () => ({ setDayLog: (...a) => setDayLog(...a) }));

import { PATCH as stopPATCH } from '../src/routes/api/capture/[slug]/stops/[id]/+server.js';
import { PATCH as dayPATCH } from '../src/routes/api/capture/[slug]/days/[number]/+server.js';

function req(body) { return { json: async () => body }; }
beforeEach(() => { stage = 'planning'; setStopCapture.mockReset(); setDayLog.mockReset(); invalidateEnrichCache.mockReset(); });

describe('PATCH capture stop', () => {
  it('sets status, invalidates cache, returns candidate', async () => {
    setStopCapture.mockReturnValue({ id: 'mill', status: 'visited' });
    const res = await stopPATCH({ params: { slug: 't', id: 'mill' }, request: req({ status: 'visited' }) });
    expect(res.status).toBe(200);
    expect(setStopCapture).toHaveBeenCalledWith('t', 'mill', { status: 'visited' });
    expect(invalidateEnrichCache).toHaveBeenCalled();
    expect((await res.json()).candidate.status).toBe('visited');
  });

  it('rejects an invalid status with invalid_input', async () => {
    const res = await stopPATCH({ params: { slug: 't', id: 'mill' }, request: req({ status: 'maybe' }) });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('invalid_input');
    expect(setStopCapture).not.toHaveBeenCalled();
  });

  it('rejects an over-length note', async () => {
    const res = await stopPATCH({ params: { slug: 't', id: 'mill' }, request: req({ note: 'x'.repeat(2001) }) });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('invalid_input');
  });

  it('404s when the stop is not found', async () => {
    setStopCapture.mockReturnValue(null);
    const res = await stopPATCH({ params: { slug: 't', id: 'nope' }, request: req({ status: 'visited' }) });
    expect(res.status).toBe(404);
  });

  it('rejects a completed trip with wrong_stage', async () => {
    stage = 'completed';
    const res = await stopPATCH({ params: { slug: 't', id: 'mill' }, request: req({ status: 'visited' }) });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('wrong_stage');
  });
});

describe('PATCH capture day', () => {
  it('sets the day log', async () => {
    setDayLog.mockReturnValue({ number: 1, log: 'Rainy' });
    const res = await dayPATCH({ params: { slug: 't', number: '1' }, request: req({ note: 'Rainy' }) });
    expect(res.status).toBe(200);
    expect(setDayLog).toHaveBeenCalledWith('t', 1, 'Rainy');
    expect(invalidateEnrichCache).toHaveBeenCalled();
  });

  it('404s for an unknown day', async () => {
    setDayLog.mockReturnValue(null);
    const res = await dayPATCH({ params: { slug: 't', number: '9' }, request: req({ note: 'x' }) });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- capture-endpoint`
Expected: FAIL — endpoint modules don't exist.

- [ ] **Step 3: Implement the stop endpoint**

Create `src/routes/api/capture/[slug]/stops/[id]/+server.js`:

```js
import { json } from '@sveltejs/kit';
import { setStopCapture } from '$lib/server/candidates.js';
import { invalidateEnrichCache, rejectInvalidSlug, findTripLocation } from '$lib/server/data.js';

const MAX_NOTE = 2000;
const VALID_STATUS = new Set(['visited', 'skipped']);

/**
 * PATCH in-trip capture for one stop. Body: { status?, note? }
 *   status: 'visited' | 'skipped' | null (clear)
 *   note:   string (<=2000 chars; '' clears)
 * Planning stage only.
 */
export async function PATCH({ params, request }) {
  const invalid = rejectInvalidSlug(params.slug);
  if (invalid) return invalid;

  const loc = findTripLocation(params.slug);
  if (!loc || loc.kind !== 'dir') return json({ code: 'trip_not_found' }, { status: 404 });
  if (loc.stage !== 'planning') return json({ code: 'wrong_stage' }, { status: 409 });

  let body;
  try { body = await request.json(); } catch { body = {}; }

  const patch = {};
  if ('status' in body) {
    if (body.status !== null && !VALID_STATUS.has(body.status)) {
      return json({ code: 'invalid_input', context: { reason: 'status must be "visited", "skipped", or null' } }, { status: 400 });
    }
    patch.status = body.status;
  }
  if ('note' in body) {
    if (body.note != null && typeof body.note !== 'string') {
      return json({ code: 'invalid_input', context: { reason: 'note must be a string' } }, { status: 400 });
    }
    if (typeof body.note === 'string' && body.note.length > MAX_NOTE) {
      return json({ code: 'invalid_input', context: { reason: `note is too long (max ${MAX_NOTE})` } }, { status: 400 });
    }
    patch.note = body.note ?? '';
  }
  if (Object.keys(patch).length === 0) {
    return json({ code: 'invalid_input', context: { reason: 'provide status and/or note' } }, { status: 400 });
  }

  const updated = setStopCapture(params.slug, params.id, patch);
  if (!updated) return json({ code: 'trip_not_found', context: { reason: 'stop not found' } }, { status: 404 });
  invalidateEnrichCache();
  return json({ ok: true, candidate: updated });
}
```

- [ ] **Step 4: Implement the day endpoint**

Create `src/routes/api/capture/[slug]/days/[number]/+server.js`:

```js
import { json } from '@sveltejs/kit';
import { setDayLog } from '$lib/server/plan.js';
import { invalidateEnrichCache, rejectInvalidSlug, findTripLocation } from '$lib/server/data.js';

const MAX_NOTE = 2000;

/**
 * PATCH the in-trip note (`log`) for one day. Body: { note: string }
 * Planning stage only.
 */
export async function PATCH({ params, request }) {
  const invalid = rejectInvalidSlug(params.slug);
  if (invalid) return invalid;

  const loc = findTripLocation(params.slug);
  if (!loc || loc.kind !== 'dir') return json({ code: 'trip_not_found' }, { status: 404 });
  if (loc.stage !== 'planning') return json({ code: 'wrong_stage' }, { status: 409 });

  const number = Number(params.number);
  if (!Number.isInteger(number)) {
    return json({ code: 'invalid_input', context: { reason: 'day number must be an integer' } }, { status: 400 });
  }

  let body;
  try { body = await request.json(); } catch { body = {}; }
  const note = body?.note;
  if (note != null && typeof note !== 'string') {
    return json({ code: 'invalid_input', context: { reason: 'note must be a string' } }, { status: 400 });
  }
  if (typeof note === 'string' && note.length > MAX_NOTE) {
    return json({ code: 'invalid_input', context: { reason: `note is too long (max ${MAX_NOTE})` } }, { status: 400 });
  }

  const day = setDayLog(params.slug, number, note ?? '');
  if (!day) return json({ code: 'trip_not_found', context: { reason: 'day not found' } }, { status: 404 });
  invalidateEnrichCache();
  return json({ ok: true, day });
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm test -- capture-endpoint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/routes/api/capture tests/capture-endpoint.test.js
git commit -m "feat(capture): add PATCH endpoints for stop status/note + day log"
```

---

## Task 6: Retro capture context (pure builder)

**Files:**
- Create: `src/lib/server/retro-capture.js`
- Test: `tests/retro-capture.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/retro-capture.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { buildCaptureContext } from '../src/lib/server/retro-capture.js';

function fixture() {
  return {
    plan: { days: [
      { number: 1, stops: ['mill', 'museum'], log: 'Rained all afternoon' },
      { number: 2, stops: ['trail'] },
    ] },
    candidates: { stops: [
      { id: 'mill', name: 'Old Mill', status: 'visited', note: 'Closed early' },
      { id: 'museum', name: 'History Museum', status: 'skipped' },
      { id: 'trail', name: 'River Trail' },
    ], lodging: [] },
  };
}

describe('buildCaptureContext', () => {
  it('builds a prompt block summarizing status + notes + day logs', () => {
    const { promptBlock } = buildCaptureContext(fixture());
    expect(promptBlock).toMatch(/Old Mill/);
    expect(promptBlock).toMatch(/visited/);
    expect(promptBlock).toMatch(/Closed early/);
    expect(promptBlock).toMatch(/skipped/);
    expect(promptBlock).toMatch(/Rained all afternoon/);
  });

  it('builds a verbatim ## In-trip notes section from logs + notes only', () => {
    const { verbatimSection } = buildCaptureContext(fixture());
    expect(verbatimSection).toMatch(/^## In-trip notes/m);
    expect(verbatimSection).toMatch(/Rained all afternoon/);
    expect(verbatimSection).toMatch(/Old Mill/);
    expect(verbatimSection).toMatch(/Closed early/);
    // A skipped stop with no note contributes nothing to the verbatim section.
    expect(verbatimSection).not.toMatch(/History Museum/);
  });

  it('returns empty block + null section when nothing was captured', () => {
    const empty = { plan: { days: [{ number: 1, stops: ['a'] }] }, candidates: { stops: [{ id: 'a', name: 'A' }], lodging: [] } };
    const out = buildCaptureContext(empty);
    expect(out.promptBlock).toBe('');
    expect(out.verbatimSection).toBe(null);
  });

  it('tolerates missing plan/candidates', () => {
    expect(buildCaptureContext({ plan: null, candidates: null }))
      .toEqual({ promptBlock: '', verbatimSection: null });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- retro-capture`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the builder**

Create `src/lib/server/retro-capture.js`:

```js
// Pure assembly of in-trip capture into (a) a prompt context block that grounds
// the retro AI and (b) a verbatim "## In-trip notes" section preserving the
// traveler's exact words. No I/O — callers pass already-read plan + candidates.

/**
 * @param {{ plan: {days?: any[]}|null, candidates: {stops?: any[]}|null }} input
 * @returns {{ promptBlock: string, verbatimSection: string|null }}
 */
export function buildCaptureContext({ plan, candidates }) {
  const days = plan?.days ?? [];
  const byId = new Map((candidates?.stops ?? []).map((s) => [s.id, s]));

  const promptLines = [];
  const verbatimLines = [];

  for (const day of days) {
    const stops = (day.stops ?? []).map((id) => byId.get(id)).filter(Boolean);
    const captured = stops.filter((s) => s.status || s.note);
    const hasDayLog = typeof day.log === 'string' && day.log.trim();
    const dayNoteStops = stops.filter((s) => typeof s.note === 'string' && s.note.trim());

    // Prompt block: include the day if anything was captured on it.
    if (captured.length || hasDayLog) {
      promptLines.push(`Day ${day.number}:`);
      for (const s of captured) {
        const status = s.status ? `${s.status}` : 'noted';
        const note = s.note ? ` Note: "${s.note}"` : '';
        promptLines.push(`- ${s.name} — ${status}.${note}`);
      }
      if (hasDayLog) promptLines.push(`Day note: "${day.log.trim()}"`);
      promptLines.push('');
    }

    // Verbatim section: only the human prose (day log + stop notes).
    if (hasDayLog || dayNoteStops.length) {
      verbatimLines.push(`**Day ${day.number}**${hasDayLog ? ` — ${day.log.trim()}` : ''}`);
      for (const s of dayNoteStops) verbatimLines.push(`- ${s.name}: ${s.note.trim()}`);
      verbatimLines.push('');
    }
  }

  const promptBlock = promptLines.join('\n').trim();
  const verbatimSection = verbatimLines.length
    ? `## In-trip notes\n\n${verbatimLines.join('\n').trim()}`
    : null;

  return { promptBlock, verbatimSection };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- retro-capture`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/retro-capture.js tests/retro-capture.test.js
git commit -m "feat(capture): pure builder for retro capture context + verbatim notes"
```

---

## Task 7: Wire capture into the retro handlers

**Files:**
- Modify: `src/routes/api/actions/retro/[slug]/+server.js`

No new test file — Task 6 covers the builder; this task wires it in. The full retro suite (`tests/` for retro, if present) must stay green, and `npm run check` clean.

- [ ] **Step 1: Add imports**

At the top of `src/routes/api/actions/retro/[slug]/+server.js`, add:

```js
import { readPlan } from '$lib/server/plan.js';
import { readCandidates } from '$lib/server/candidates.js';
import { buildCaptureContext } from '$lib/server/retro-capture.js';
```

- [ ] **Step 2: Inject the capture block into the POST (questions) prompt**

In `POST`, after `const context = tripContextDump(trip.files);`, add:

```js
  const capture = buildCaptureContext({ plan: readPlan(slug), candidates: readCandidates(slug) });
```

Then in the `system` template string, add a capture section just before the closing backtick (after the "Trip the user just finished" block):

```js
Trip the user just finished:
${context || '(no planning sections available)'}

${capture.promptBlock ? `What the traveler recorded DURING the trip (ground the first question in this when present):\n${capture.promptBlock}` : ''}`;
```

- [ ] **Step 3: Inject into the PUT (notes) prompt and append the verbatim section**

In `PUT`, after `const context = tripContextDump(trip.files);`, add:

```js
  const capture = buildCaptureContext({ plan: readPlan(slug), candidates: readCandidates(slug) });
```

Add the capture block to `userMsg` (after the "Trip context" block):

```js
  const userMsg = `Trip context (planning sections + itinerary):
${context || '(no planning sections available)'}
${capture.promptBlock ? `\nWhat the traveler recorded during the trip:\n${capture.promptBlock}\n` : ''}
User's retrospective answers:
${qaDump}

Structured fields they selected:
- Rating: ${rating ?? '(none)'} / 5
- Would do it again: ${wouldRepeat ? 'yes' : 'no'}

Write the notes.md body now.`;
```

Then, after the highlights extraction and before `const noteContent = buildNotesMd(...)`, append the verbatim section to `prose`:

```js
  // Preserve the traveler's raw jottings verbatim, after the AI prose.
  if (capture.verbatimSection) {
    prose = `${prose}\n\n${capture.verbatimSection}`;
  }
```

- [ ] **Step 4: Verify**

Run: `npm test -- retro` (if a retro endpoint suite exists) and `npm run check`
Expected: existing tests green; 0 errors/0 warnings. Manually re-read the diff to confirm the prompt strings interpolate cleanly (no stray `undefined`).

- [ ] **Step 5: Commit**

```bash
git add src/routes/api/actions/retro/[slug]/+server.js
git commit -m "feat(capture): feed in-trip capture into retro prompts + verbatim notes"
```

---

## Task 8: Expose `editable` from the Today loader

**Files:**
- Modify: `src/routes/trips/[slug]/today/+page.server.js`

- [ ] **Step 1: Add `editable` to the returned data**

The loader already finds the trip via `enrichTrips()`. Capture controls are planning-stage only. Add `editable` to BOTH return objects (the `hasPlan: false` early return and the main return), derived from the trip's stage. The enriched trip carries `_stage` (see data.js:733). Add:

```js
  const editable = trip?._stage === 'planning';
```

immediately after the `trip` is resolved (after the `if (!trip) throw error(...)` line), and include `editable,` in both returned objects (`return { hasPlan: false, trip, editable };` and the main `return { hasPlan: true, ..., editable };`).

- [ ] **Step 2: Verify**

Run: `npm run check`
Expected: 0 errors, 0 warnings.

- [ ] **Step 3: Commit**

```bash
git add src/routes/trips/[slug]/today/+page.server.js
git commit -m "feat(capture): expose editable (planning stage) from Today loader"
```

---

## Task 9: Capture row on TodayStopCard

**Files:**
- Modify: `src/lib/components/TodayStopCard.svelte`

The card gains an `editable` prop and a capture row. When `editable`, it renders interactive Visited/Skip toggles + a note affordance that PATCH the stop endpoint optimistically. When not editable (completed trip / offline), it renders captured `status`/`note` read-only.

- [ ] **Step 1: Add props + local capture state to the `<script>`**

In `src/lib/components/TodayStopCard.svelte`, extend the `$props()` destructure and add state/handlers:

```js
  let {
    stop,
    destination,
    number,
    isFirst = false,
    editable = false,
    slug = '',
  } = $props();

  // Optimistic local capture state, seeded from the stop.
  let status = $state(stop.status ?? null);
  let note = $state(stop.note ?? '');
  let noteOpen = $state(false);
  let saving = $state(false);

  async function patchCapture(patch) {
    saving = true;
    try {
      const res = await fetch(`/api/capture/${encodeURIComponent(slug)}/stops/${encodeURIComponent(stop.id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error('capture failed');
    } catch {
      // Roll back to the server-known values on failure.
      status = stop.status ?? null;
      note = stop.note ?? '';
    } finally {
      saving = false;
    }
  }

  function toggleStatus(next) {
    const value = status === next ? null : next; // tapping the active one clears it
    status = value;                              // optimistic
    stop.status = value ?? undefined;
    patchCapture({ status: value });
  }

  function saveNote() {
    if (note === (stop.note ?? '')) return;      // no change
    stop.note = note || undefined;
    patchCapture({ note });
  }
```

Note: `stop.id` must be present — Task 4 already projects it (`id: c.id`) alongside `status`/`note`. The capture row depends on it.

- [ ] **Step 2: Render the capture row**

After the `<div class="actions">…</div>` block (the Navigate/Call/Site row, ~line 126) and before the tips/todos `{#if hasDisclosure}` block, add:

```svelte
  {#if editable}
    <div class="capture-row">
      <div class="status-toggles" role="group" aria-label="Mark this stop">
        <button
          type="button"
          class="status-btn"
          class:active={status === 'visited'}
          aria-pressed={status === 'visited'}
          disabled={saving}
          onclick={() => toggleStatus('visited')}
        >✓ Visited</button>
        <button
          type="button"
          class="status-btn"
          class:active={status === 'skipped'}
          aria-pressed={status === 'skipped'}
          disabled={saving}
          onclick={() => toggleStatus('skipped')}
        >⤫ Skip</button>
      </div>
      {#if noteOpen || note}
        <textarea
          class="note-input"
          bind:value={note}
          maxlength="2000"
          placeholder="Jot a note…"
          aria-label="Note for {stop.name}"
          onblur={saveNote}
        ></textarea>
      {:else}
        <button type="button" class="note-add" onclick={() => (noteOpen = true)}>✎ Add a note</button>
      {/if}
    </div>
  {:else if stop.status || stop.note}
    <div class="capture-readonly">
      {#if stop.status}<span class="status-badge status-badge--{stop.status}">{stop.status === 'visited' ? '✓ Visited' : '⤫ Skipped'}</span>{/if}
      {#if stop.note}<p class="note-readonly">{stop.note}</p>{/if}
    </div>
  {/if}
```

- [ ] **Step 3: Reflect status on the card header (subtle)**

Change the `<article>` opening tag to carry the status as a data attribute for styling:

```svelte
<article
  class="stop-card"
  class:first={isFirst}
  data-category={cat}
  data-status={editable ? status : (stop.status ?? null)}
  aria-label="Stop {number}: {stop.name}"
>
```

- [ ] **Step 4: Add styles**

In the `<style>` block, add (using tokens — no raw literals except where the file already does):

```css
  .capture-row {
    margin-top: 12px;
    border-top: 1px dashed var(--border-subtle);
    padding-top: 10px;
    display: grid;
    gap: 8px;
  }
  .status-toggles { display: flex; gap: 8px; }
  .status-btn {
    flex: 1;
    min-height: 44px;
    border-radius: 11px;
    border: 1px solid var(--border-default);
    background: var(--surface-raised);
    color: var(--text-secondary);
    font-family: var(--font-sans);
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
  }
  .status-btn.active {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--text-inverse);
  }
  .status-btn:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
  .note-add {
    align-self: flex-start;
    background: none;
    border: none;
    color: var(--accent-text);
    font-family: var(--font-sans);
    font-size: 13.5px;
    font-weight: 600;
    cursor: pointer;
    min-height: 44px;
  }
  .note-input {
    width: 100%;
    min-height: 60px;
    border-radius: 11px;
    border: 1px solid var(--border-default);
    background: var(--surface-page);
    color: var(--text-primary);
    font-family: var(--font-sans);
    font-size: 14px;
    padding: 8px 10px;
    resize: vertical;
  }
  .capture-readonly { margin-top: 12px; border-top: 1px dashed var(--border-subtle); padding-top: 10px; }
  .status-badge {
    display: inline-block;
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    padding: 4px 8px;
    border-radius: 6px;
    background: var(--surface-sunken);
    color: var(--text-tertiary);
  }
  .note-readonly { margin: 8px 0 0; font-size: 13.5px; color: var(--text-secondary); }
  .stop-card[data-status="skipped"] .stop-name { text-decoration: line-through; color: var(--text-tertiary); }
  .stop-card[data-status="visited"] .num-marker { box-shadow: inset 0 0 0 2px var(--state-success); }
```

- [ ] **Step 5: Verify**

Run: `npm run check`
Expected: 0 errors, 0 warnings.

- [ ] **Step 6: Commit**

```bash
git add src/lib/components/TodayStopCard.svelte
git commit -m "feat(capture): capture row (visited/skip + note) on TodayStopCard"
```

---

## Task 10: Wire the Today page (editable cards + day-notes field)

**Files:**
- Modify: `src/routes/trips/[slug]/today/+page.svelte`

- [ ] **Step 1: Pass `editable` + `slug` to each card**

In the stops `{#each}` block, update the `<TodayStopCard>` usage:

```svelte
            <TodayStopCard
              {stop}
              destination={data.destination}
              number={i + 1}
              isFirst={i === 0}
              editable={data.editable}
              slug={data.trip._slug}
            />
```

- [ ] **Step 2: Add a Day-notes field after the Tonight section**

Add this in the `<script>` (after the existing derived state):

```js
  let dayLog = $state(data.day.log ?? '');
  let savingLog = $state(false);

  async function saveDayLog() {
    if (dayLog === (data.day.log ?? '')) return;
    savingLog = true;
    try {
      const res = await fetch(`/api/capture/${encodeURIComponent(data.trip._slug)}/days/${data.selectedDay}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ note: dayLog }),
      });
      if (!res.ok) throw new Error('failed');
      data.day.log = dayLog || null;
    } catch {
      dayLog = data.day.log ?? '';
    } finally {
      savingLog = false;
    }
  }
```

Then, after the lodging `{#if data.day.lodging}…{/if}` block (and before the Field-guide block), add:

```svelte
      {#if data.editable}
        <div class="section-label" aria-hidden="true">Day notes</div>
        <textarea
          class="day-log"
          bind:value={dayLog}
          maxlength="2000"
          placeholder="Anything about today…"
          aria-label="Notes for this day"
          onblur={saveDayLog}
        ></textarea>
      {:else if data.day.log}
        <div class="section-label" aria-hidden="true">Day notes</div>
        <p class="day-log-readonly">{data.day.log}</p>
      {/if}
```

Note: because `dayLog` is seeded from `data.day.log` at module init, it must reset when the selected day changes. Add a reactive reset:

```js
  $effect(() => { dayLog = data.day.log ?? ''; });
```

- [ ] **Step 3: Add styles**

In the `<style>` block:

```css
  .day-log {
    width: 100%;
    min-height: 72px;
    border-radius: 14px;
    border: 1px solid var(--border-default);
    background: var(--surface-raised);
    color: var(--text-primary);
    font-family: var(--font-sans);
    font-size: 14px;
    padding: 12px;
    resize: vertical;
  }
  .day-log:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
  .day-log-readonly {
    background: var(--surface-raised);
    border: 1px solid var(--border-subtle);
    border-radius: 14px;
    padding: 12px;
    font-size: 14px;
    color: var(--text-secondary);
    margin: 0;
  }
```

- [ ] **Step 4: Verify**

Run: `npm run check`
Expected: 0 errors, 0 warnings.

- [ ] **Step 5: Commit**

```bash
git add src/routes/trips/[slug]/today/+page.svelte
git commit -m "feat(capture): wire editable cards + day-notes field on Today page"
```

---

## Task 11: Read-only capture in the offline bundle (separable)

**Files:**
- Modify: `src/lib/server/render-offline-today.js`
- Test: `tests/render-offline-today.test.js` (extend)

This is the spec's separable piece — the offline bundle shows captured status/note read-only (no controls). The offline endpoint already passes `brochure.days` (which now carry `status`/`note`) through `normalizeDayCoords`, so the view-model stops include them.

- [ ] **Step 1: Add a failing test**

Add to `tests/render-offline-today.test.js`, inside the `describe('renderOfflineToday', …)` block:

```js
  it('renders captured status + note read-only', () => {
    const vm = sampleVM();
    vm.days[0].stops[0].status = 'visited';
    vm.days[0].stops[0].note = 'Closed early';
    const html = renderOfflineToday(vm);
    expect(html).toContain('Visited');
    expect(html).toContain('Closed early');
    expect(html).not.toContain('Add a note'); // no controls in the bundle
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- render-offline-today`
Expected: FAIL — status/note are not rendered.

- [ ] **Step 3: Render captured state in `renderStop`**

In `src/lib/server/render-offline-today.js`, in `renderStop`, after the `disclosure` is built and before the final `return`, add a read-only capture block and include it in the returned markup:

```js
  let captured = '';
  if (stop.status || stop.note) {
    const badge = stop.status
      ? `<span class="status-badge">${stop.status === 'visited' ? '✓ Visited' : '⤫ Skipped'}</span>`
      : '';
    const noteHtml = stop.note ? `<p class="note-readonly">${esc(stop.note)}</p>` : '';
    captured = `<div class="capture-readonly">${badge}${noteHtml}</div>`;
  }
```

Then add `captured` into the returned template, right after `disclosure`:

```js
    disclosure +
    captured +
    `</article>`
```

Add to the `STYLE` constant:

```
.capture-readonly{margin-top:12px;border-top:1px dashed #DCD2BC;padding-top:10px}
.status-badge{display:inline-block;font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;padding:4px 8px;border-radius:6px;background:#EBE0C9;color:#5F5341}
.note-readonly{margin:8px 0 0;font-size:13.5px;color:#2D5840}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- render-offline-today`
Expected: PASS (existing cases still green, including the no-external-subresources invariant).

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/render-offline-today.js tests/render-offline-today.test.js
git commit -m "feat(capture): show captured status/note read-only in offline bundle"
```

---

## Task 12: Full verification

- [ ] **Step 1: Run the full go/no-go**

Run: `npm run verify`
Expected: svelte-check 0/0, all tests pass (new suites: `capture-io`, `capture-endpoint`, `retro-capture`, plus extended `derive-brochure`, `realize-plan`, `render-offline-today`), build succeeds.

- [ ] **Step 2: Manual QA (Playwright MCP)** — execute the spec's **Manual QA pass** checklist (`docs/superpowers/specs/2026-06-08-in-trip-capture-design.md`): mark visited/skip, jot a stop note + day note, reload → persists; offline bundle shows capture read-only; complete the trip → retro reflects capture and `notes.md` has `## In-trip notes`. Mechanics in `docs/manual-qa.md` (test port ≠ 3456, `npm run seed-sample`, phone viewport).

- [ ] **Step 3: Finish** — use superpowers:finishing-a-development-branch to open the PR.

---

## Self-Review

**Spec coverage:**
- Per-stop visited/skipped + note → Tasks 1, 5, 9. ✓
- Per-day note (`log`) → Tasks 2, 5, 10. ✓
- Piggyback storage (candidates/plan) → Tasks 1, 2. ✓
- Preserve across re-research → Task 3. ✓
- Project to Today → Task 4 (+ `id` for the write path). ✓
- Online-only, planning-stage, Instant Inline, error codes → Task 5. ✓
- Capture UX = dedicated row → Task 9; day-notes field → Task 10. ✓
- Read-only on completed → Tasks 9/10 (`editable` false branch) + loader Task 8. ✓
- Retro grounds AI + verbatim section → Tasks 6, 7. ✓
- Offline bundle read-only display → Task 11 (separable). ✓
- Testing + Manual QA → per-task tests + Task 12. ✓
- Edge cases (clear status, skipped still shown, empty capture, deleted stop, over-length) → Tasks 1/5/6 tests. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code. The one cross-task dependency (projecting `id` in deriveBrochure for the write path) is called out explicitly in Task 9 Step 1 and must be folded into Task 4. ✓

**Type/name consistency:** `setStopCapture(slug, stopId, {status, note})`, `setDayLog(slug, dayNumber, log)`, `buildCaptureContext({plan, candidates}) → {promptBlock, verbatimSection}`, stop fields `status`/`note`, day field `log`, projection `status ?? null`/`note ?? null`/`log ?? null`, `editable` prop, `/api/capture/[slug]/stops/[id]` + `/days/[number]` — all consistent across tasks. ✓

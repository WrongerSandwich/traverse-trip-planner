# Per-Stop To-Dos & Instructions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-generate, per promoted stop, a short list of read-only tips and a checkable pre-trip to-do list during planning, surfaced on the Plan day-cards, a trip-prep roll-up, and the printable brochure.

**Architecture:** A new `stop-prep` Ambient Background job runs last in the post-deepen chain (`deepen → geocode-candidates → enrich-candidates → stop-prep`). It makes one `chat()` call per visible promoted-or-poolable stop — no web search — grounded in a `tripContext` string (logistics.md body + plan gotchas + field-guide notes) read once at job start. Results are two flat optional fields on each candidate stop: `tips: string[]` (read-only) and `todos: [{id, text, done}]` (checkable). The fields round-trip through the existing candidates.yaml parser/serializer unchanged; only a new `setTodoDone` mutator and a todo-toggle PATCH endpoint are added. `realizePlan()` preserves both fields forward by candidate id across re-research.

**Tech Stack:** SvelteKit + Svelte 5 runes, Node ESM, vitest. AI via `chat()` (`src/lib/server/ai.js`); jobs via `src/lib/server/jobs.js`; YAML via the existing candidates/plan I/O modules.

---

## File Structure

**New files:**
- `src/lib/server/stop-prep-job.js` — the job: builds work list, reads tripContext once, one `chat()` per stop, validates, writes back. Mirrors `enrich-job.js`.
- `src/routes/api/actions/stop-prep/[slug]/+server.js` — `_startStopPrepJob` launcher + POST trigger. Mirrors the enrich-candidates endpoint. Exports `_promise`.
- `src/routes/api/candidates/[slug]/stops/[id]/todos/[todoId]/+server.js` — PATCH `{done:boolean}` → `setTodoDone`. Mirrors the hidden-toggle PATCH.
- `tests/stop-prep-job.test.js` — job unit tests (mirrors `enrich-job.test.js`).
- `tests/api-stop-prep-chain.test.js` — enrich→stop-prep chaining test (mirrors `api-geocode-candidates-chain.test.js`).
- `tests/api-candidates-todos.test.js` — todo-toggle PATCH route test (mirrors `api-candidates-mutations.test.js`).

**Modified files:**
- `src/lib/server/config.js` — add `'stop-prep': 'modelDefault'` to `FEATURE_SLOT`.
- `src/lib/server/promises.js` — add `MAX_TOKENS['stop-prep']` + `HAND_DEFAULTS['stop-prep']`.
- `src/lib/errors-registry.js` — add `stop_prep_all_failed`.
- `src/lib/components/BackgroundJobsIndicator.svelte` — add label + estimate.
- `src/lib/server/candidates.js` — add `setTodoDone` mutator.
- `src/lib/server/realize-plan.js` — preserve `tips`/`todos` forward by id.
- `src/routes/api/actions/enrich-candidates/[slug]/+server.js` — chain to `_startStopPrepJob` after completeJob.
- `src/lib/components/StopCard.svelte` — render tips + todos in compact mode.
- `src/lib/components/PlanSection.svelte` — roll-up panel, `toggleTodo`, `startStopPrep`, wire `onToggleTodo`.
- `src/lib/server/derive-brochure.js` — project `tips`/`todos` in both stop projections.
- `src/lib/components/Brochure.svelte` — render tips + todos per stop.
- `docs/superpowers/specs/2026-05-22-planning-plan-and-candidates-design.md` — document the two new stop fields.
- `CHANGELOG.md` — entry under Unreleased.
- `tests/candidates-io.test.js`, `tests/realize-plan.test.js`, `tests/derive-brochure.test.js` — extend.

---

## Task 1: Plumbing constants

Adds the four registry/config entries the job and UI depend on. No behavior yet — just constants — so this task ends with a tiny assertion test that proves they're wired and shape-valid.

**Files:**
- Modify: `src/lib/server/config.js` (FEATURE_SLOT block)
- Modify: `src/lib/server/promises.js` (MAX_TOKENS + HAND_DEFAULTS)
- Modify: `src/lib/errors-registry.js` (ERROR_REGISTRY)
- Modify: `src/lib/components/BackgroundJobsIndicator.svelte` (WORKFLOW_LABELS + ESTIMATES_S)
- Test: `tests/stop-prep-constants.test.js` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/stop-prep-constants.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { HAND_DEFAULTS, MAX_TOKENS } from '../src/lib/server/promises.js';
import { ERROR_REGISTRY } from '../src/lib/errors-registry.js';

describe('stop-prep constants', () => {
  it('MAX_TOKENS has a stop-prep budget', () => {
    expect(MAX_TOKENS['stop-prep']).toBeGreaterThan(0);
  });

  it('HAND_DEFAULTS has a shape-valid stop-prep promise', () => {
    const p = HAND_DEFAULTS['stop-prep'];
    expect(p).toBeTruthy();
    expect(typeof p.verb).toBe('string');
    expect(p.verb.trim()).not.toBe('');
    expect(typeof p.produces).toBe('string');
    expect(p.produces.trim()).not.toBe('');
    expect(Number.isFinite(p.time_seconds)).toBe(true);
    expect(p.time_seconds).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(p.tokens_range)).toBe(true);
    expect(p.tokens_range).toHaveLength(2);
    expect(p.tokens_range[0]).toBeGreaterThanOrEqual(0);
    expect(p.tokens_range[1]).toBeGreaterThanOrEqual(p.tokens_range[0]);
  });

  it('ERROR_REGISTRY has stop_prep_all_failed', () => {
    expect(ERROR_REGISTRY.stop_prep_all_failed).toBeTruthy();
    expect(typeof ERROR_REGISTRY.stop_prep_all_failed.sentence).toBe('string');
    expect(Array.isArray(ERROR_REGISTRY.stop_prep_all_failed.affordances)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/stop-prep-constants.test.js`
Expected: FAIL — `MAX_TOKENS['stop-prep']` is undefined / `HAND_DEFAULTS['stop-prep']` is undefined / `ERROR_REGISTRY.stop_prep_all_failed` is undefined.

- [ ] **Step 3: Add the FEATURE_SLOT entry**

In `src/lib/server/config.js`, find the `FEATURE_SLOT` object (the entry `'enrich-candidates': 'modelDefault',`) and add the `stop-prep` line directly after it:

```js
  'enrich-candidates': 'modelDefault',
  'stop-prep': 'modelDefault',
```

Do NOT add `stop-prep` to the `searchDependent` set — the job makes no web-search call.

- [ ] **Step 4: Add the token budget and hand-default promise**

In `src/lib/server/promises.js`, find the `MAX_TOKENS` object entry `'enrich-candidates': 1500,` and add after it:

```js
  'enrich-candidates': 1500,
  'stop-prep': 1500,
```

Then find the `HAND_DEFAULTS` object entry for `'enrich-candidates'` and add a sibling entry after it:

```js
  'stop-prep': {
    verb: 'Prep stops',
    produces: 'Pre-trip to-dos and in-trip tips for each promoted stop. Runs in the background after enrichment completes.',
    time_seconds: 60,
    tokens_range: [2000, 9000],
  },
```

- [ ] **Step 5: Add the error-registry entry**

In `src/lib/errors-registry.js`, find the `enrich_all_failed` entry in `ERROR_REGISTRY` and add after it:

```js
  stop_prep_all_failed: {
    sentence:
      "Couldn't prep any of the stops — try again, or check the server log if it keeps happening.",
    affordances: ['retry', 'dismiss'],
  },
```

- [ ] **Step 6: Add the background-jobs label and estimate**

In `src/lib/components/BackgroundJobsIndicator.svelte`, find `WORKFLOW_LABELS` (it contains `'enrich-candidates': 'Enrich',`) and add:

```js
  'enrich-candidates': 'Enrich',
  'stop-prep': 'Prep',
```

Then find `ESTIMATES_S` (it contains `'enrich-candidates': 90,`) and add:

```js
  'enrich-candidates': 90,
  'stop-prep': 60,
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run tests/stop-prep-constants.test.js`
Expected: PASS (3 tests).

- [ ] **Step 8: Commit**

```bash
git add src/lib/server/config.js src/lib/server/promises.js src/lib/errors-registry.js src/lib/components/BackgroundJobsIndicator.svelte tests/stop-prep-constants.test.js
git commit -m "feat(stop-prep): register feature slot, promise, error, and job label"
```

---

## Task 2: `setTodoDone` mutator + tips/todos round-trip

The two new fields round-trip through the existing YAML parser/serializer with no change (stop objects are passed verbatim). This task proves that and adds the `setTodoDone` mutator the toggle endpoint needs.

**Files:**
- Modify: `src/lib/server/candidates.js` (add `setTodoDone`)
- Test: `tests/candidates-io.test.js` (extend)

- [ ] **Step 1: Write the failing tests**

In `tests/candidates-io.test.js`, add a new `describe` block at the end of the file (before the final closing brace of the module if there is one — these are top-level `describe`s, so append after the last one). Use the file's existing `writeCandidates`/`readCandidates` imports and the `ROOT`-based mock already in place:

```js
describe('tips/todos round-trip + setTodoDone', () => {
  it('preserves tips and todos (with done flags) through write/read', () => {
    const slug = 'prep-roundtrip';
    writeCandidates(slug, {
      stops: [
        {
          id: 'a',
          name: 'Place A',
          category: 'misc',
          tips: ['Arrive before 9am', 'Bring cash'],
          todos: [
            { id: 't1', text: 'Book timed-entry ticket', done: false },
            { id: 't2', text: 'Download offline map', done: true },
          ],
        },
      ],
      lodging: [],
    });

    const back = readCandidates(slug);
    expect(back.stops[0].tips).toEqual(['Arrive before 9am', 'Bring cash']);
    expect(back.stops[0].todos).toEqual([
      { id: 't1', text: 'Book timed-entry ticket', done: false },
      { id: 't2', text: 'Download offline map', done: true },
    ]);
  });

  it('setTodoDone flips a todo and returns the stop', () => {
    const slug = 'prep-toggle';
    writeCandidates(slug, {
      stops: [
        {
          id: 'a',
          name: 'A',
          category: 'misc',
          todos: [{ id: 't1', text: 'x', done: false }],
        },
      ],
      lodging: [],
    });

    const updated = setTodoDone(slug, 'a', 't1', true);
    expect(updated).toBeTruthy();
    expect(updated.todos[0].done).toBe(true);
    expect(readCandidates(slug).stops[0].todos[0].done).toBe(true);

    setTodoDone(slug, 'a', 't1', false);
    expect(readCandidates(slug).stops[0].todos[0].done).toBe(false);
  });

  it('setTodoDone returns null for unknown stop or todo', () => {
    const slug = 'prep-missing';
    writeCandidates(slug, {
      stops: [{ id: 'a', name: 'A', category: 'misc', todos: [{ id: 't1', text: 'x', done: false }] }],
      lodging: [],
    });

    expect(setTodoDone(slug, 'nope', 't1', true)).toBeNull();
    expect(setTodoDone(slug, 'a', 'nope', true)).toBeNull();
  });
});
```

Add `setTodoDone` to the existing import from `'../src/lib/server/candidates.js'` at the top of the test file.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/candidates-io.test.js`
Expected: FAIL — `setTodoDone is not a function` (import is undefined). The round-trip test alone would pass, but the suite fails on the import error, which is the signal to implement.

- [ ] **Step 3: Implement `setTodoDone`**

In `src/lib/server/candidates.js`, add after the existing `setCandidateHidden` function:

```js
/**
 * Toggle the `done` flag on one todo of one candidate stop.
 * Returns the mutated stop, or null if the stop or todo can't be found.
 */
export function setTodoDone(slug, stopId, todoId, done) {
  const cands = loadOrInit(slug);
  const stop = cands.stops.find((s) => s.id === stopId);
  if (!stop || !Array.isArray(stop.todos)) return null;
  const todo = stop.todos.find((t) => t.id === todoId);
  if (!todo) return null;
  todo.done = done === true;
  writeCandidates(slug, cands);
  return stop;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/candidates-io.test.js`
Expected: PASS (all existing tests plus the 3 new ones).

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/candidates.js tests/candidates-io.test.js
git commit -m "feat(stop-prep): add setTodoDone mutator; cover tips/todos round-trip"
```

---

## Task 3: Preserve tips/todos forward in `realizePlan`

Re-running Research must not wipe a stop's tips/todos (and must keep check-offs). `realizePlan` already preserves coords by id; this extends that to the two prep fields, for researcher-produced stops.

**Files:**
- Modify: `src/lib/server/realize-plan.js` (near the coords preserve-forward block)
- Test: `tests/realize-plan.test.js` (extend)

- [ ] **Step 1: Write the failing tests**

In `tests/realize-plan.test.js`, add tests inside the existing top-level `describe`. Use the file's existing `makeExtract({plan, candidates})` helper and the `readCandidates`/`readPlan` mock overrides:

```js
  it('carries tips/todos forward by id when re-researching', async () => {
    readCandidates.mockReturnValueOnce({
      stops: [
        {
          id: 'stop-a',
          name: 'Place A',
          category: 'misc',
          tips: ['Old tip'],
          todos: [{ id: 't1', text: 'Book ticket', done: true }],
        },
      ],
      lodging: [],
    });
    readPlan.mockReturnValueOnce(null);

    await realizePlan('trip', makeExtract({
      candidates: {
        stops: [{ id: 'stop-a', name: 'Place A', category: 'misc' }],
        lodging: [],
      },
    }));

    const stop = capturedCands.stops.find((s) => s.id === 'stop-a');
    expect(stop.tips).toEqual(['Old tip']);
    expect(stop.todos).toEqual([{ id: 't1', text: 'Book ticket', done: true }]);
  });

  it('drops tips/todos when the stop id disappears', async () => {
    readCandidates.mockReturnValueOnce({
      stops: [{ id: 'gone', name: 'Old', category: 'misc', tips: ['x'] }],
      lodging: [],
    });
    readPlan.mockReturnValueOnce(null);

    await realizePlan('trip', makeExtract({
      candidates: {
        stops: [{ id: 'fresh', name: 'New', category: 'misc' }],
        lodging: [],
      },
    }));

    const fresh = capturedCands.stops.find((s) => s.id === 'fresh');
    expect(fresh.tips).toBeUndefined();
    expect(fresh.todos).toBeUndefined();
  });

  it('does not fabricate tips/todos for a deepen-only run', async () => {
    readCandidates.mockReturnValueOnce(null);
    readPlan.mockReturnValueOnce(null);

    await realizePlan('trip', makeExtract({
      candidates: {
        stops: [{ id: 'stop-a', name: 'A', category: 'misc' }],
        lodging: [],
      },
    }));

    const stop = capturedCands.stops.find((s) => s.id === 'stop-a');
    expect(stop.tips).toBeUndefined();
    expect(stop.todos).toBeUndefined();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/realize-plan.test.js`
Expected: FAIL — the first test fails because `stop.tips`/`stop.todos` are undefined (not yet preserved).

- [ ] **Step 3: Implement preserve-forward**

In `src/lib/server/realize-plan.js`, find the coords preserve-forward block that builds `priorCoordsById` from `existingCands.stops`. Add the prep preserve-forward immediately after that block (same `existingCands` source, applied to researcher stops only — before the user-added stops are pushed):

```js
  const priorPrepById = new Map();
  for (const s of existingCands.stops ?? []) {
    if (s.id && (s.tips || s.todos)) {
      priorPrepById.set(s.id, { tips: s.tips, todos: s.todos });
    }
  }
  for (const c of cands.stops) {
    const prior = priorPrepById.get(c.id);
    if (prior) {
      if (prior.tips) c.tips = prior.tips;
      if (prior.todos) c.todos = prior.todos;
    }
  }
```

> Note: user-added stops are pushed later via `cands.stops.push({ ...u, id: idToUse })`, so they carry their own `tips`/`todos` through the spread automatically — no extra handling needed.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/realize-plan.test.js`
Expected: PASS (all existing plus the 3 new tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/realize-plan.js tests/realize-plan.test.js
git commit -m "feat(stop-prep): preserve tips/todos forward by id across re-research"
```

---

## Task 4: The `stop-prep` job

One `chat()` per visible stop, no web search, grounded in a `tripContext` read once at job start. Mirrors `enrich-job.js` but: reads tripContext once; skips when a stop already has `tips` (unless `force`); both-empty-after-validation counts as a per-stop failure; wraps model todo strings as `{id, text, done:false}`.

**Files:**
- Create: `src/lib/server/stop-prep-job.js`
- Test: `tests/stop-prep-job.test.js` (create)

- [ ] **Step 1: Write the failing tests**

Create `tests/stop-prep-job.test.js` (mirrors `enrich-job.test.js`; note there are NO search mocks because the job passes no tools):

```js
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const mockChat = vi.hoisted(() => vi.fn());

vi.mock('../src/lib/server/ai.js', () => ({ chat: mockChat }));

let ROOT;

vi.mock('$lib/server/data.js', async () => {
  const actual = await vi.importActual('$lib/server/data.js');
  return {
    ...actual,
    findTripFile: (slug) => {
      const p = join(ROOT, 'planning', slug, 'overview.md');
      return existsSync(p) ? p : null;
    },
    findTripLocation: (slug) => {
      const path = join(ROOT, 'planning', slug);
      return existsSync(path) ? { kind: 'dir', path, stage: 'planning' } : null;
    },
    parseFrontmatter: actual.parseFrontmatter,
  };
});

vi.mock('$lib/server/config.js', () => ({
  getEffectiveConfig: () => ({
    features: { 'stop-prep': { provider: 'anthropic', model: 'test-model' } },
  }),
  getFeatureAvailability: () => ({ homeMdReady: true }),
}));

import { stopPrepJob } from '../src/lib/server/stop-prep-job.js';
import { readCandidates } from '../src/lib/server/candidates.js';

function seedTrip(slug, stopsYaml, { logistics = 'Parking is tight downtown.', plan = null } = {}) {
  const dir = join(ROOT, 'planning', slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'overview.md'),
    '---\ntitle: T\nstatus: planning\ndestination: Empire MI\n---\n',
  );
  writeFileSync(join(dir, 'logistics.md'), logistics);
  writeFileSync(join(dir, 'candidates.yaml'), `stops:\n${stopsYaml}lodging: []\n`);
  if (plan) writeFileSync(join(dir, 'plan.yaml'), plan);
}

function mockPrepReturn(yaml) {
  mockChat.mockResolvedValueOnce({
    text: `<prep>\n${yaml}\n</prep>`,
    usage: { input: 100, output: 50 },
  });
}

beforeEach(() => {
  ROOT = mkdtempSync(join(tmpdir(), 'stop-prep-'));
  vi.clearAllMocks();
});

afterEach(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

describe('stopPrepJob', () => {
  test('happy path — writes tips + wrapped todos for a stop', async () => {
    const slug = 'prep-rt';
    seedTrip(slug, '  - id: a\n    name: Place A\n    category: misc\n');
    mockPrepReturn(
      'tips:\n  - "Arrive before 9am"\n  - "Bring water"\ntodos:\n  - "Book timed-entry ticket"\n  - "Download offline map"',
    );

    const result = await stopPrepJob(slug);

    const cands = readCandidates(slug);
    expect(cands.stops[0].tips).toEqual(['Arrive before 9am', 'Bring water']);
    expect(cands.stops[0].todos).toHaveLength(2);
    expect(cands.stops[0].todos[0]).toMatchObject({ text: 'Book timed-entry ticket', done: false });
    expect(cands.stops[0].todos[0].id).toBeTruthy();
    expect(result).toMatchObject({ prepped: 1, attempted: 1, failed: 0, skipped: 0 });
    expect(mockChat).toHaveBeenCalledOnce();
  });

  test('passes no tools to chat() and includes trip context in the prompt', async () => {
    const slug = 'prep-ctx';
    seedTrip(slug, '  - id: a\n    name: A\n    category: misc\n', {
      logistics: 'UNIQUE_LOGISTICS_MARKER parking note.',
    });
    mockPrepReturn('tips:\n  - "t"\ntodos: []');

    await stopPrepJob(slug);

    const call = mockChat.mock.calls[0][0];
    expect(call.tools).toBeUndefined();
    const userMsg = call.messages.map((m) => m.content).join('\n');
    expect(userMsg).toContain('UNIQUE_LOGISTICS_MARKER');
  });

  test('reads trip context once even across multiple stops', async () => {
    const slug = 'prep-once';
    seedTrip(slug,
      '  - id: a\n    name: A\n    category: misc\n' +
      '  - id: b\n    name: B\n    category: misc\n',
      { logistics: 'CTX_MARKER' });
    mockPrepReturn('tips:\n  - "t1"\ntodos: []');
    mockPrepReturn('tips:\n  - "t2"\ntodos: []');

    await stopPrepJob(slug);

    expect(mockChat).toHaveBeenCalledTimes(2);
    for (const call of mockChat.mock.calls) {
      const userMsg = call[0].messages.map((m) => m.content).join('\n');
      expect(userMsg).toContain('CTX_MARKER');
    }
  });

  test('skips a stop that already has tips (no force)', async () => {
    const slug = 'prep-skip';
    seedTrip(slug,
      '  - id: a\n    name: A\n    category: misc\n    tips:\n      - "already prepped"\n');

    const result = await stopPrepJob(slug);

    expect(mockChat).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
    expect(result.prepped).toBe(0);
  });

  test('force re-runs even when tips already exist', async () => {
    const slug = 'prep-force';
    seedTrip(slug,
      '  - id: a\n    name: A\n    category: misc\n    tips:\n      - "old"\n');
    mockPrepReturn('tips:\n  - "new"\ntodos: []');

    await stopPrepJob(slug, { force: true });

    expect(mockChat).toHaveBeenCalledOnce();
    expect(readCandidates(slug).stops[0].tips).toEqual(['new']);
  });

  test('skips hidden stops without calling chat()', async () => {
    const slug = 'prep-hidden';
    seedTrip(slug, '  - id: a\n    name: A\n    category: misc\n    hidden: true\n');

    const result = await stopPrepJob(slug);

    expect(mockChat).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
    expect(result.attempted).toBe(0);
  });

  test('caps tips at 5 and todos at 4', async () => {
    const slug = 'prep-caps';
    seedTrip(slug, '  - id: a\n    name: A\n    category: misc\n');
    mockPrepReturn(
      'tips:\n' + Array.from({ length: 8 }, (_, i) => `  - "tip${i}"`).join('\n') +
      '\ntodos:\n' + Array.from({ length: 8 }, (_, i) => `  - "todo${i}"`).join('\n'),
    );

    await stopPrepJob(slug);

    const stop = readCandidates(slug).stops[0];
    expect(stop.tips).toHaveLength(5);
    expect(stop.todos).toHaveLength(4);
  });

  test('both-empty result counts as a per-stop failure', async () => {
    const slug = 'prep-empty';
    seedTrip(slug, '  - id: a\n    name: A\n    category: misc\n');
    mockPrepReturn('tips: []\ntodos: []');

    await expect(stopPrepJob(slug)).rejects.toMatchObject({ code: 'stop_prep_all_failed' });
  });

  test('continues past a per-stop parse failure — partial success', async () => {
    const slug = 'prep-partial';
    seedTrip(slug,
      '  - id: a\n    name: A\n    category: misc\n' +
      '  - id: b\n    name: B\n    category: misc\n');
    mockChat.mockResolvedValueOnce({ text: 'NO TAGS', usage: { input: 10, output: 5 } });
    mockPrepReturn('tips:\n  - "ok"\ntodos: []');

    const result = await stopPrepJob(slug);

    const cands = readCandidates(slug);
    expect(cands.stops[0].tips).toBeUndefined();
    expect(cands.stops[1].tips).toEqual(['ok']);
    expect(result).toMatchObject({ attempted: 2, prepped: 1, failed: 1 });
  });

  test('aborts cleanly mid-loop — first stop prepped, second never attempted', async () => {
    const slug = 'prep-abort';
    seedTrip(slug,
      '  - id: a\n    name: A\n    category: misc\n' +
      '  - id: b\n    name: B\n    category: misc\n');
    const controller = new AbortController();
    mockChat.mockImplementationOnce(async () => {
      controller.abort();
      return { text: '<prep>\ntips:\n  - "first"\ntodos: []\n</prep>', usage: { input: 10, output: 5 } };
    });

    const result = await stopPrepJob(slug, { signal: controller.signal });

    const cands = readCandidates(slug);
    expect(cands.stops[0].tips).toEqual(['first']);
    expect(cands.stops[1].tips).toBeUndefined();
    expect(mockChat).toHaveBeenCalledOnce();
    expect(result.attempted).toBe(1);
    expect(result.prepped).toBe(1);
  });

  test('deletion between chat() resolve and write-back is a silent skip', async () => {
    const slug = 'prep-deleted';
    seedTrip(slug, '  - id: a\n    name: A\n    category: misc\n');
    mockChat.mockImplementationOnce(async () => {
      const path = join(ROOT, 'planning', slug, 'candidates.yaml');
      writeFileSync(path, 'stops: []\nlodging: []\n');
      return { text: '<prep>\ntips:\n  - "x"\ntodos: []\n</prep>', usage: { input: 10, output: 5 } };
    });

    const result = await stopPrepJob(slug);

    expect(result).toMatchObject({ attempted: 1, prepped: 0, failed: 0, skipped: 0 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/stop-prep-job.test.js`
Expected: FAIL — `Failed to import` / `stopPrepJob is not a function` (module doesn't exist yet).

- [ ] **Step 3: Implement the job**

Create `src/lib/server/stop-prep-job.js`:

```js
import { parse as yamlParse } from 'yaml';
import { chat } from './ai.js';
import { getEffectiveConfig } from './config.js';
import { findTripFile, findTripLocation, parseFrontmatter } from './data.js';
import { readCandidates, writeCandidates, makeCandidateId } from './candidates.js';
import { readPlan } from './plan.js';
import { MAX_TOKENS } from './promises.js';
import { TraverseError } from './errors.js';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const MAX_TIPS = 5;
const MAX_TODOS = 4;

/** Trip destination from overview frontmatter. */
function readDestination(slug) {
  const file = findTripFile(slug);
  if (!file) return '';
  const { frontmatter } = parseFrontmatter(readFileSync(file, 'utf8'));
  return frontmatter?.destination ?? '';
}

/**
 * Build the grounding context string once: logistics.md body + plan gotchas +
 * field-guide notes. Empty pieces are skipped.
 */
function readTripContext(slug) {
  const parts = [];
  const loc = findTripLocation(slug);
  if (loc) {
    const logisticsPath = join(loc.path, 'logistics.md');
    if (existsSync(logisticsPath)) {
      const body = readFileSync(logisticsPath, 'utf8').trim();
      if (body) parts.push(body);
    }
  }
  const plan = readPlan(slug);
  if (plan) {
    const gotchas = Array.isArray(plan.gotchas) ? plan.gotchas.filter(Boolean) : [];
    if (gotchas.length) parts.push('Gotchas:\n' + gotchas.map((g) => `- ${g}`).join('\n'));
    const notes = Array.isArray(plan.field_guide_notes) ? plan.field_guide_notes.filter(Boolean) : [];
    if (notes.length) parts.push('Field guide:\n' + notes.map((n) => `- ${n}`).join('\n'));
  }
  return parts.join('\n\n');
}

const SYSTEM = `You help a road-tripper prepare for a single stop on their trip.
Given the stop and trip context, produce:
- tips: 2 to 5 short read-only in-trip pointers (best entrance, where to park, what to bring, light timing). Each a terse phrase, no leading bullet.
- todos: 0 to 4 concrete pre-trip to-dos the traveler should check off before leaving (book tickets, reserve parking, confirm seasonal hours, download offline maps). Plain strings, actionable, no leading bullet.
Only include items that are genuinely useful for THIS stop. Omit filler.
Respond with a single YAML block wrapped in <prep></prep> tags, with keys "tips" and "todos", each a list of strings.`;

function buildUserMessage(stop, destination, tripContext) {
  const lines = [`Trip: ${destination}`];
  if (tripContext) lines.push(`Trip context:\n${tripContext}`);
  lines.push(`Stop: ${stop.name}${stop.category ? ` (${stop.category})` : ''}`);
  if (stop.description) lines.push(`Description: ${stop.description}`);
  if (stop.address) lines.push(`Address: ${stop.address}`);
  if (stop.hours) lines.push(`Hours: ${stop.hours}`);
  return lines.join('\n');
}

function extractPrep(text) {
  const m = text.match(/<prep>([\s\S]*?)<\/prep>/);
  if (!m) return null;
  let data;
  try {
    data = yamlParse(m[1]);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const tips = Array.isArray(data.tips)
    ? data.tips.map((t) => String(t).trim()).filter(Boolean).slice(0, MAX_TIPS)
    : [];
  const todoTexts = Array.isArray(data.todos)
    ? data.todos.map((t) => String(t).trim()).filter(Boolean).slice(0, MAX_TODOS)
    : [];
  return { tips, todoTexts };
}

/**
 * Generate per-stop tips + pre-trip todos for every visible candidate stop.
 * Returns { attempted, prepped, failed, skipped, tokens }.
 */
export async function stopPrepJob(slug, opts = {}) {
  const { force = false, signal } = opts;
  const destination = readDestination(slug);
  const tripContext = readTripContext(slug);

  const initial = readCandidates(slug);
  const stops = initial?.stops ?? [];

  const work = [];
  let skipped = 0;
  for (const stop of stops) {
    if (!stop?.id || !stop?.name) continue;
    if (stop.hidden) {
      skipped++;
      continue;
    }
    if (!force && Array.isArray(stop.tips) && stop.tips.length > 0) {
      skipped++;
      continue;
    }
    work.push(stop);
  }

  let attempted = 0;
  let prepped = 0;
  let failed = 0;
  let tokens = 0;

  const featureCfg = getEffectiveConfig().features['stop-prep'] ?? {};

  for (const item of work) {
    if (signal?.aborted) break;

    const fresh = readCandidates(slug);
    const target = fresh?.stops?.find((s) => s.id === item.id);
    if (!target) continue; // deleted mid-loop — silent skip

    attempted++;

    let res;
    try {
      res = await chat({
        ...featureCfg,
        system: SYSTEM,
        messages: [{ role: 'user', content: buildUserMessage(target, destination, tripContext) }],
        maxTokens: MAX_TOKENS['stop-prep'],
        label: 'stop-prep',
        signal,
      });
    } catch (e) {
      if (e?.name === 'AbortError' || signal?.aborted) break;
      failed++;
      continue;
    }

    tokens += (res?.usage?.input ?? 0) + (res?.usage?.output ?? 0);

    const parsed = extractPrep(res?.text ?? '');
    if (!parsed || (parsed.tips.length === 0 && parsed.todoTexts.length === 0)) {
      failed++;
      continue;
    }

    const fresh2 = readCandidates(slug);
    const writeTarget = fresh2?.stops?.find((s) => s.id === item.id);
    if (!writeTarget) continue; // deleted between resolve and write — silent skip

    const seen = new Set();
    writeTarget.tips = parsed.tips;
    writeTarget.todos = parsed.todoTexts.map((text) => ({
      id: makeCandidateId(text, seen),
      text,
      done: false,
    }));
    writeCandidates(slug, fresh2);
    prepped++;
  }

  if (attempted > 0 && prepped === 0 && failed > 0) {
    throw new TraverseError('stop_prep_all_failed', `All ${attempted} stop-prep attempts failed`);
  }

  return { attempted, prepped, failed, skipped, tokens };
}
```

> Verify before writing: confirm `makeCandidateId` accepts `(text, seenSet)` and `TraverseError` is constructed `new TraverseError(code, message)` by grepping `src/lib/server/candidates.js` and `src/lib/server/errors.js`. If `makeCandidateId`'s second arg is an array of existing ids rather than a Set, build `const seen = []` and pass it instead (the enrich/realize code is the reference).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/stop-prep-job.test.js`
Expected: PASS (all listed tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/stop-prep-job.js tests/stop-prep-job.test.js
git commit -m "feat(stop-prep): add per-stop prep job (tips + pre-trip todos)"
```

---

## Task 5: stop-prep endpoint + chain from enrich

Adds the `_startStopPrepJob` launcher + POST trigger, and chains it from the enrich-candidates endpoint's success path so the post-deepen chain terminates with stop-prep.

**Files:**
- Create: `src/routes/api/actions/stop-prep/[slug]/+server.js`
- Modify: `src/routes/api/actions/enrich-candidates/[slug]/+server.js` (chain call)
- Test: `tests/api-stop-prep-chain.test.js` (create)

- [ ] **Step 1: Write the failing chain test**

Create `tests/api-stop-prep-chain.test.js` (mirrors `api-geocode-candidates-chain.test.js`). It mocks the stop-prep launcher and asserts the enrich endpoint fires it on success, but not on throw or abort:

```js
import { describe, test, expect, vi, beforeEach } from 'vitest';

const mockEnrichJob = vi.hoisted(() => vi.fn());
const mockStartStopPrep = vi.hoisted(() => vi.fn());
const mockStartJob = vi.hoisted(() => vi.fn(() => ({ id: 'job1' })));
const mockCompleteJob = vi.hoisted(() => vi.fn());
const mockFailJob = vi.hoisted(() => vi.fn());
const mockAssertNotRunning = vi.hoisted(() => vi.fn());

vi.mock('../src/lib/server/enrich-job.js', () => ({ enrichCandidatesJob: mockEnrichJob }));
vi.mock('../src/routes/api/actions/stop-prep/[slug]/+server.js', () => ({
  _startStopPrepJob: mockStartStopPrep,
}));
vi.mock('../src/lib/server/jobs.js', () => ({
  assertNotRunning: mockAssertNotRunning,
  startJob: mockStartJob,
  completeJob: mockCompleteJob,
  failJob: mockFailJob,
}));
vi.mock('../src/lib/utils/abort.js', () => ({ isAbort: (e) => e?.name === 'AbortError' }));

import { _startEnrichCandidatesJob } from '../src/routes/api/actions/enrich-candidates/[slug]/+server.js';

const tick = () => new Promise((r) => setTimeout(r, 50));

beforeEach(() => {
  vi.clearAllMocks();
  mockStartJob.mockReturnValue({ id: 'job1' });
});

describe('enrich → stop-prep chaining', () => {
  test('fires stop-prep after a successful enrich', async () => {
    mockEnrichJob.mockResolvedValueOnce({ enriched: 1, attempted: 1, failed: 0, skipped: 0, tokens: 10 });
    _startEnrichCandidatesJob('trip');
    await tick();
    expect(mockStartStopPrep).toHaveBeenCalledWith('trip');
  });

  test('does NOT fire stop-prep when enrich throws', async () => {
    mockEnrichJob.mockRejectedValueOnce(new Error('boom'));
    _startEnrichCandidatesJob('trip');
    await tick();
    expect(mockStartStopPrep).not.toHaveBeenCalled();
  });

  test('does NOT fire stop-prep when enrich aborts', async () => {
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    mockEnrichJob.mockRejectedValueOnce(abort);
    _startEnrichCandidatesJob('trip');
    await tick();
    expect(mockStartStopPrep).not.toHaveBeenCalled();
  });

  test('still fires stop-prep even if completeJob throws', async () => {
    mockEnrichJob.mockResolvedValueOnce({ enriched: 1, attempted: 1, failed: 0, skipped: 0, tokens: 10 });
    mockCompleteJob.mockImplementationOnce(() => { throw new Error('registry write failed'); });
    _startEnrichCandidatesJob('trip');
    await tick();
    expect(mockStartStopPrep).toHaveBeenCalledWith('trip');
  });
});
```

> Before writing, open `tests/api-geocode-candidates-chain.test.js` and match its exact mock surface for `jobs.js`, `abort.js`, `errors.js`, and `promises.js`. If that file also mocks `$lib/server/data.js`, `errors-registry.js`, or `promises.js`, replicate those mocks here so the endpoint module imports cleanly. Adjust the `assertNotRunning` mock to whatever return/throw contract the reference test uses (it returns nothing on success and throws `already_running` to block).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api-stop-prep-chain.test.js`
Expected: FAIL — cannot resolve `../src/routes/api/actions/stop-prep/[slug]/+server.js` (module doesn't exist) and `_startEnrichCandidatesJob` doesn't call `_startStopPrepJob` yet.

- [ ] **Step 3: Create the stop-prep endpoint**

Create `src/routes/api/actions/stop-prep/[slug]/+server.js` (mirrors the enrich-candidates endpoint — open that file and copy its structure exactly, swapping the job + labels). Template:

```js
import { json } from '@sveltejs/kit';
import { stopPrepJob } from '$lib/server/stop-prep-job.js';
import { assertNotRunning, startJob, completeJob, failJob } from '$lib/server/jobs.js';
import { isAbort } from '$lib/utils/abort.js';
import { getFeatureAvailability } from '$lib/server/config.js';
import { rejectInvalidSlug, rateLimitResponse } from '$lib/server/guards.js';
import { HAND_DEFAULTS } from '$lib/server/promises.js';

export const _promise = HAND_DEFAULTS['stop-prep'];

/**
 * Fire-and-forget launcher. Returns the job handle, or null if one is already
 * running for this slug. Safe to call from another endpoint's completion IIFE.
 */
export function _startStopPrepJob(slug, opts = {}) {
  try {
    assertNotRunning('stop-prep', slug);
  } catch {
    return null;
  }

  const job = startJob('stop-prep', slug, { est_seconds: _promise.time_seconds });

  (async () => {
    try {
      const result = await stopPrepJob(slug, opts);
      try {
        completeJob('stop-prep', slug, { tokens: result.tokens });
      } catch {
        // registry write failure is non-fatal
      }
    } catch (err) {
      if (isAbort(err)) return;
      failJob('stop-prep', slug, err);
    }
  })();

  return job;
}

export async function POST({ params, request }) {
  const { homeMdReady } = getFeatureAvailability();
  if (!homeMdReady) return json({ error: 'home_md_not_ready' }, { status: 412 });

  const bad = rejectInvalidSlug(params.slug);
  if (bad) return bad;

  const limited = rateLimitResponse(request);
  if (limited) return limited;

  let force = false;
  try {
    const body = await request.json();
    force = body?.force === true;
  } catch {
    // no body — default force=false
  }

  const job = _startStopPrepJob(params.slug, { force });
  if (!job) return json({ error: 'already_running' }, { status: 409 });

  return json({ ok: true, job_id: job.id }, { status: 202 });
}
```

> Open the enrich-candidates endpoint and reconcile every import path/guard name (`guards.js` helpers `rejectInvalidSlug`/`rateLimitResponse`, the `startJob` options key `est_seconds`, the `failJob` signature) against the real source. Use the enrich endpoint's exact forms; the above is structurally faithful but verify names. Do not add `stop-prep` to any cross-job "blocks" loop unless the enrich endpoint defines one for its own job — stop-prep is terminal, nothing chains off it.

- [ ] **Step 4: Wire the chain into the enrich endpoint**

In `src/routes/api/actions/enrich-candidates/[slug]/+server.js`, add the import near the top:

```js
import { _startStopPrepJob } from '../stop-prep/[slug]/+server.js';
```

Then, inside `_startEnrichCandidatesJob`'s async IIFE success branch, AFTER the existing `completeJob` try/catch (so it fires even if `completeJob` throws), add a separate guarded call:

```js
      try {
        completeJob('enrich-candidates', slug, { tokens: result.tokens });
      } catch {
        // existing — non-fatal
      }
      try {
        _startStopPrepJob(slug);
      } catch {
        // chaining is best-effort; never fail the enrich job because of it
      }
```

The exact surrounding lines must match the existing geocode→enrich precedent (the geocode endpoint chains `_startEnrichCandidatesJob(slug)` the same way). Place the new try/catch in the success branch only — never after an abort or failure.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/api-stop-prep-chain.test.js`
Expected: PASS (4 tests).

- [ ] **Step 6: Run the promise-coverage guard**

Run: `npx vitest run tests/promise-coverage.test.js`
Expected: PASS — the new endpoint's `export const _promise = HAND_DEFAULTS['stop-prep']` is auto-discovered and validated.

- [ ] **Step 7: Commit**

```bash
git add src/routes/api/actions/stop-prep/ src/routes/api/actions/enrich-candidates/[slug]/+server.js tests/api-stop-prep-chain.test.js
git commit -m "feat(stop-prep): add endpoint and chain it after enrichment"
```

---

## Task 6: Todo-toggle PATCH endpoint

The interactive checkbox needs a route to persist a single todo's `done` flag.

**Files:**
- Create: `src/routes/api/candidates/[slug]/stops/[id]/todos/[todoId]/+server.js`
- Test: `tests/api-candidates-todos.test.js` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/api-candidates-todos.test.js` (mirrors `api-candidates-mutations.test.js`):

```js
import { describe, test, expect, vi, beforeEach } from 'vitest';

const mockSetTodoDone = vi.hoisted(() => vi.fn());
const mockInvalidate = vi.hoisted(() => vi.fn());

vi.mock('@sveltejs/kit', () => ({
  json: (body, init) => ({ body, status: init?.status ?? 200 }),
}));
vi.mock('../src/lib/server/candidates.js', () => ({ setTodoDone: mockSetTodoDone }));
vi.mock('../src/lib/server/data.js', () => ({ invalidateEnrichCache: mockInvalidate }));

import { PATCH } from '../src/routes/api/candidates/[slug]/stops/[id]/todos/[todoId]/+server.js';

function req(body) {
  return { json: async () => body };
}

beforeEach(() => vi.clearAllMocks());

describe('PATCH todo done', () => {
  test('sets done and returns the updated stop', async () => {
    mockSetTodoDone.mockReturnValueOnce({ id: 'a', todos: [{ id: 't1', text: 'x', done: true }] });
    const res = await PATCH({
      params: { slug: 'trip', id: 'a', todoId: 't1' },
      request: req({ done: true }),
    });
    expect(mockSetTodoDone).toHaveBeenCalledWith('trip', 'a', 't1', true);
    expect(res.status).toBe(200);
    expect(res.body.candidate.todos[0].done).toBe(true);
  });

  test('400 when done is not a boolean', async () => {
    const res = await PATCH({
      params: { slug: 'trip', id: 'a', todoId: 't1' },
      request: req({ done: 'yes' }),
    });
    expect(res.status).toBe(400);
    expect(mockSetTodoDone).not.toHaveBeenCalled();
  });

  test('404 when the stop or todo is missing', async () => {
    mockSetTodoDone.mockReturnValueOnce(null);
    const res = await PATCH({
      params: { slug: 'trip', id: 'a', todoId: 'nope' },
      request: req({ done: true }),
    });
    expect(res.status).toBe(404);
  });
});
```

> Confirm the import path for `invalidateEnrichCache` and whether the hidden-toggle PATCH actually calls it; if the reference route imports it from a different module, match that. If the reference route does not invalidate a cache, drop the `data.js` mock and the invalidate call.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api-candidates-todos.test.js`
Expected: FAIL — cannot resolve the new `+server.js` module.

- [ ] **Step 3: Implement the endpoint**

Create `src/routes/api/candidates/[slug]/stops/[id]/todos/[todoId]/+server.js` (mirror the `stops/[id]/+server.js` PATCH handler):

```js
import { json } from '@sveltejs/kit';
import { setTodoDone } from '$lib/server/candidates.js';
import { invalidateEnrichCache } from '$lib/server/data.js';

export async function PATCH({ params, request }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_body' }, { status: 400 });
  }

  if (typeof body?.done !== 'boolean') {
    return json({ error: 'done_must_be_boolean' }, { status: 400 });
  }

  const updated = setTodoDone(params.slug, params.id, params.todoId, body.done);
  if (!updated) return json({ error: 'not_found' }, { status: 404 });

  invalidateEnrichCache(params.slug);
  return json({ ok: true, candidate: updated });
}
```

> If the reference `stops/[id]/+server.js` does not call `invalidateEnrichCache`, remove that import + call here to match. Verify the helper name by reading the reference file.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/api-candidates-todos.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/routes/api/candidates/[slug]/stops/[id]/todos/ tests/api-candidates-todos.test.js
git commit -m "feat(stop-prep): PATCH endpoint to toggle a todo's done flag"
```

---

## Task 7: Render tips + todos on StopCard (compact mode)

Surfaces the prep on Plan day-cards. Tips render as a read-only list; todos render as checkboxes (interactive on planning, static on completed/readonly).

**Files:**
- Modify: `src/lib/components/StopCard.svelte`
- Test: manual + visual (no unit test — Svelte component; covered by `npm run verify` svelte-check + the PlanSection wiring in Task 8)

- [ ] **Step 1: Add the `onToggleTodo` prop**

In `src/lib/components/StopCard.svelte`, in the `$props()` destructure block, add a no-op default callback alongside the existing props (e.g. after `onHide`):

```js
    onToggleTodo = () => {},
```

- [ ] **Step 2: Render tips + todos in compact mode**

Immediately after the compact meta-stack block (`{#if hasMeta && compact}…{/if}`), add a prep block. It must occupy a full row (`flex-basis: 100%`) so it sits below the meta:

```svelte
{#if compact && (stop.tips?.length || stop.todos?.length)}
  <div class="prep">
    {#if stop.tips?.length}
      <ul class="tips">
        {#each stop.tips as tip}
          <li>{tip}</li>
        {/each}
      </ul>
    {/if}
    {#if stop.todos?.length}
      <ul class="todos">
        {#each stop.todos as todo (todo.id)}
          <li>
            <label
              role="presentation"
              onclick={(e) => e.stopPropagation()}
            >
              <input
                type="checkbox"
                checked={todo.done}
                disabled={readonly || working}
                onchange={(e) => onToggleTodo(todo.id, e.currentTarget.checked)}
              />
              <span class:done={todo.done}>{todo.text}</span>
            </label>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
{/if}
```

> Confirm the prop name for read-only state in this component (`readonly`) and the busy flag (`working`) by reading the existing `$props()` block; reuse whatever names exist. The `onclick` stopPropagation prevents a checkbox click from triggering the card's drag/promote handlers.

- [ ] **Step 3: Add CSS using tokens**

In the component's `<style>`, add (use existing custom-property tokens for color — confirm token names in `src/app.css`, e.g. `--color-text`, `--color-text-muted`, `--color-accent`):

```css
  .stop-card.compact .prep {
    flex-basis: 100%;
    margin-top: 0.4rem;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .prep ul {
    margin: 0;
    padding-left: 1.1rem;
    list-style: disc;
    font-size: 0.8rem;
    color: var(--color-text-muted);
  }
  .prep ul.todos {
    list-style: none;
    padding-left: 0;
  }
  .prep ul.todos li label {
    display: flex;
    align-items: flex-start;
    gap: 0.4rem;
    cursor: pointer;
  }
  .prep ul.todos span.done {
    text-decoration: line-through;
    opacity: 0.6;
  }
```

- [ ] **Step 4: Type-check**

Run: `npx svelte-check --fail-on-warnings --tsconfig ./jsconfig.json 2>&1 | tail -20`
Expected: no new errors/warnings referencing `StopCard.svelte`.

> If the project's svelte-check invocation differs, use the one in `package.json`'s `verify`/`check` script. Run that script's check leg instead.

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/StopCard.svelte
git commit -m "feat(stop-prep): render tips and checkable todos on stop cards"
```

---

## Task 8: PlanSection roll-up + toggleTodo + startStopPrep

Wires StopCard's `onToggleTodo` to a persisting API call, adds a trip-prep roll-up panel over promoted stops, and adds the manual Refresh/Re-generate controls.

**Files:**
- Modify: `src/lib/components/PlanSection.svelte`
- Test: manual + `npm run verify` svelte-check

- [ ] **Step 1: Add derived prep aggregates**

In `src/lib/components/PlanSection.svelte`, after the existing `candidateById` derived, add:

```js
  const promotedStopIds = $derived.by(() => {
    const ids = new Set();
    for (const day of plan?.days ?? []) {
      for (const s of day.stops ?? []) {
        const id = typeof s === 'string' ? s : s.id;
        if (id) ids.add(id);
      }
    }
    return ids;
  });

  const prepStops = $derived.by(() =>
    (candidates?.stops ?? []).filter(
      (s) => promotedStopIds.has(s.id) && (s.tips?.length || s.todos?.length),
    ),
  );

  const prepTotal = $derived(
    prepStops.reduce((n, s) => n + (s.todos?.length ?? 0), 0),
  );
  const prepDone = $derived(
    prepStops.reduce((n, s) => n + (s.todos?.filter((t) => t.done).length ?? 0), 0),
  );
```

> Confirm how promoted stops are referenced in `plan.days[].stops` (id strings vs objects) by reading the existing `candidateById`/StopCard render block; adjust the `promotedStopIds` extraction to match the real shape.

- [ ] **Step 2: Add toggleTodo and startStopPrep handlers**

Add near the existing `api(path, opts)` helper:

```js
  async function toggleTodo(stopId, todoId, done) {
    await api(`/api/candidates/${slug}/stops/${stopId}/todos/${todoId}`, {
      method: 'PATCH',
      body: JSON.stringify({ done }),
    });
  }

  async function startStopPrep(force = false) {
    await api(`/api/actions/stop-prep/${slug}`, {
      method: 'POST',
      body: JSON.stringify({ force }),
    });
  }
```

> Match the existing `api()` helper's contract (it sets `working`, awaits `invalidate('app:trip')` on ok, sets `errorCode`/`errorCtx` on failure). The POST returns 202/409 — `api()` treats 409 as non-ok; that's fine, the user can retry.

- [ ] **Step 3: Wire onToggleTodo into the StopCard render**

Find the `<StopCard … />` usage and add the prop:

```svelte
        onToggleTodo={(todoId, done) => toggleTodo(cand.id, todoId, done)}
```

Use whatever local variable holds the resolved candidate at that point (the summary calls it `cand` — confirm the each-block binding name).

- [ ] **Step 4: Add the roll-up panel + controls**

Immediately before the `{#each plan.days as day}` block, add (hidden when no prep stops exist):

```svelte
{#if prepStops.length > 0}
  <div class="trip-prep">
    <div class="trip-prep-head">
      <h3>Trip prep</h3>
      <span class="count">{prepDone} of {prepTotal} done</span>
      {#if !readonly}
        <div class="trip-prep-actions">
          <button type="button" class="ghost" disabled={working} onclick={() => startStopPrep(false)}>
            Refresh prep
          </button>
          <button
            type="button"
            class="ghost"
            disabled={working}
            onclick={() => (showConfirm = {
              title: 'Re-generate all prep?',
              body: 'This clears every check-off and regenerates tips and to-dos for all stops.',
              confirmLabel: 'Re-generate',
              onConfirm: () => startStopPrep(true),
            })}
          >
            Re-generate all
          </button>
        </div>
      {/if}
    </div>
  </div>
{/if}
```

> Confirm the `ConfirmModal` trigger contract by reading how `showConfirm` is shaped elsewhere in this file (title/body/confirmLabel/onConfirm). Match its exact field names. If the confirm pattern uses a different shape, adapt the `Re-generate all` handler to it.

- [ ] **Step 5: Add CSS for the panel (tokens only)**

```css
  .trip-prep {
    margin-bottom: 1rem;
    padding: 0.75rem 1rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius, 8px);
    background: var(--color-surface);
  }
  .trip-prep-head {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  .trip-prep-head h3 {
    margin: 0;
    font-size: 0.95rem;
  }
  .trip-prep-head .count {
    color: var(--color-text-muted);
    font-size: 0.85rem;
  }
  .trip-prep-actions {
    margin-left: auto;
    display: flex;
    gap: 0.5rem;
  }
```

> Confirm token names (`--color-border`, `--color-surface`, `--color-text-muted`) against `src/app.css`. Reuse an existing `.ghost`/secondary button class if the file already defines one rather than introducing new button styling.

- [ ] **Step 6: Type-check**

Run: `npx svelte-check --fail-on-warnings --tsconfig ./jsconfig.json 2>&1 | tail -20`
Expected: no new errors/warnings referencing `PlanSection.svelte`.

- [ ] **Step 7: Manual browser check**

Run: `npm run dev -- --port 3456`
Then in the browser on a planning trip with promoted, prepped stops: confirm (a) the Trip prep panel shows the correct "X of Y done"; (b) toggling a checkbox persists across reload; (c) "Refresh prep" kicks off a background pill; (d) "Re-generate all" shows the confirm modal. If no prepped data exists yet, trigger it via the chain (re-run Research) or POST `/api/actions/stop-prep/<slug>`.

- [ ] **Step 8: Commit**

```bash
git add src/lib/components/PlanSection.svelte
git commit -m "feat(stop-prep): trip-prep roll-up, todo toggle, and manual prep controls"
```

---

## Task 9: Brochure projection + render

The printable brochure must show tips and todos (static ☐/☑) per stop.

**Files:**
- Modify: `src/lib/server/derive-brochure.js` (both stop projections)
- Modify: `src/lib/components/Brochure.svelte`
- Test: `tests/derive-brochure.test.js` (extend)

- [ ] **Step 1: Write the failing test**

In `tests/derive-brochure.test.js`, add a test asserting both projections carry the new fields. Match the file's existing fixture/derive-call shape:

```js
  it('projects tips and todos onto brochure stops', () => {
    const out = deriveBrochure({
      // …reuse the file's existing trip/plan/candidates fixture builder…
      candidates: {
        stops: [
          {
            id: 'a',
            name: 'Place A',
            category: 'misc',
            tips: ['Arrive early'],
            todos: [{ id: 't1', text: 'Book ticket', done: true }],
          },
        ],
        lodging: [],
      },
      // …promote stop 'a' into a day so it appears in dayStops…
    });

    const dayStop = out.days.flatMap((d) => d.stops).find((s) => s.name === 'Place A');
    expect(dayStop.tips).toEqual(['Arrive early']);
    expect(dayStop.todos).toEqual([{ id: 't1', text: 'Book ticket', done: true }]);
  });
```

> Read the existing tests in `tests/derive-brochure.test.js` first and reuse its exact fixture helper + `deriveBrochure` call signature. The assertion targets are the two projections (dayStops and topStops); pick whichever the existing tests already exercise and assert on that one to keep the fixture minimal.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/derive-brochure.test.js`
Expected: FAIL — `dayStop.tips` is undefined (not projected).

- [ ] **Step 3: Add the fields to both projections**

In `src/lib/server/derive-brochure.js`, in the `dayStops` projection object (the one whitelisting `name/category/description/notes/coords/address/hours/website/phone`), add:

```js
      tips: c.tips,
      todos: c.todos,
```

Then add the identical two lines to the `topStops` projection object.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/derive-brochure.test.js`
Expected: PASS.

- [ ] **Step 5: Render in Brochure.svelte**

In `src/lib/components/Brochure.svelte`, after each stop's existing body (in BOTH the `day.stops` loop and the flat `brochure.stops` loop, after the hours/address/website/phone/notes block), add:

```svelte
{#if stop.tips?.length}
  <ul class="brochure-tips">
    {#each stop.tips as tip}
      <li>{tip}</li>
    {/each}
  </ul>
{/if}
{#if stop.todos?.length}
  <ul class="brochure-todos">
    {#each stop.todos as todo (todo.id)}
      <li>{todo.done ? '☑' : '☐'} {todo.text}</li>
    {/each}
  </ul>
{/if}
```

Use the actual loop variable name in each loop (it may be `stop` in one and a different binding in the other — confirm by reading the file).

- [ ] **Step 6: Add print-friendly CSS (tokens)**

```css
  .brochure-tips {
    margin: 0.25rem 0 0;
    padding-left: 1.1rem;
    font-size: 0.85rem;
    color: var(--color-text-muted);
  }
  .brochure-todos {
    margin: 0.25rem 0 0;
    padding-left: 0;
    list-style: none;
    font-size: 0.85rem;
  }
```

> Confirm token names against `src/app.css`. If the brochure uses its own print color tokens, reuse those instead.

- [ ] **Step 7: Type-check + render check**

Run: `npx svelte-check --fail-on-warnings --tsconfig ./jsconfig.json 2>&1 | tail -20`
Expected: no new warnings for `Brochure.svelte`.
Then visit `/trips/<slug>/brochure` for a prepped trip and confirm tips + ☐/☑ todos render in print preview.

- [ ] **Step 8: Commit**

```bash
git add src/lib/server/derive-brochure.js src/lib/components/Brochure.svelte tests/derive-brochure.test.js
git commit -m "feat(stop-prep): show tips and todos on the printable brochure"
```

---

## Task 10: Docs, changelog, full verify + smoke

Documents the two new stop fields, records the changelog entry, and runs the full go/no-go.

**Files:**
- Modify: `docs/superpowers/specs/2026-05-22-planning-plan-and-candidates-design.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Document the new stop fields**

In `docs/superpowers/specs/2026-05-22-planning-plan-and-candidates-design.md`, find the candidates.yaml stop schema section and add the two optional fields with descriptions:

```markdown
- `tips` *(optional, string[])* — short read-only in-trip pointers generated by the `stop-prep` job (best entrance, where to park, what to bring, light timing). Capped at 5.
- `todos` *(optional, object[])* — pre-trip to-dos generated by the `stop-prep` job. Each is `{ id, text, done }`; `id` is a `makeCandidateId`-derived slug, `done` defaults `false` and is toggled by the user. Capped at 4.
```

- [ ] **Step 2: Add the changelog entry**

In `CHANGELOG.md`, under the `Unreleased` (or current top) section's `Added` list, add:

```markdown
- Per-stop prep: auto-generated read-only tips and checkable pre-trip to-dos for each promoted stop, surfaced on Plan day-cards, a trip-prep roll-up, and the printable brochure. Generated by a new `stop-prep` background job that runs after enrichment (#406).
```

> Match the exact changelog format/heading conventions already in the file (Keep-a-Changelog style, version heading placement).

- [ ] **Step 3: Run the full verify**

Run: `npm run verify`
Expected: svelte-check passes with no warnings, the full vitest suite is green (including the new `stop-prep-constants`, `stop-prep-job`, `api-stop-prep-chain`, `api-candidates-todos`, and extended `candidates-io`/`realize-plan`/`derive-brochure` tests), and the build succeeds.

> If svelte-check flags pre-existing unrelated warnings, do not fix them in this PR — confirm they exist on `main` first (`git stash && npm run check`). Only address warnings introduced by this work.

- [ ] **Step 4: Run smoke (chat() call site added)**

Because this work adds a new `chat()` call site (`stop-prep-job.js`), run the smoke probe:

Run: `npm run smoke`
Expected: a 1-token round-trip per configured provider succeeds. (No tool-loop probe is needed for stop-prep since it passes no tools, but smoke runs the standard suite regardless.)

> Smoke makes real API calls. If keys aren't configured in this environment, note that smoke could not run and flag it for the user rather than marking the task done.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-05-22-planning-plan-and-candidates-design.md CHANGELOG.md
git commit -m "docs(stop-prep): document tips/todos schema and changelog (#406)"
```

- [ ] **Step 6: Final review + PR**

After all tasks pass, dispatch a final code review over the full branch diff, then open ONE bundled PR (spec + plan + implementation) per the feature workflow:

```bash
git push -u origin per-stop-todos
gh pr create --title "feat: auto-generate per-stop to-dos and instructions (#406)" --body "$(cat <<'EOF'
## Summary
- New `stop-prep` Ambient Background job (runs after enrichment) generates per-stop read-only tips and checkable pre-trip to-dos, grounded in trip context.
- Surfaces on Plan day-cards (interactive todos), a trip-prep roll-up ("X of Y done"), and the printable brochure (static ☐/☑).
- Two new optional candidate-stop fields (`tips`, `todos`) round-trip through candidates.yaml and are preserved forward by id across re-research.

## Test plan
- [ ] `npm run verify` green (new + extended unit tests)
- [ ] `npm run smoke` passes (new chat() call site)
- [ ] Manual: toggle a todo persists across reload; Refresh/Re-generate controls work; brochure prints tips + todos

Closes #406

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Type Consistency Reference

These names are used across tasks — keep them identical:

- Job export: `stopPrepJob(slug, opts)` → returns `{ attempted, prepped, failed, skipped, tokens }` (note: **`prepped`**, not `enriched`).
- Launcher export: `_startStopPrepJob(slug, opts = {})` from `src/routes/api/actions/stop-prep/[slug]/+server.js`.
- Mutator: `setTodoDone(slug, stopId, todoId, done)` → returns mutated stop or `null`.
- Stop fields: `tips: string[]`, `todos: [{ id, text, done }]`.
- Job label / config key / promise key / error code / token key: `'stop-prep'` everywhere; error code is `'stop_prep_all_failed'` (underscores).
- Validation caps: `MAX_TIPS = 5`, `MAX_TODOS = 4`.
- Skip marker: presence of non-empty `tips` (not `todos`) means "already prepped".
- Response tag: model returns `<prep>…</prep>` YAML with `tips` + `todos` lists of plain strings.

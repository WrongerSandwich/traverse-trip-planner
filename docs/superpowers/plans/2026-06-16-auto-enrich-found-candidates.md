# Auto-enrich newly-found candidates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `find-more` and `add-candidate` flows fire the existing `geocode-candidates → enrich-candidates` job chain after they write new candidates, so found stops get `address` / `hours` / `website` / `phone` without a manual enrichment step.

**Architecture:** Both handlers already inline-geocode `coords`, then write the candidate. We add one guarded, fire-and-forget call to the already-exported `_startGeocodeCandidatesJob(slug)` (from `geocode-candidates/[slug]/+server.js`) after a *successful* add. That job is idempotent (skips coord'd entries), reverse-geocodes missing addresses, and auto-chains to `_startEnrichCandidatesJob`. No prompt, schema, or new job. This mirrors exactly how the deepen handler already kicks off the chain.

**Tech Stack:** SvelteKit server routes (JS), Vitest, `npm run verify` (svelte-check + tests + build).

**Spec:** `docs/superpowers/specs/2026-06-16-auto-enrich-found-candidates-design.md`

---

## File Structure

- **Modify** `src/routes/api/actions/find-more/[slug]/+server.js` — import the kickoff; fire it after the add loop when `added > 0`.
- **Modify** `src/routes/api/actions/add-candidate/[slug]/+server.js` — import the kickoff; fire it after a successful `addCandidateStop/Lodging`.
- **Modify** `tests/api-find-more.test.js` — mock the kickoff module; assert it fires after a successful add and not when zero survivors.
- **Modify** `tests/api-add-candidate.test.js` — mock the kickoff module; assert it fires after a successful add and not on early-return branches.

No new files. The cross-route import of a `_`-prefixed kickoff is an established pattern (deepen → geocode, geocode → enrich).

---

## Task 1: find-more fires the geocode→enrich chain after a successful add

**Files:**
- Modify: `tests/api-find-more.test.js`
- Modify: `src/routes/api/actions/find-more/[slug]/+server.js`

- [ ] **Step 1: Add the kickoff mock to the test file**

In `tests/api-find-more.test.js`, add this hoisted mock alongside the other `vi.mock` blocks (e.g. directly after the `$lib/server/jobs.js` mock that ends at line 76). The handler will import `_startGeocodeCandidatesJob` from `../../geocode-candidates/[slug]/+server.js`; from the test file's location that module path is `../src/routes/api/actions/geocode-candidates/[slug]/+server.js`:

```javascript
const mockStartGeocodeCandidatesJob = vi.hoisted(() => vi.fn(() => null));
vi.mock('../src/routes/api/actions/geocode-candidates/[slug]/+server.js', () => ({
  _startGeocodeCandidatesJob: mockStartGeocodeCandidatesJob,
}));
```

- [ ] **Step 2: Add the two new test cases**

Append these to the `describe('POST /api/actions/find-more — variants', ...)` block in `tests/api-find-more.test.js`:

```javascript
  it('fires the geocode→enrich chain after a successful add', async () => {
    mockChat.mockResolvedValueOnce({
      text: `<additions>
stops:
  - name: Adena Mansion
    category: historic
    description: 19th-century estate with valley views.
    why_recommended: Aligns with your historic-sites tilt.
    source_url: https://www.ohiohistory.org
</additions>`,
      usage: { input_tokens: 200, output_tokens: 100 },
    });
    const res = await POST(buildEvent({ type: 'stop', count: 5 }));
    expect(res.status).toBe(202);
    await new Promise((r) => setTimeout(r, 50));
    expect(mockAddCandidateStop).toHaveBeenCalledTimes(1);
    expect(mockStartGeocodeCandidatesJob).toHaveBeenCalledWith('great-smoky-ramble');
  });

  it('does NOT fire the geocode→enrich chain when every addition is a duplicate', async () => {
    mockReadCandidates.mockReturnValueOnce({
      stops: [{ id: 'adena-mansion', name: 'Adena Mansion' }],
      lodging: [],
    });
    mockChat.mockResolvedValueOnce({
      text: `<additions>
stops:
  - name: Adena Mansion
    category: historic
    description: dup
</additions>`,
      usage: { input_tokens: 200, output_tokens: 100 },
    });
    const res = await POST(buildEvent({ type: 'stop', count: 5 }));
    expect(res.status).toBe(202);
    await new Promise((r) => setTimeout(r, 50));
    expect(mockAddCandidateStop).not.toHaveBeenCalled();
    expect(mockStartGeocodeCandidatesJob).not.toHaveBeenCalled();
  });
```

- [ ] **Step 3: Run the new tests to verify they fail**

Run: `npx vitest run tests/api-find-more.test.js -t "geocode"`
Expected: FAIL — `mockStartGeocodeCandidatesJob` is never called (the handler doesn't import or invoke it yet), so the first test's `toHaveBeenCalledWith` assertion fails.

- [ ] **Step 4: Add the import to the handler**

In `src/routes/api/actions/find-more/[slug]/+server.js`, add this import after the existing import block (e.g. after the `usageToTokens` import at line 36):

```javascript
import { _startGeocodeCandidatesJob } from '../../geocode-candidates/[slug]/+server.js';
```

- [ ] **Step 5: Fire the kickoff after the add loop**

In the same file, the add loop ends and is followed by:

```javascript
      invalidateEnrichCache();
      console.log(`[find-more] ${slug} (${type}): added ${added} of ${additions.length} candidates`);
      completeJob(workflow, slug, { tokens: usageToTokens(usage) });
```

Replace that with (insert the guarded kickoff before `completeJob`):

```javascript
      invalidateEnrichCache();
      console.log(`[find-more] ${slug} (${type}): added ${added} of ${additions.length} candidates`);
      // Closes the metadata gap: newly-found candidates carry only inline
      // coords. Fire the same idempotent geocode→enrich chain the deepen flow
      // uses so address / hours / website / phone get backfilled in the
      // background. Guarded so a kickoff failure can't fail an already-
      // successful find-more job.
      if (added > 0) {
        try {
          _startGeocodeCandidatesJob(slug);
        } catch (e) {
          console.error(`[find-more] ${slug}: _startGeocodeCandidatesJob threw:`, e?.message ?? e);
        }
      }
      completeJob(workflow, slug, { tokens: usageToTokens(usage) });
```

- [ ] **Step 6: Run the new tests to verify they pass**

Run: `npx vitest run tests/api-find-more.test.js -t "geocode"`
Expected: PASS — both new cases green.

- [ ] **Step 7: Run the full find-more suite to confirm no regressions**

Run: `npx vitest run tests/api-find-more.test.js`
Expected: PASS — all cases green (the existing happy-path/lodging cases now also invoke the mocked kickoff, which is a harmless no-op).

- [ ] **Step 8: Commit**

```bash
git add tests/api-find-more.test.js src/routes/api/actions/find-more/[slug]/+server.js
git commit -m "feat(candidates): auto-enrich find-more results via geocode chain"
```

---

## Task 2: add-candidate fires the geocode→enrich chain after a successful add

**Files:**
- Modify: `tests/api-add-candidate.test.js`
- Modify: `src/routes/api/actions/add-candidate/[slug]/+server.js`

- [ ] **Step 1: Add the kickoff mock to the test file**

In `tests/api-add-candidate.test.js`, add this hoisted mock alongside the other `vi.mock` blocks (e.g. after the `$lib/server/rate-limit.js` mock that ends at line 72, before the `// SUT` import on line 74):

```javascript
const mockStartGeocodeCandidatesJob = vi.hoisted(() => vi.fn(() => null));
vi.mock('../src/routes/api/actions/geocode-candidates/[slug]/+server.js', () => ({
  _startGeocodeCandidatesJob: mockStartGeocodeCandidatesJob,
}));
```

- [ ] **Step 2: Add the two new test cases**

Append these to the `describe('POST /api/actions/add-candidate — variants', ...)` block in `tests/api-add-candidate.test.js`:

```javascript
  it('fires the geocode→enrich chain after a successful stop add', async () => {
    mockChat.mockResolvedValueOnce({
      text: `<candidate>
name: Mound City Group
category: historic
description: Earthworks site of the Hopewell culture.
why_recommended: Matches your taste for low-foot-traffic historic sites.
source_url: https://www.nps.gov/hocu/index.htm
</candidate>`,
      usage: { input_tokens: 100, output_tokens: 200 },
    });
    const res = await POST(buildEvent({ name: 'Mound City Group', type: 'stop' }));
    const events = await readSse(res);
    expect(events[events.length - 1].code).toBeFalsy();
    expect(mockAddCandidateStop).toHaveBeenCalledTimes(1);
    expect(mockStartGeocodeCandidatesJob).toHaveBeenCalledWith('great-smoky-ramble');
  });

  it('does NOT fire the geocode→enrich chain on a duplicate envelope', async () => {
    mockChat.mockResolvedValueOnce({
      text: `<duplicate>Mound City Group</duplicate>`,
      usage: { input_tokens: 50, output_tokens: 30 },
    });
    const res = await POST(buildEvent({ name: 'Mound City NHP', type: 'stop' }));
    const events = await readSse(res);
    expect(events[events.length - 1].code).toBe('candidate_duplicate');
    expect(mockAddCandidateStop).not.toHaveBeenCalled();
    expect(mockStartGeocodeCandidatesJob).not.toHaveBeenCalled();
  });
```

- [ ] **Step 3: Run the new tests to verify they fail**

Run: `npx vitest run tests/api-add-candidate.test.js -t "geocode"`
Expected: FAIL — `mockStartGeocodeCandidatesJob` is never called (the handler doesn't import or invoke it yet).

- [ ] **Step 4: Add the import to the handler**

In `src/routes/api/actions/add-candidate/[slug]/+server.js`, add this import after the existing import block (e.g. after the `usageToTokens` import at line 33):

```javascript
import { _startGeocodeCandidatesJob } from '../../geocode-candidates/[slug]/+server.js';
```

- [ ] **Step 5: Fire the kickoff after the successful add**

In the same file, the tail of the handler currently reads:

```javascript
    const id = type === 'stop'
      ? addCandidateStop(slug, fields)
      : addCandidateLodging(slug, fields);

    invalidateEnrichCache();
    send({ msg: formatUsage(usage) });
    send({ msg: `Added ${parsed.name}.`, done: true, id, tokens: usageToTokens(usage) });
```

Replace that with (insert the guarded kickoff after `invalidateEnrichCache()`):

```javascript
    const id = type === 'stop'
      ? addCandidateStop(slug, fields)
      : addCandidateLodging(slug, fields);

    invalidateEnrichCache();
    // Closes the metadata gap: the inline geocode above only set coords. Fire
    // the same idempotent geocode→enrich chain the deepen flow uses so address
    // / hours / website / phone get backfilled via the Ambient pill — the card
    // already appeared, so Instant Inline is preserved. Guarded so a kickoff
    // failure can't turn a successful add into an error.
    try {
      _startGeocodeCandidatesJob(slug);
    } catch (e) {
      console.error(`[add-candidate] ${slug}: _startGeocodeCandidatesJob threw:`, e?.message ?? e);
    }
    send({ msg: formatUsage(usage) });
    send({ msg: `Added ${parsed.name}.`, done: true, id, tokens: usageToTokens(usage) });
```

- [ ] **Step 6: Run the new tests to verify they pass**

Run: `npx vitest run tests/api-add-candidate.test.js -t "geocode"`
Expected: PASS — both new cases green.

- [ ] **Step 7: Run the full add-candidate suite to confirm no regressions**

Run: `npx vitest run tests/api-add-candidate.test.js`
Expected: PASS — all cases green. Note the "abandoned SSE" case still passes: it cancels before the add is reached, so the kickoff is never invoked.

- [ ] **Step 8: Commit**

```bash
git add tests/api-add-candidate.test.js src/routes/api/actions/add-candidate/[slug]/+server.js
git commit -m "feat(candidates): auto-enrich add-candidate result via geocode chain"
```

---

## Task 3: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full verify gate**

Run: `npm run verify`
Expected: PASS — svelte-check (no new warnings), all tests green, build succeeds.

- [ ] **Step 2: If green, the branch is ready for PR**

No commit needed (verification only). Proceed to the manual QA pass from the spec before opening the PR:
1. **Find more** for stops → confirm `Geocoding…` then `Enriching…` pills appear after `Find complete`, and new cards gain address + hours/website/phone with no manual step.
2. **Add candidate** for a known place → confirm the card appears instantly, then the geocode/enrich pills run and backfill metadata.
3. **Find more** where every suggestion is a duplicate → confirm no geocode pill fires.

---

## Self-Review Notes

- **Spec coverage:** find-more wiring (Task 1), add-candidate wiring (Task 2), keep-inline-geocoding (unchanged — neither task touches the existing `geocodeCandidate` calls), testing requirements (Tasks 1–2 cover the success + no-op-branch assertions; Task 3 runs `npm run verify`), manual QA (Task 3 Step 2). The REST-write path is explicitly out of scope per the spec and gets no task.
- **Known edge** (second add while a geocode job is already running → `assertNotRunning` makes the new kickoff a no-op): handled by the existing job registry, no new code, matches deepen's behavior — nothing to test beyond the existing geocode-chain suite.
- **Type/name consistency:** `_startGeocodeCandidatesJob(slug)` — same name and single-string-arg signature used in deepen and in both new call sites and both test mocks. Mock module path `../src/routes/api/actions/geocode-candidates/[slug]/+server.js` is consistent across both test files.

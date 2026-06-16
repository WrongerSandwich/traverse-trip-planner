# Auto-enrich newly-found candidates

**Status:** approved (2026-06-16)
**Issue:** closes the metadata gap where LLM-found candidates need a separate enrichment pass

## Problem

When a candidate stop is created by the **deepen** (Research) flow, a follow-on
`geocode-candidates → enrich-candidates` job chain fills in its metadata:
`coords`, `address`, then `hours` / `website` / `phone`.

The two *other* LLM-driven paths that produce candidates do **not** run that
chain:

- **find-more** (`src/routes/api/actions/find-more/[slug]/+server.js`) — bulk
  "Find more candidates" (Ambient Background).
- **add-candidate** (`src/routes/api/actions/add-candidate/[slug]/+server.js`) —
  single named place (Instant Inline).

Both inline-geocode `coords` only via `geocodeCandidate()`, then write the
candidate and stop. Neither reverse-geocodes `address`, nor runs the
`enrich-candidates` pass. Result: anything found *after* the initial research
lands bare and has to be enriched by hand.

## Goal

Newly-found candidates from `find-more` and `add-candidate` get the same
metadata treatment as deepen-produced ones, with no manual step.

Out of scope: the bare `POST /api/candidates/[slug]/stops` REST write (no LLM,
programmatic caller owns the payload) and any change to the enrichment prompts
or candidate schema.

## Approach

Reuse the existing, already-exported kickoff:

```js
// src/routes/api/actions/geocode-candidates/[slug]/+server.js
export function _startGeocodeCandidatesJob(slug) { … }
```

It is the correct single entry point because it:

1. **skips forward-geocoding** for entries that already have `coords` — which
   find-more/add-candidate set inline — so there is no double geocode and no
   regression in pin latency;
2. **reverse-geocodes `address`** for any coord'd stop missing one; and
3. **auto-chains** to `_startEnrichCandidatesJob(slug)` for
   `hours` / `website` / `phone`.

The job is pool-wide but fully idempotent (skips already-filled entries
cheaply), so re-triggering on every add is safe. This is the exact chain the
deepen handler already fires. No new prompt, schema, or job — one cross-route
import per call site, matching the existing convention (deepen imports
`_startGeocodeCandidatesJob`; geocode imports `_startEnrichCandidatesJob`).

### Keep inline geocoding

Both paths keep their inline `geocodeCandidate()` call so the map pin still
appears immediately. The job layers `address` + the enrich leg on top. The
geo-cache means the job's (skipped) forward-geocode costs nothing.

## Wiring

### find-more (Ambient Background)

After the add loop, guarded on `added > 0`, fire the kickoff before
`completeJob`, wrapped in try/catch + `console.error` log so a kickoff failure
can't fail an already-successful find-more job (mirrors how the geocode→enrich
chain already guards its `_startEnrichCandidatesJob` call):

```js
if (added > 0) {
  try { _startGeocodeCandidatesJob(slug); }
  catch (e) { console.error(`[find-more] ${slug}: geocode kickoff threw:`, e?.message ?? e); }
}
invalidateEnrichCache();
completeJob(workflow, slug, { tokens: usageToTokens(usage) });
```

User-visible sequence of pills: `Finding more… ✓ → Geocoding… ✓ → Enriching… ✓`.

### add-candidate (Instant Inline)

After the candidate is written and `id` is returned, fire the kickoff (same
try/catch + log) before the final `done` SSE event. The card still appears
instantly — Instant Inline preserved — and metadata fills in shortly after via
the Ambient pill, the same instant-return-plus-background-enrich shape deepen
has:

```js
const id = type === 'stop' ? addCandidateStop(slug, fields) : addCandidateLodging(slug, fields);
invalidateEnrichCache();
try { _startGeocodeCandidatesJob(slug); }
catch (e) { console.error(`[add-candidate] ${slug}: geocode kickoff threw:`, e?.message ?? e); }
send({ msg: formatUsage(usage) });
send({ msg: `Added ${parsed.name}.`, done: true, id, tokens: usageToTokens(usage) });
```

## Known edge (accepted, not engineered around)

If a second add lands while a `geocode-candidates` job for the same slug is
already running, `assertNotRunning` makes the new kickoff a no-op (returns
`null`). The running job re-reads `candidates.yaml` fresh each iteration so it
usually still catches the new entry; a candidate added *after* the job has
already scanned past it is picked up by the *next* kickoff. This is the same
idempotency the deepen→geocode path already relies on — we note it rather than
add a queue.

## Testing

- find-more: assert `_startGeocodeCandidatesJob` is invoked after a successful
  add, and is **not** invoked when zero survivors are added (all duplicates).
- add-candidate: assert `_startGeocodeCandidatesJob` is invoked after a
  successful add, and **not** on the duplicate / not-applicable / empty-output
  early-return branches.
- `npm run verify` (svelte-check + tests + build) green before declaring done.

## Manual QA pass

On a planning trip in the dev app:

1. Run **Find more** for stops → confirm the `Geocoding…` then `Enriching…`
   pills appear after `Find complete`, and the new cards gain address + hours /
   website / phone without any manual enrich.
2. Run **Add candidate** for a known place → confirm the card appears instantly,
   then the geocode/enrich pills run and backfill its metadata.
3. Run **Find more** in a state where every suggestion is a duplicate (count
   small, pool already covering) → confirm no geocode pill fires.

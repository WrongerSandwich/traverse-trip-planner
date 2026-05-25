# Non-blocking geocoding in the extract leg

Design doc for [#353](https://github.com/WrongerSandwich/traverse-trip-planner/issues/353) — removing the ~15s Nominatim throttle from the deepen critical path.

## Current behavior

After the extract LLM call returns parsed candidates, `extract-candidates.js:253-270` iterates every non-hidden candidate and calls `geocodeCandidate()` (`candidates.js:317-337`) to attach `coords: { lat, lng }`. Two coordinated mechanisms:

- **Per-call throttle.** Every `geocodeCandidate()` call ends with `await sleep(NOMINATIM_THROTTLE_MS)` where `NOMINATIM_THROTTLE_MS = 1100` (`candidates.js:275, 335`). One second per Nominatim ToS, plus 100ms slack.
- **Geocode cache** (`data.js:36-44`, on-disk at `.cache/.geocode-cache.json`). Keyed by query string; resolves cache hits instantly from `geocode()` at `data.js:211` without touching the network.

For ~15 candidates, the loop costs minimum 15 × 1.1s = **16.5s of wall time** even on perfect network and full cache.

## Findings beyond the ticket

### 1. The throttle is unconditional — it fires on cache hits

`geocodeCandidate()` always sleeps `NOMINATIM_THROTTLE_MS` before returning, regardless of whether a `fetch()` actually happened (`candidates.js:335`). Both calls inside the function (`geocode(scoped)` at line 320, `geocode(bare)` at line 326) may return instantly from the cache without making a network request — and we still sleep.

This is a bug independent of any architectural change. On a re-extract with a fully-warm cache, the loop costs the same ~16.5s as on a cold cache. The throttle was added to respect Nominatim's 1 req/sec ToS, but ToS doesn't apply when no request is made.

### 2. The throttle dominates fetch time

Typical Nominatim response: 200–500ms. Throttle: 1100ms. The throttle is the binding constraint, not network. Parallelism would help only if we could relax the throttle, which (against Nominatim) we can't.

### 3. #380 makes the geocode tail more user-visible, not less

Today the deepen handler writes Leg 1 files (`overview.md`, `route.md`, `logistics.md`) atomically before Leg 2 starts; a user navigating to the trip mid-deepen sees the partial planning trip with empty plan/candidates and the recovery banner. After [#380](https://github.com/WrongerSandwich/traverse-trip-planner/issues/380) (single envelope, all-or-nothing write), the trip stays as an idea card until the full LLM + geocode pass finishes. The geocoding tail becomes more painful UX-wise because the user has no intermediate state to look at.

This argues *for* tackling #353 — the latency was tolerable when partial state was visible; it's less tolerable when the deepen feels like one atomic block from the user's perspective.

### 4. Pre-warm (ticket option 4) doesn't materially help

The destination geocode is a single call already cached after the first extract for that destination. Candidate-name queries are `"<stop name>, <destination>"` — unique per stop, unpredictable until extract runs. Pre-warming during Leg 1 doesn't reduce per-candidate calls in any realistic scenario.

### 5. Model-emitted coords (ticket option 3) is a quality trade we shouldn't take pre-launch

`geocodeCandidate` exists *because* Nominatim returns wrong matches for ambiguous names — the b189129 commit explicitly fixed "Capitol Square → Rome" and "The Edgewater → Singapore." That fix relies on validating against the destination's known coordinates. Asking the LLM to emit lat/lng directly shifts the failure mode from "validate against destination distance" to "trust LLM knowledge of obscure coordinates." Opus knows the coords of New York; it almost certainly does not know the coords of a small museum in rural Iowa, and will hallucinate plausibly-shaped pairs that are completely wrong. The disambiguation logic from [#341](https://github.com/WrongerSandwich/traverse-trip-planner/issues/341) becomes much harder to defend.

## Decision space

### Option A — Defer to a follow-on job (recommended)

After the deepen LLM completes, `realizePlan()` writes `coords: null` for all candidates and returns. The deepen job completes with the plan + candidates visible on the trip. A second background job — `geocode-candidates:<slug>` — is spawned immediately and runs the existing throttled loop, updating `candidates.yaml` incrementally as each candidate is geocoded.

**Wins:**
- Deepen completes ~15-20s faster — the user gets "Research complete ✓" without waiting for geocoding.
- Planning trip is visible immediately with plan + candidates; map shows what it has and fills in pins over the next ~15s.
- The two pills (`Research complete ✓` → `Geocoding…`) honestly reflect the multi-phase work happening. Surfacing this is a positive — it tells the user "the structured trip is ready; we're polishing the pins."
- Geocode failures don't fail deepen; the trip is still 95% useful with some unmapped stops.
- Cancel semantics get cleaner — cancel deepen aborts the LLM call (tokens saved); cancel geocode just stops the background poll.

**Costs:**
- One more background job in the registry. The job system already handles multi-instance keys (e.g. `deepen-section:stops:<slug>`), so this is a known pattern.
- A new workflow label needs registration in `jobLabels.js` and `_promise` plumbing.
- Slight UX complexity for the user — "why are there two phases?" — but the user has signed off that the multi-phase signal is *desirable* visibility, not noise.

### Option B — Paid geocoder with no rate limit

Replace Nominatim with Mapbox or Google for the candidate loop. ~50-100ms per candidate, no throttle. 15 candidates done in ~1.5s.

**Rejected.** Adds a paid dependency for a personal-scale tool. The user already runs this on a home server; introducing API keys and a metered service is operational overhead disproportionate to the win.

### Option C — Model emits rough coords, Nominatim validates

LLM produces approximate coords in the extract envelope; we hit Nominatim only when validation fails or for sanity checks.

**Rejected.** See finding #5 — the model's confidence on obscure coords is unwarranted and the disambiguation logic from #341 gets much harder to defend. Pre-launch is the wrong time to take this quality risk.

### Option D — Pre-warm cache during research

Geocode destination + waypoints during Leg 1.

**Rejected.** See finding #4 — destination is already cached after first lookup; candidates are dynamic.

### Option E — Fix the throttle bug (companion to A)

`geocodeCandidate()` should sleep only when an actual `fetch()` happened, not on cache hits.

**Recommended as a small companion change to Option A.** Standalone benefit: re-extracts on warm caches stop wasting ~16s. Combined with Option A: the deferred geocode job runs faster on partial-hit scenarios.

## Recommendation: Option A + Option E bundle

The pair makes sense together: A removes geocoding from the deepen critical path; E makes the geocoding itself faster when partly cached. Either alone is a real improvement; both together is the cleanest pre-launch story.

## UX surface design

### Two pills (chosen)

The Ambient Background indicator pill (`BackgroundJobsIndicator.svelte`) and the per-trip badge (`TripJobBadge.svelte`) both already poll `/api/jobs` every 10s and render whatever jobs are in flight. With the new `geocode-candidates` workflow:

1. User clicks Research → pill shows `Researching…`
2. Deepen LLM completes → pill briefly flashes `Research complete ✓` (the recent-event toast), then flips to `Geocoding…`
3. Geocode finishes → pill shows `Geocoding complete ✓` toast

The two-phase signal honestly communicates the multi-stage work and (per design call) reads as confidence-building rather than confusing. No additional UI primitives needed — both indicator components already handle the multi-job case.

### Persistent "X of Y pinned" hint

Once geocoding finishes, the user has no easy way to see "did 14 of 15 succeed, or 2 of 15?" without scanning the map. Surface as a small badge on the Candidates section header:

```
## Candidates                        12 of 15 pinned
```

Derived at render time from the candidates list (`coords` present vs missing), no new frontmatter needed. Self-correcting — if the user manually fixes coords or the candidate is later re-geocoded, the count updates on next page load. Degrades gracefully — older trips that never went through the geocode pass still render correctly.

When the geocode job is *in flight*, the count is in-progress and the hint can read `Geocoding 8 of 15…` instead, tied to the same polling that drives the badge.

### "Unmapped" affordance is unchanged

The brochure already shows an "unmapped" tag for stops whose pin we couldn't geocode (per `CLAUDE.md`'s brochure description). That behavior carries over — failed-to-geocode candidates simply stay `coords: null` and surface as unmapped in both the brochure and the destination map's pin overlay.

## Migration sketch

No on-disk data migration. The candidates file format already tolerates missing `coords` (the geocoding loop writes `coords` only when a result comes back).

Code migration:

- **`realizePlan()`** (post-#380 name; today `extractCandidates()`) writes candidates with `coords: null` and returns immediately after the file write. The geocode loop moves out.
- **New module** `src/lib/server/geocode-job.js` (or extend an existing one) holds the loop logic: read candidates from disk, iterate, call `geocodeCandidate`, write back incrementally.
- **New endpoint** `src/routes/api/actions/geocode-candidates/[slug]/+server.js` registers the job via `startJob('geocode-candidates', slug)` and runs the loop. No POST surface to user — only the deepen handler triggers it internally after the LLM completes.
- **Deepen handler** calls the geocode endpoint (or fires the loop directly with its own `startJob`) immediately after `realizePlan()` returns. The deepen job's `completeJob` fires; the geocode job starts.
- **Throttle bug fix** in `candidates.js`: track whether `geocode()` actually did a `fetch()` and skip the post-call sleep when it didn't. Either thread a flag back through `geocode()`'s return value (`{ coords, hit: 'cache' | 'network' }`) or expose a `geocodeWasNetworkRequest()` helper. Minor refactor.
- **Workflow registration**: add `geocode-candidates` to `WORKFLOW_LABELS` in `src/lib/utils/jobLabels.js`, add a `_promise` entry in `promises.js` (~15s hand default, telemetry will recalibrate), add a rate-limit slot if desired (probably not necessary — only the deepen handler triggers it).
- **Candidates section** UI gets the `X of Y pinned` (or `Geocoding X of Y…`) hint based on derived count + presence of an in-flight geocode job.

## Implications for related work

- **[#380](https://github.com/WrongerSandwich/traverse-trip-planner/issues/380) (pipeline consolidation)** — both #353 and #380 touch the deepen handler and `realizePlan()` (post-rename). The second-to-land has to rebase the handler changes. Either order works; the rebase is mechanical, not architectural. No technical dependency.
- **[#341](https://github.com/WrongerSandwich/traverse-trip-planner/issues/341) (disambiguation)** — unchanged. The geocode loop's logic (scoped query, bare fallback, distance check) moves wholesale into the new job without modification. The `MAX_CANDIDATE_DISTANCE_MI = 200` threshold and the off-axis check in `data.js:isOffAxis()` continue to do their work.
- **`add-candidate` and `find-more`** — both endpoints currently call `geocodeCandidate` synchronously for the new candidates they add. Out of scope for this ticket; they're already short single-call paths and the throttle bug fix (Option E) gives them a free win when the queried name was already cached.
- **The geocode cache** stays unchanged. The new job writes to the same `.cache/.geocode-cache.json` via the existing `geocode()` helper.

## Decisions

The open questions from the design discussion, resolved:

- **Two pills, not one.** User signed off that the multi-phase signal is desirable. Implementation: register `geocode-candidates` as a separate workflow in the job registry; existing indicator + badge components handle multi-job presentation automatically.
- **Surface a "X of Y pinned" hint** on the Candidates section header. Derived from candidates list at render time. When a geocode job is in flight for the trip, the hint reads "Geocoding X of Y…" instead.
- **#353 vs #380 ordering: no preference.** Whichever lands first sets the rebase direction for the other; the conflict is mechanical.
- **Failure handling for individual geocodes** — same as today (drop the coord silently, candidate renders as unmapped on the brochure / destination map). The "X of Y pinned" hint surfaces the count without inventing a failure modal.

## Follow-up implementation tickets

1. **Defer candidate geocoding to a follow-on background job** _(opus, medium-large)_ — the core architectural change. New `geocode-candidates` workflow, new endpoint and module, deepen handler triggers it after `realizePlan()`, workflow + promise + label registrations, indicator + badge wire up automatically. Includes the "X of Y pinned" / "Geocoding X of Y…" hint on the Candidates section header.

2. **Fix the throttle to be HTTP-conditional** _(sonnet, small)_ — `geocodeCandidate()` sleeps only after an actual `fetch()`, not on cache hits. Standalone improvement; can land before or after #1. Includes a test that asserts the throttle doesn't fire on a fully-cached lookup.

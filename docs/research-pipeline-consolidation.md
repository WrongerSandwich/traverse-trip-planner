# Research pipeline consolidation

> **Status: shipped.** Option 1 (single envelope) landed via #380; the dead `stops.md` reference cleanup landed via #381. `extract-candidates.js` was renamed to `realize-plan.js`; the extract-only recovery banner and `planExtractionFailed` loader flag are gone. Use this doc as the architectural rationale; the **Current behavior** section reflects the *pre*-consolidation pipeline.

Design doc for [#352](https://github.com/WrongerSandwich/traverse-trip-planner/issues/352) — collapsing the two-leg research/extract pipeline into a single envelope.

## Why the split exists today (vestigial)

The split predates the structured `plan.yaml` / `candidates.yaml` model. The original deepen flow produced pure-prose plans. When the product evolved to support interactive plan editing — drag stops between days, promote candidates, edit field-guide notes — a second pass (`extractCandidates`) was added to extract a deterministic structure from the prose Leg 1 had already written. The two-leg shape is a step in that migration, not a deliberate "use a cheaper model for Leg 2" architecture.

This is load-bearing for the recommendation below: if the split's reason was always "we needed to add structured output to a prose-only flow," then a single envelope that produces both prose *and* structure in one model call is the natural completion of that migration, not a regression.

## Current behavior

### Leg 1 — `doResearch()` (`src/routes/api/actions/deepen/[slug]/+server.js:137-326`)

- One `chat()` call with the `web_search` tool, model `cfg.features.deepen` (typically opus), `maxTokens: 8000` (`promises.js:26`).
- Prompt asks for an XML envelope with four sections: `<overview_prose>`, `<frontmatter>`, `<route_md>`, `<logistics_md>` (`+server.js:158-198`). Note: no `<stops_md>` — `parseSection(text, 'stops_md')` doesn't exist anywhere in the file.
- Writes `planning/{slug}/overview.md`, `planning/{slug}/route.md`, `planning/{slug}/logistics.md` via two-phase .tmp staging + rename (`+server.js:271-310`). On idea-stage flow, also unlinks `ideas/{slug}.md` last.

### Leg 2 — `extractCandidates()` (`src/lib/server/extract-candidates.js`)

- One `chat()` call (no tools), model `cfg.features.extract ?? cfg.features.deepen` (line 85), `maxTokens: 8000`.
- Reads home.md + `overview/route/stops/logistics` from disk (line 79) and feeds them back to the model as user content.
- Parses one outer `<extract>` envelope with two inner `<plan>` and `<candidates>` YAML blocks (lines 70-72, 96-103).
- Merges with any existing `plan.yaml` / `candidates.yaml` (preserves user-added candidates, reassigns colliding ids, surfaces a "renames" banner via overview frontmatter — lines 163-229).
- Geocodes every non-hidden candidate via Nominatim (lines 247-270) — the latency culprit in [#353](https://github.com/WrongerSandwich/traverse-trip-planner/issues/353), 1 req/sec for ~15 candidates.
- Writes `plan.yaml` + `candidates.yaml` via .tmp staging + rename (lines 272-282).

### Coupling artifacts that exist because of the split

- **The `extract-only recovery` branch** in the deepen handler (`+server.js:347-415`). When the handler detects a planning-stage trip without `plan.yaml`, it skips Leg 1 entirely and re-runs only Leg 2. Three-mode dispatch logic with comments explaining each case.
- **The "Retry extraction →" banner** (`+page.svelte:1264-1278`, loader flag `planExtractionFailed` in `+page.server.js`, helper `retryExtraction()` in `+page.svelte`). Real shipped UI that surfaces the recovery affordance to users when Leg 1 succeeded but Leg 2 failed.
- **The legacy `stops.md` reference** in extract's prompt (`extract-candidates.js:36, 66, 79`). Leg 1 stopped producing `stops.md` per the new flow; extract still names it as an input and reads `files.stops ?? ''`. For any post-migration trip the model gets an empty string and silently adapts by extracting from overview/route/logistics prose. The prompt is partial fiction; the comment in CLAUDE.md ("`stops.md` is kept if it already exists as a legacy artifact but is no longer produced") confirms this.

## Findings beyond the ticket

1. **`stops.md` is fully dead in the new flow.** Confirmed by reading both modules.
2. **The "two legs use different models" benefit is theoretical.** `extract-candidates.js:85` falls back to the deepen model; nothing in current configuration sets `TRAVERSE_MODEL_EXTRACT_*` to anything different. In practice, both legs are the same opus call.
3. **Token budgets are symmetric** (`MAX_TOKENS: 8000` for both, per `promises.js`). Single-envelope savings come from the round-trip + disk re-read, not from token totals.
4. **`extractCandidates()` has one production caller** (`+server.js:417`). Bounded refactor blast radius.
5. **The recovery banner exists *only* because of the split.** Without two legs there's no "Leg 1 succeeded but Leg 2 failed" state to recover from.
6. **#353 coupling is weaker than the ticket suggests.** Geocoding is post-LLM disk-side work and runs after `extractCandidates` returns regardless of pipeline shape. Whether deepen is one envelope or two, the geocoding pass still happens at the end. #353 can proceed independently.

## Decision space

### Option 1 — Single envelope (recommended)

One `chat()` call with `web_search` tool. Prompt produces a flat XML envelope with all six sections: the four current prose tags plus `<plan>YAML` and `<candidates>YAML`. The single response is parsed into the same intermediate shapes both legs produce today, then all five files (`overview.md`, `route.md`, `logistics.md`, `plan.yaml`, `candidates.yaml`) are written via a single staged-rename pass. Geocoding runs after the write, as today.

**Why:**

- **The split is vestigial** (see above). Collapsing it is the natural completion of a migration that was always heading this way.
- **One model round-trip instead of two.** Hand-default time drops from 150s toward ~75–90s (research call dominates; the second model call + disk re-read add ~40-60s). Real latency win on the happy path.
- **The recovery banner retires as dead code.** No mid-pipeline failure state can exist; either all files appear or none do. `extract-recovery-banner` UI, `planExtractionFailed` loader flag, `retryExtraction()` helper, and the extract-only branch in the deepen handler all go away.
- **`stops.md` legacy disappears** as a byproduct — single prompt with no fictional input.
- **Cancel semantics simplify.** One controller, one abort, all-or-nothing disk state.
- **The "cheaper Leg 2 model" benefit was never realized** — surrender it without regret.

### Option 2 — Two legs, in-memory handoff

Keep two model calls. Leg 1 returns its parsed sections in-memory; Leg 2 receives them as parameters instead of re-reading disk. Disk write can be batched at the end of both legs (no half-written state) or done per-leg (recovery banner stays).

**Rejected.** The split's only remaining justification is "different model per leg," which we're not exercising. Without that benefit, two round-trips for the cost of one is worse on every axis. If we don't believe in cheap-Leg-2, the split has no purpose worth preserving.

### Option 3 — Status quo + dead-reference cleanups

Drop `stops.md` from extract's prompt, tighten comments, leave the architecture alone.

**Rejected.** Lowest risk, but the recovery banner remains as user-visible scar tissue for a problem we'd be eliminating in Option 1. Pre-launch wins prefer to reduce surface area.

## Known cost being accepted

Single envelope means **a failed deepen requires re-running the full research leg** (web searches + opus reasoning) — there's no cheap-retry path for "only the extract part failed." Today, the recovery banner lets a user retry just the structured-output step at a fraction of the cost.

This is the real trade. Mitigations:

- The recovery state was added to handle model-side flakiness (bad YAML, missing tags) — more of an early-days problem than ongoing operational reality.
- Today's deepen is rate-limited (`endpoint: 'deepen'` in `rate-limit.js`), so re-running isn't free anyway.
- The retry friction is one extra ⋯ menu click and ~90s wait. Not zero, but bounded.

The user wins simpler mental model + faster happy path; loses cheap-retry for the rare extract-only failure. Net: simplification.

## Migration sketch

No on-disk data migration. The output files are identical (`overview.md` / `route.md` / `logistics.md` / `plan.yaml` / `candidates.yaml`). Existing trips in any stage are unaffected.

Code migration is one coherent change because the seams are tightly coupled:

- **Prompt:** extend deepen's existing prompt to add `<plan>` and `<candidates>` YAML sections, drawing the extract-side guidance (8–15 stops across categories, 2–5 lodging at varying price tiers, no restaurants unless food-themed, etc.) from `extract-candidates.js:32-66`.
- **Single `chat()` call** with the merged system prompt, same `web_search` tool, `maxTokens` adjusted to accommodate the larger response (proposal: 12000, up from 8000).
- **`extractCandidates()` refactors** from "make a chat call and process the result" to "given a parsed `<extract>` block, process the result." Its merge logic, geocoding, file writes, and rename tracking stay intact — only the chat call moves out. Could keep the module name or rename to `processPlanAndCandidates`, either way.
- **`doResearch()` collapses** with the new combined flow; the staged-rename pass writes all 5 files atomically (extending the existing 3-file pattern at `+server.js:271-310`).
- **`POST` handler simplifies** — the three-mode dispatch (`+server.js:344-415`) becomes two modes: idea-stage (full deepen) or planning-stage (full re-research, gated by `plan_prose_present` dirty-section check). The extract-only branch goes away.
- **UI cleanup**: remove `extract-recovery-banner` markup and `retryExtraction()` from `+page.svelte`; remove `planExtractionFailed` from `+page.server.js` loader.
- **Tests**: `tests/api-deepen-extract.test.js` either collapses into `tests/api-deepen.test.js` or stays as a focused test of the structured-output parsing. `tests/extract-candidates.test.js` becomes a test of the refactored "process parsed extract" function.

This is one PR's worth of work. Splitting it would leave the codebase mid-migration — backend with no UI cleanup leaves dead banner code; UI cleanup with no backend collapses retries that no longer exist.

## Implications for related work

- **[#353](https://github.com/WrongerSandwich/traverse-trip-planner/issues/353) (non-blocking geocoding)** — unchanged in scope. Geocoding is a post-LLM disk-side operation in both pipeline shapes. #353's design space (defer to follow-on job, parallel geocoder, model-emitted coords, pre-warm cache) is the same after this change.
- **[#343](https://github.com/WrongerSandwich/traverse-trip-planner/issues/343) / [#344](https://github.com/WrongerSandwich/traverse-trip-planner/issues/344) (recovery banner)** — retire entirely. The banner exists only because of the split.
- **[#349](https://github.com/WrongerSandwich/traverse-trip-planner/issues/349) (extract renames banner)** — unaffected. The merge logic + frontmatter renames signal lives in the refactored module and works the same.
- **CLAUDE.md** — the section that says "`stops.md` is kept if it already exists as a legacy artifact but is no longer produced" stays accurate (legacy trips on disk are untouched); the new prompt simply no longer references the file.
- **`docs/ai-workflow-ux.md`** — verify no specific reference to "Leg 1 / Leg 2" or "extract-only recovery" that would go stale.

## Follow-up implementation tickets

1. **Consolidate the deepen + extract pipeline into a single chat envelope** _(opus, large, cohesive)_ — the prompt merge, the chat-call collapse, the `extract-candidates.js` → `realize-plan.js` rename + refactor, the deepen-handler simplification (drop the extract-only branch), the recovery-banner UI cleanup (remove `extract-recovery-banner` markup, `planExtractionFailed` loader flag, `retryExtraction()` helper), and the test reshape, all in one PR. Splitting introduces mid-migration states.

2. **Retire dead `stops.md` references across the codebase** _(sonnet, medium)_ — broader cleanup than initially scoped. After ticket #1 the extract prompt no longer mentions `stops.md`, but other surfaces still pretend it exists:
   - `src/routes/api/actions/deepen-section/[slug]/[section]/+server.js:43-45` — has a `stops_md` tag definition with full guidance, but `RESEARCHABLE = new Set(['route', 'logistics'])` in `+page.svelte:273` means the UI never exposes "research stops" as a section. Dead end-to-end; delete the slot.
   - `src/routes/api/actions/deepen/[slug]/+server.js:159, 192` — prompt rules section mentions "route_md / stops_md / logistics_md" formatting even though `stops_md` isn't in the asked-for tag set. Stale fragment.
   - `src/routes/api/trip/[slug]/chat/+server.js:79` — chat system prompt lists `stops.md` as a planning section the user might be iterating on. Misleading for new trips.
   - `CLAUDE.md:133` — "Research subagents write to their own files (`route.md`, `stops.md`, etc.)" — drop the stale mention.
   - `.claude/agents/researcher.md:43` — "Notable stops (for `stops.md`)" section in the subagent prompt. Retire.
   - `src/lib/server/markdown-cleanup.js:4` — comment example uses `<stops_md>`. Cosmetic; update.
   - Tests using the `<stops_md>` tag (`tests/ambient-job-rejection.test.js`, `tests/api-deepen-section.test.js`) — review for dead-code-path coverage and update or drop.
   - **Keep:** the legacy disclosure in `+page.svelte:1406` and surrounding CSS (`+page.svelte:1998`) — these render legacy `stops.md` content for trips that have it on disk. Real user data; the disclosure stays as the read-only fallback.
   - **Keep:** `CLAUDE.md:39` — "`stops.md` is kept if it already exists as a legacy artifact but is no longer produced" remains accurate.

   Independent of #1 timing-wise (no code dependency either way), but better to land *after* #1 so the prompt rewrite is the canonical "no more stops.md production" moment and this ticket is purely retirement of references that already shouldn't be there.

Note: no separate `docs/ai-workflow-ux.md` ticket — `grep` confirms the doc has no references to the two-leg shape or extract-only recovery to retire.

## Decisions

The open questions from the design discussion, resolved:

- **`maxTokens` for the merged call: start at 12000.** Both legs are at 8000 today; combined response is prose + structured YAML in one envelope. 12000 is the starting budget; instrument the first real runs and tune via telemetry (the `workflow-stats.js` rolling p50 already does this for the `deepen` label).
- **XML shape: flat.** Six top-level tags — `<overview_prose>`, `<frontmatter>`, `<route_md>`, `<logistics_md>`, `<plan>YAML`, `<candidates>YAML`. Six `parseSection()` calls, no nested regex. The current `<extract>` outer wrapper goes away.
- **Module rename: yes.** `src/lib/server/extract-candidates.js` → `src/lib/server/realize-plan.js`. The exported function becomes `realizePlan(slug, parsedExtract, { signal })` or similar — the chat call has moved into deepen, so the function's job is now "given the parsed extract block, build plan.yaml + candidates.yaml on disk." Pre-launch accuracy beats churn-avoidance.
- **Rate-limit slot:** no action needed. The existing rate limit is keyed on `'deepen'` and that key still owns the combined operation; no separate `extract` slot exists to retire.

## Accepted trade

The cheap extract-only retry affordance goes away. A failed deepen requires re-running the full web-search leg. If this turns out to bite in practice (e.g. the model gets sloppy with YAML and parser failures become frequent), revisit by adding a narrower fallback: "if the prose sections parsed but the YAML didn't, re-prompt the model with just the parsed prose as input and ask only for the structured tags." That's a follow-up if needed, not a blocker.

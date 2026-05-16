# Lifecycle simplification: drop `exploring`, demote `locked`

**Date:** 2026-05-16
**Status:** Approved
**Origin ticket:** [#112](https://github.com/WrongerSandwich/traverse/issues/112)

## Problem

The trip lifecycle has four user-visible stages — `idea`, `exploring`, `planning`, `completed` — plus a `locked` boolean on planning trips. Two of those distinctions don't earn their keep.

**`exploring` vs `planning` is doing no work.** Both stages share the same canonical section set (`overview`, `route`, `stops`, `logistics`), the same research affordances (deepen-section in both, when not locked), and the same editing UX. The promote endpoint is a folder rename plus a status flip. The frontmatter fields added at planning (`target_date`, `lodging`, `cost_estimate_usd`, …) are all optional — the stage doesn't gate them. The only behavior that differs in code is the Ask Field guide chat, which is gated on `isPlanning && !isLocked` in `src/routes/trips/[slug]/+page.svelte:996`. That gate is arbitrary, not stage-driven.

**Locking is doing two jobs, only one of which needs a state.** The real job is "synthesize an itinerary from sections" — that's a generation step. The freezing-of-edits is policy enforcement that prevents drift between sections and the synthesized itinerary, but it imposes real friction: a typo fix requires unlock → edit → re-lock, costing ~30s and tokens. The codebase already has a near-identical workflow that doesn't freeze: **brochure**. It extracts structured data from planning sections, you can edit it, you can regenerate. Same drift problem, simpler solution.

## Goals

1. Reduce the number of stages the user has to reason about.
2. Stop forcing the unlock-to-edit cycle.
3. Keep the synthesized itinerary as an artifact users can produce and print.
4. Preserve all existing trip content during migration.

## Non-goals

- Renaming the remaining stages. "Idea" / "planning" / "completed" are clear enough; cosmetic renames are out of scope.
- Changing the brochure workflow.
- Changing the deepen / deepen-section workflows.
- Changing share-token behavior.

## Approach

**Collapse to three stages — `idea` → `planning` → `completed` — and demote locking from a state to an artifact.**

### Stages

- `idea` (unchanged): single `.md` file in `ideas/`.
- `planning`: folder in `planning/` with `overview.md` and any of `route.md`, `stops.md`, `logistics.md`, `itinerary.md`. Replaces both today's `exploring` and `planning`.
- `completed` (unchanged): folder in `completed/` with `notes.md` added.

The deepen action (currently "Research →" on idea cards) promotes `idea` → `planning` directly. No intermediate `exploring` step.

### Itinerary as artifact, not state

- "Lock trip" → **"Generate itinerary"** action. Same In-Page Stream UX (banner + streaming body) — only the verb changes and it no longer sets frontmatter.
- `locked: true` frontmatter is removed from the schema. Any existing instances are stripped during migration.
- Editing and Ask Field guide remain available regardless of whether `itinerary.md` exists.
- The itinerary tab appears whenever `itinerary.md` exists in the trip folder.
- Print/Save PDF moves to the itinerary tab (visible only when an itinerary exists). Today it's gated on `locked` state.

### Staleness

When source sections have been edited since `itinerary.md` was last generated, the itinerary tab shows a "Sections have changed — regenerate?" affordance. Same staleness pattern brochure uses today. Comparison is mtime-based: if any of `overview.md` / `route.md` / `stops.md` / `logistics.md` has an mtime newer than `itinerary.md`, it's stale.

### Assistant chat

Available throughout `planning` (no longer gated on lock state).

## Affected surface

- **Routes:** `src/routes/api/promote/[slug]/+server.js` (delete), `src/routes/api/lock/[slug]/+server.js` (rename / repurpose to itinerary-generate; drop DELETE), `src/routes/api/actions/deepen/[slug]/+server.js` (promote target changes from `exploring` to `planning`).
- **Data layer:** `src/lib/server/data.js` — stage iteration (~6 sites), `setLocked()` removal, `readPlanningTrip()` already keyed on `planning/` (no change), section-set definitions.
- **Detail page:** `src/routes/trips/[slug]/+page.svelte` — `STAGE_SECTIONS` (drop `exploring`), `isLocked`-conditional rendering throughout, chat-gating removal, lock-callout removal, itinerary-tab visibility rule, staleness indicator.
- **Cards:** `src/lib/components/TripCard.svelte` — drop the "Start planning →" CTA on exploring cards, drop the `· locked` badge suffix.
- **Detail panel:** `src/lib/components/DetailPanel.svelte` — drop the `isExploring` branch and "Start planning →" button.
- **Tests:** any test referencing `exploring/` paths, `locked: true` frontmatter, or the promote/lock endpoints.
- **Docs:** `CLAUDE.md` lifecycle and frontmatter sections, "In-browser actions" table; `AGENTS.md` if needed (likely not — it doesn't enumerate stages); `home.md` (no stage references today, but check); `PRODUCT.md` if it mentions the split.

## Migration

Mechanical, run once during the rollout of ticket #1:

1. For each folder in `exploring/`, move to `planning/<slug>/` and rewrite `status: exploring` → `status: planning` in `overview.md`.
2. For each folder in `archived/exploring/`, move to `archived/planning/<slug>/` and rewrite status the same way. (Archived trips are still scanned for seed-avoidance.)
3. For any trip in `planning/` (post-migration) with `locked: true` in frontmatter, strip the field. Leave `itinerary.md` in place — it's still valid content.

Current state: 5 trips in `exploring/`, 0 in `planning/`. Migration is fast and reversible from git.

## Implementation order

#1 is a prerequisite for the others. The rest can land independently or be bundled.

1. **Drop `exploring` stage; collapse into `planning`.** Migration, route removal, stage-iteration updates, card/detail CTA removal, docs.
2. **Open assistant chat throughout `planning`.** Drop the lock-conditional gate on the assistant chat. (Pre-#3 cleanup so chat behavior is consistent regardless of lock state during the transition.)
3. **Demote locking to on-demand itinerary generation.** Replace lock endpoint with generate-itinerary; drop `locked: true` reads/writes; remove unlock button and section-locked hints; itinerary tab follows `itinerary.md` existence.
4. **Itinerary staleness indicator.** mtime-based check + regenerate affordance on the itinerary tab.
5. **Print/Save PDF moves to the itinerary tab.** Currently lives on the locked detail view; needs to follow itinerary, not lock state.
6. **Docs sweep.** `CLAUDE.md` lifecycle + "In-browser actions" + frontmatter schema; verify `AGENTS.md`, `home.md`, `PRODUCT.md`.

## Risks

- **Brochure references planning sections** — verify it still works when `itinerary.md` exists alongside (it doesn't read itinerary today, so should be unaffected).
- **Share tokens encode the slug, not the stage** — no impact.
- **The In-Page Stream UX for generate-itinerary** stays identical, so users won't see a behavior change there beyond the loss of "locked" status visibility.
- **Existing `locked: true` trips in user's own data** — handled by the migration step. If any escape the migration, the detail page should gracefully ignore the field; existing checks become dead code that gets removed in #3.

## Open questions

None blocking. Possible follow-ups (not part of this design):

- Should the itinerary tab become the default view when an itinerary exists? (Today: overview is default; itinerary appears as a tab.)
- Should "Generate itinerary" become Ambient Background instead of In-Page Stream? It's borderline at ~30–60s. Keep In-Page Stream for now; revisit if users want to navigate away mid-generation.

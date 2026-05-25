# In-UI unarchive

> **Status: shipped.** Option B (Show-archived filter toggle) landed via #384 — the `/api/unarchive/[slug]` endpoint, `moveTrip()` file/dir extension, archived card treatment, and filter toggle are all live. `docs/manual.md` §12 was updated to describe the in-UI flow.

Design doc for [#365](https://github.com/WrongerSandwich/traverse-trip-planner/issues/365) — closing the archive loop in the browser instead of requiring filesystem operations.

## Current state

Archive is a first-class browser action: `⋯` menu → Lifecycle → Archive, gated by a confirm modal, POSTs to `src/routes/api/archive/[slug]/+server.js`. The handler is a 35-line `renameSync` that moves the trip's file or folder to `archived/<source-stage>/<slug>` and invalidates the enrich cache. No frontmatter mutation — the trip's `status` is unchanged.

Unarchive requires a manual `mv` in a terminal. `docs/manual.md` §12 is honest about this, but the asymmetry is exactly what four out of five Sonnet reviewers flagged: if archive is supposed to feel low-stakes ("you can always undo it"), hiding the undo path in the filesystem undercuts that goal.

## Findings beyond the ticket

### 1. The seed-avoidance question is already resolved by existing code

`src/lib/server/destinations.js:21-33` — `collectExistingDestinations()` scans **both** `<stage>/` and `archived/<stage>/` for destinations and concatenates them into one list. Whether a trip is archived or live doesn't affect whether the seed action sees its destination. So the ticket's "do unarchived trips re-enter the seed-avoidance scan?" question is moot: they already are in it (because archived ones are too). Unarchive is just a `renameSync` between two directories that both feed the same scan. The contract is preserved automatically; no special handling needed.

### 2. The archive handler already anticipates this work

`src/routes/api/archive/[slug]/+server.js:31-34`:

```
// TODO: ideas are single .md files while multi-stage trips are directories,
// so archive can't reuse moveTrip() from data.js without teaching it about
// the file/dir distinction. Extend moveTrip() if unarchive support is added.
```

So the original author flagged the moveTrip() refactor as a follow-on if/when unarchive landed. This ticket is the moment.

### 3. Confirmation dialog asymmetry is justified

Archive has a confirm modal because it's a destructive action (the trip disappears from the UI). Unarchive is the opposite — making something more visible, not less. The worst-case accidental unarchive: the user re-archives. No data loss. Symmetric confirmation would add friction with no protective value.

### 4. Slug collision is a real edge case

Archive's POST checks `if (existsSync(dest)) return 409 'Already archived'`. The same check applies in reverse: if a user archives `smithville-backroads`, then creates a new idea also slugged `smithville-backroads`, an unarchive attempt would clobber the new trip. The unarchive endpoint must do the symmetric existence check and reject with a clear error.

### 5. Legacy `exploring/` stage — out of scope

The `exploring/` stage was retired (per CLAUDE.md), but `collectExistingDestinations` still scans `archived/exploring/` for old trips so their destinations stay in the seed-avoidance list. Per design call: the in-UI unarchive does **not** surface or restore these. They remain on disk as seed-avoidance fodder only. A user who wants to resurrect one of those can still `mv` it manually.

## Decision space

### Option A — Dedicated `/archived` view

A sub-page (under `/settings`, or a new top-level route) listing archived trips with restore buttons.

**Pros:** Clean mental model, doesn't clutter main grid, room to grow (could show why/when archived, sort, search).
**Cons:** New route, discoverability cost (user has to know to navigate there), heavier-weight than the use case warrants for a personal-scale tool.

### Option B — "Show archived" filter toggle (recommended)

Add a toggle to the existing filter panel (`+page.svelte:1035-1071` — sibling to Drive time / Budget / Parks / Saved filter groups). When on, archived trips appear in the main grid with a visual treatment that distinguishes them. Each card surfaces a `Restore` action.

**Pros:** Discoverable via the existing filter affordance. No new route. Restore is one click. Archived trips are visible in context with active trips, supporting "show me what I have" browsing including the rejected pile.
**Cons:** When toggled on with many archived trips, the grid can get busy. Visual treatment matters (see UX spec below).

### Option C — Kebab menu picker

A new kebab entry that opens a list/dialog of archived trips to restore from.

**Rejected.** Semantically off — the kebab is a per-trip menu. "Show me a list of unrelated archived trips" doesn't fit that mental model.

### Option D — No UI, document better

**Rejected.** Defeats the ticket's premise; the manual already documents the workaround and reviewers consistently flagged it as insufficient.

## Recommendation: Option B

For a personal-scale tool with a bounded archive count (likely <50 over the product's life), the filter toggle is the lowest-friction path. The visual treatment (see below) keeps archived trips clearly distinct without dominating the main grid, and the restore affordance lives on the card itself — same place the user already looks for per-trip actions.

A dedicated view would make sense if the archive grew to hundreds of items or if you wanted browse-the-rejected-pile metadata (date archived, reason). For now it's overkill.

## UX spec

### Filter toggle

New entry in the filter panel, in the same shape as the existing groups:

```
Show archived  [ ☐ ]    (5)
```

The trailing count is derived at render time from the archived directory scan. Subtle — same `--text-tertiary` color as the existing `(N)` counts elsewhere.

When toggled on:
- The archived trips for the currently-selected stage tab appear inline with active trips.
- An active "Show archived" chip appears in the active-pills row (same affordance as other filters) so the user can dismiss it without reopening the panel.

### Card visual treatment for archived trips

- **Opacity:** 55-60% on the entire card (background, image, text). Reads clearly as "muted / inactive."
- **Badge:** In the corner where the stage pill normally sits, render an `Archived` badge in a muted-grey palette (sibling to the existing stage pills but desaturated). Replaces the stage pill while the trip is in the archived view; restoring brings the stage pill back.
- **CTA replacement:** Where an idea card would normally have `Research →` and a planning/completed card would have nothing, archived cards have a single `Restore` button. Same compact button style as `Research →`.
- **Hover state:** Cards reach ~75% opacity on hover, signaling the restore affordance is interactive.

### Restore interaction

- No confirm dialog (see finding #3).
- Optimistic UI: card flashes briefly to its restored state (opacity returns to 100%, stage pill replaces Archived badge), then `invalidateAll()` refreshes the trip list.
- On failure (slug collision, FS error): inline error sentence above the card with affordance buttons (Retry / Dismiss) per the standard pattern in `ERROR_REGISTRY`.

### Empty state

When the toggle is on but no archived trips exist (or none match the current stage tab): "No archived trips for this filter." Same shape as the existing empty grid copy.

## Implementation sketch

### New endpoint `src/routes/api/unarchive/[slug]/+server.js`

Mirror of the archive handler. Resolves the trip's location under `archived/<stage>/`, moves it back to `<stage>/`, invalidates the enrich cache. Returns `409 Already exists` if the target slug is already taken in `<stage>/` (the symmetric edge case to archive's existing 409).

Skip surfacing trips whose source stage is `exploring` — those stay on disk for seed-avoidance only (finding #5).

### Extend `moveTrip()` in `src/lib/server/data.js`

Per the existing TODO comment, extend the helper to handle both file (idea) and directory (planning/completed) shapes. Then both archive and unarchive can reuse it cleanly.

### Loader change in `src/routes/+page.server.js`

When `?show_archived=true` is in the URL (or whatever state-mirror approach the existing filters use), also list trips from `archived/<stage>/` and tag each with `_archived: true` so the card component can pick the right visual treatment. Skip `archived/exploring/`.

### Component changes

- **`TripCard.svelte` / `TripRow.svelte`** — accept an `archived` prop, conditionally render the muted treatment + Archived badge + Restore CTA.
- **`+page.svelte`** — wire up the filter toggle, the active-pill chip, and the restore handler that POSTs to the new endpoint.

### Tests

- Endpoint: success, 404 (not in archived/), 409 (slug collision in target stage), invalid slug.
- Loader: with toggle off, no archived trips; with toggle on, both active + archived appear with the `_archived` tag.
- E2E (or unit on the wiring): clicking Restore POSTs to the endpoint and refreshes the list.

## Decisions

The open questions from the design discussion, resolved:

- **Affordance location: filter toggle (Option B).**
- **Visual treatment: 55-60% opacity + "Archived" badge replacing stage pill + "Restore" button replacing the idea-card CTA slot.**
- **No confirm dialog on restore** — archive's confirm exists because hiding is destructive; restoring is not.
- **Slug collision: 409 Already exists** — symmetric to archive's existing check.
- **Legacy `exploring/` stage: not supported in the UI.** Those trips stay on disk for seed-avoidance purposes; the unarchive filter doesn't surface them. Manual `mv` remains the path if the user ever wants to resurrect one.
- **Seed-avoidance contract: unchanged.** `collectExistingDestinations()` already scans both sides; no code change needed.

## Follow-up implementation tickets

1. **In-UI unarchive: filter toggle, archived card treatment, endpoint** _(sonnet, medium-cohesive)_ — the whole thing in one PR. Includes the new `/api/unarchive/[slug]` endpoint, the `moveTrip()` extension for file/dir handling (per the existing TODO), the loader change to include archived trips when the toggle is on, the card visual treatment for the archived state, the filter toggle wiring (panel entry + active pill + URL state), and tests. Sonnet-grade work — mechanical UI + endpoint following established patterns.

   No separate doc-update ticket: `docs/manual.md` §12 currently describes the filesystem workaround. The implementation ticket includes a small docs update replacing that section with a description of the in-UI flow ("toggle Show archived in the filter panel, click Restore on the card") and removing the manual-`mv` instructions.

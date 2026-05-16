# Planning detail page — Read / Edit mode IA

**Date:** 2026-05-16
**Status:** Approved
**Origin ticket:** [#134](https://github.com/WrongerSandwich/traverse/issues/134)
**Related:** [#112 lifecycle simplification](2026-05-16-lifecycle-simplification-design.md), [#133 brochure-itinerary reconciliation](2026-05-16-brochure-itinerary-reconciliation-design.md) — this design picks up the simplification thread from those.

## Problem

The planning detail page (`/trips/<slug>`) has accumulated ~12–15 interactive controls visible at once on a fully-populated trip. Inventory after the recent simplification arcs:

- **Planning callout:** Preview brochure, Mark as completed
- **Itinerary view:** Print / Save PDF
- **Per-section (×4):** Edit (when populated) or Research this section → (when empty)
- **Share zone:** Generate share link / Copy / Disable
- **Brochure zone:** View brochure, Open prepare form, Prepare brochure (+ Re-prepare in staleness notice)
- **Chat FAB:** Ask Field guide

The growth was incremental. Nobody designed it as a whole. The page feels administrative — five+ AI workflow entry points plus per-section editing plus chat — which fights PRODUCT.md's design principles ("anticipation over administration", "earn every pixel of complexity", "mobile as first-class").

## Goals

1. Cut the visible-affordance density roughly in half by default.
2. Match PRODUCT.md's mobile-as-reference framing: the default state of the page should be "I'm looking at my trip," not "I'm shaping my trip."
3. Keep every existing capability reachable. No feature removal.
4. Preserve the chat FAB as the persistent ad-hoc affordance.

## Non-goals

- Changing the cards / home page layout.
- Changing the brochure layout at `/trips/<slug>/brochure` or the share view.
- Changing the chat panel itself.
- Touching the lifecycle stages (idea/planning/completed) or any backend behavior.

## Approach

**Two-mode interface, default Read mode, single header toggle into Edit mode. Lifecycle and sharing actions consolidate into a `⋯` header menu always available in both modes.**

### Read mode (default)

The "I'm looking at this trip" state. Visible:
- **Header band** (unchanged structure): ← All trips · stage pill · title · meta · job badge.
  - **New** at the right of the header: `✎ Edit` button + `⋯` menu button.
- **Hero photo + vibe label** (unchanged).
- **Map strip** (unchanged).
- **Itinerary view** when `brochure.days` or legacy `itinerary.md` exists:
  - Top-right of the block: `View full brochure ↗` link + `Print` button.
  - Body: rendered day-by-day.
- **Itinerary empty-state** when neither exists (planning only): a single inline placeholder with a `Prepare brochure to generate a day-by-day view` CTA. Triggers the same Ambient Background prepare flow.
- **Sections** (Overview, Route, Stops, Logistics): rendered as prose only. No `Edit` button. No `Research this section →` button. Empty sections show their existing placeholder text but no inline action.
- **Chat FAB** (unchanged): bottom-right, persistent, opens the chat panel.

Hidden in Read mode:
- `Mark as completed` button (moved to `⋯` menu).
- Brochure staleness notice (it's an authoring nudge; user came to look, not act).
- Per-section `Edit` / `Research this section →` buttons.
- Inline brochure controls (Prepare / Re-prepare).
- The old "Brochure zone" block at the bottom of the page (deleted entirely — its functions are reachable from the itinerary view header and the `⋯` menu).

### Edit mode (toggled on)

User clicks `✎ Edit`; the button becomes `✓ Editing` (highlighted/pressed state). The page does not change layout — only adds affordances.

Visible in addition to everything in Read mode:
- **Top-of-content banner:** "You're editing — section actions + brochure controls are visible below." Subtle amber accent.
- **Itinerary view** gets an inline `Re-prepare brochure` button (or `Prepare brochure` if absent) alongside the existing Print / View full brochure controls.
- **Brochure staleness notice** appears (when `data.brochureStale` is true) directly inside the itinerary view block, with its inline `Re-prepare brochure` button.
- **Per-section affordances** appear:
  - Populated section → `Edit` button in the section header. Clicking opens the existing inline editor (textarea + Save/Cancel).
  - Empty section → `Research this section →` button in the section's empty-state block.

Clicking `✓ Editing` again returns to Read mode. **Exception:** if any section has an open editor (with or without unsaved draft), the toggle remains in Edit mode and surfaces a tooltip "Finish editing the open section first." This avoids surprise data loss.

### `⋯` menu (lifecycle + sharing)

Always available in both modes. Opens a dropdown anchored to the header button.

**Planning trip:**
- Output
  - `↗ View full brochure` — opens `/trips/<slug>/brochure` in a new tab.
  - `🔗 Generate share link` (when `data.features?.share`) — toggles share. When already shared, shows the URL inline with a Copy action + a Disable item below.
- Lifecycle
  - `✓ Mark as completed`
  - `🗑 Archive`

**Completed trip:**
- Output
  - `↗ View full brochure`
  - `🔗 Generate share link` / share URL controls
- Activity
  - `📝 Add retro` (when `!hasNotes && data.features?.retro`)
  - `🧾 Add receipts` (when `data.features?.receipts`)
- Lifecycle
  - `🗑 Archive`

**Idea trip:** out of scope — that lifecycle stage uses the home detail panel, not this page.

The Share affordance lives inside the menu rather than as a dedicated zone below the sections. When a share link is active, clicking the menu item reveals the URL + Copy / Disable in a sub-row of the menu (or in a small popover anchored to the menu item — implementation detail).

### Empty state for trips without a brochure

In Read mode, the slot the itinerary view would occupy renders a single block:

```
+-------------------------------------------------+
|  No itinerary yet.                              |
|                                                 |
|  [ Prepare brochure to generate a day-by-day ]  |
|                                                 |
|  ~45s, ~2–5k tokens · runs in the background    |
+-------------------------------------------------+
```

This is the only AI-trigger affordance in Read mode for a planning trip. Triggers the existing Ambient Background prepare flow. The promise sentence below the button reuses the existing `BROCHURE_PROMISE` data so the time/token estimate stays accurate.

### Completed trips

Edit mode is not meaningful for completed trips (sections are preserved; no editor surfaces). The `✎ Edit` button is hidden on completed trips. The `⋯` menu still appears with the completed-trip item set.

The completed callout ("Completed. This trip is done. All sections are preserved below.") stays in Read mode at the top of the content area, but its inline `Add retro` / `Add receipts` buttons move into the `⋯` menu under the **Activity** section. This keeps the completed view clean — the callout becomes purely informational.

### Behavior details

- **Mode state** lives client-side only (`let editMode = $state(false)`). Resets on page reload — the default is Read mode every time you open the page. No URL param, no frontmatter persistence.
- **Mode persistence across sections:** while in Edit mode, opening and saving a section keeps the user in Edit mode. Saving alone doesn't auto-exit.
- **Mode persistence across an in-flight section editor:** as noted above, the toggle is locked while any section has `editing[section] === true`. The user must Save or Cancel the section first.
- **Brochure prepare during Read mode:** if the user triggered Prepare from the Read-mode empty state, the page stays in Read mode while the Ambient Background job runs. On completion, the itinerary view appears in the slot. (No automatic mode flip.)
- **Brochure failure surfacing:** errors from the prepare flow always render (Read or Edit mode), since they indicate the system failed and need user acknowledgment. Located inline within the itinerary slot, replacing the empty-state block when applicable.
- **Job badges and the global indicator:** unchanged. Mode is purely a layout concern.
- **Print** continues to use `window.print()` on the detail page with the existing print CSS. The `View full brochure ↗` link is the path to the structured brochure layout (which has its own print path).

## Affected surface

- **`src/routes/trips/[slug]/+page.svelte`** — most of the change. Add `editMode` state. Restructure the callout / sections / brochure-zone / share-zone markup. Hide actions per-mode.
- **`src/lib/components/KebabMenu.svelte`** (new) — small dropdown primitive. The codebase doesn't have one today. Use a native `<details>`-based pattern for no-JS-required-or-progressive enhancement, or a `$state`-managed dropdown if accessibility / click-outside dismissal matters. Implementation choice for the ticket.
- **`src/lib/components/EmptyItineraryCTA.svelte`** (new) — the Read-mode empty-state block. Houses the "Prepare brochure to generate a day-by-day view" CTA + promise tooltip + Prepare button. Small.
- **Style cleanup:** drop `.brochure-zone`, `.brochure-row`, `.share-zone` block-level CSS in favor of inline-within-menu styles + the new empty-state block styles. Drop the old "Planning mode." callout if its only content was Preview brochure + Mark complete (both moving) — keep a slim mode banner that appears in Edit mode only.
- **Tests:** add tests for `KebabMenu` (or for whatever pure helper the menu logic factors into), and for the Read-mode empty-state visibility logic.
- **Docs:** `CLAUDE.md` "In-browser actions" table updates — Mark complete / Share / Archive move from inline rows to a "⋯ menu" note. Document the Read / Edit mode default and toggle.

## Implementation order

#1 is the prerequisite for everything else. #2–#4 can land independently or be bundled.

1. **Add Read mode + Edit mode toggle, restructure markup.** Add `editMode` state, gate per-section affordances + brochure staleness on the toggle, add the editing banner. Don't yet move lifecycle actions out of the callout — Mark complete and Share can stay inline temporarily. The skeleton change.
2. **Add `KebabMenu` component + move lifecycle/sharing items in.** Mark as completed, Generate share link, Archive, View full brochure go into the menu. Drop the share zone and the old "Brochure zone" block. Drop "Preview brochure" from the planning callout (moves to menu as "View full brochure").
3. **Add `EmptyItineraryCTA` for trips without a brochure** (Read mode). The current behavior of "no itinerary view block when no brochure" gets replaced with the placeholder + Prepare button.
4. **Docs sweep.** `CLAUDE.md` "In-browser actions" table reflects the menu and the modes; any other docs that reference the page layout get a pass.

#3 is independent of #2 conceptually but they overlap visually — it's fine to bundle. #4 trails the code.

## Migration / risk

- **Risk: user looks for a button that moved.** Mark as completed and Share both move into the `⋯` menu. Mitigation: the menu is visible in both modes and the button position (top-right of the header) is consistent. PRODUCT.md notes ~30 trips total — the user will adapt within a session or two.
- **Risk: empty-state CTA discoverability.** A user with a brochureless trip in Read mode needs to find the Prepare CTA. Mitigation: the empty-state block is centered in the page, not buried. The CTA copy is explicit.
- **Risk: edit-mode discoverability.** A user trying to edit a section in Read mode sees no Edit button. Mitigation: the `✎ Edit` toggle in the header is large enough and uses a familiar icon. If a section's rendered prose is interpreted as "fixed text," it'll be obvious there's a mode to flip.
- **No data migration.** Mode is ephemeral client state. No frontmatter changes.

## Open questions

None blocking. Possible follow-ups:

- A future enhancement could add hover affordances on desktop: hovering a section header reveals an inline Edit button without entering global Edit mode. Could be a follow-up if Read mode feels too modal.
- The `⋯` menu could later host a small icon next to its label to indicate state (e.g. a green dot when sharing is active). Out of scope.
- Mobile-specific considerations: the menu likely needs a slightly larger tap target than desktop's icon button. Handled by `--tap-min` per existing conventions.

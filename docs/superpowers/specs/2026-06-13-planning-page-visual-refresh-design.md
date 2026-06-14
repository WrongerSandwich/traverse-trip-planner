# Planning page visual refresh — Direction B, tiered (design)

**Date:** 2026-06-13
**Issue:** TBD — to be filed (break into a sonnet ticket chain after spec sign-off)
**Milestone:** TBD — planning-page polish pass
**Status:** Draft — pending plan + implementation

## Problem

The planning **detail page** (`/trips/[slug]` at planning stage) works but reads as a flat
stack of near-identical cream boxes. Every section — Overview, Route, Logistics, Plan,
Candidates — wears the same large border on the same surface, so nothing signals which one
matters; the page has no hierarchy. The top of the page (dark header band → hero → meta
strip → overview map) consumes a full screen before any *plan* content appears. Inside the
Plan and Candidates sections the detail is busy and tool-like: literal "drag" text on
handles, link-styled disclosure summaries, drive badges floating at the right edge, and a
lot of competing 11–13px text. Depth is flat — everything is an outlined box with almost no
elevation or softness. On desktop the single column wastes the width.

The brand itself is strong (the warm "Dusk" palette, Fraunces serif headings, the semantic
token system, dark mode). The goal is a **complete visual + layout refresh that makes the
page feel polished, sleeker, and clearly structured — entirely within the existing brand and
token discipline.** This is a styling/layout change only: no feature, data, or behavior
changes.

## Validated design decisions

These were settled during brainstorming (visual mockups reviewed on the LAN companion):

1. **Scope:** visual **+ layout**. Restyle and restructure; keep every feature, all data,
   and all behaviors intact.
2. **Priority:** **mobile-first** (this is a phone-on-LAN field tool; recent work has been
   mobile-Plan critique passes). Desktop gains a two-column enhancement on top.
3. **Aesthetic:** **Direction B — "soft-card dashboard."** Clear structure through cards and
   chrome: gentle elevation, rounded corners, colored accent edges, category icon-chips,
   badges, and pill-style disclosures. (The alternative, "Direction A — editorial field
   journal," was rejected as the page-wide language but its restraint is borrowed for prose;
   see tiering.)
4. **Section rhythm:** **tiered.** Text-heavy sections (Overview, Route, Logistics) stay
   calm and editorial; structured sections (Plan, Candidates) get the full B treatment. The
   contrast is what makes the planning tools pop — uniform chrome on prose would reintroduce
   the monotony we're removing.
5. **Desktop second column:** a **sticky trip rail** (mini overview map + quick stats +
   section jump-nav). The scroll-reactive **context map** is explicitly a *future
   extension*, not this work (it needs per-day stop geocoding that does not exist yet).

## Scope

**In scope:**
- Restyle of `src/routes/trips/[slug]/+page.svelte` (page shell, header, hero, meta strip,
  section rhythm, desktop two-column layout + sticky trip rail).
- Restyle of `src/lib/components/PlanSection.svelte`, `CandidatesSection.svelte`,
  `StopCard.svelte`, `LodgingCard.svelte` to the Tier-2 card language.
- New design-system tokens in `src/app.css` for elevation and radius (so the new look is
  tokenized, not hand-tuned), with dark-mode mappings.
- Full light/dark parity and AA contrast in both modes.
- Mobile-first; desktop two-column at a single breakpoint (~960px).

**Out of scope (unchanged):**
- **Behavior / data / state.** Drag reorder, per-day Arrange mode, the field-guide palette
  and inline diff/revert overlays, promote/un-promote, trip-prep regeneration, in-trip
  capture, re-research dirty-section gating, and all frontmatter/`plan.yaml`/`candidates.yaml`
  I/O are untouched. This is a presentation-layer change.
- **Other surfaces.** Today view (`/today`), brochure (`/brochure`), the offline bundle,
  the home page, and settings/onboarding are not part of this pass. (Some share components —
  see "Shared-component caution.")
- **Completed-stage** behavior. Completed trips render the same components read-only; the
  refresh must preserve their read-only states, but no new completed-only design work.
- **The scroll-reactive context map** — documented under "Future extensions."

## Design system additions (`src/app.css`)

Add tokens so elevation/rounding are systematic and dark-mode-aware:

```
/* Elevation — light mode uses soft warm shadows */
--shadow-card:   0 2px 12px rgba(60, 41, 33, 0.09);
--shadow-raised: 0 8px 28px rgba(60, 41, 33, 0.14);

/* Radius scale */
--radius-sm: 8px;
--radius-md: 12px;
--radius-lg: 16px;
```

Dark mode (`[data-theme="dark"]`): shadows read poorly on dark surfaces, so elevation is
conveyed by **lighter surface stops + a faint border** rather than drop shadow. Override
`--shadow-card`/`--shadow-raised` to near-transparent (e.g. `0 1px 0 rgba(0,0,0,0.2)`) and
let Tier-2 cards sit on `--surface-raised`/`--surface-overlay` with `--border-subtle`. Radius
tokens are mode-invariant.

All colors continue to flow through existing semantic tokens (`--surface-*`, `--text-*`,
`--border-*`, `--accent`/`--accent-text`, `--state-*`, `--cat-<category>` /
`-tint` / `-on`, `--planning-*`). No raw hex literals except shadows and photo scrims, per
the repo convention. The mockup's illustrative literals do not ship.

## Page shell

- **Sticky header** (chrome): slim forest band with a subtle `forest-800 → forest-900`
  gradient. Contents unchanged: back · serif title (ellipsized) · `Ask ⌘K` · Re-research ·
  `⋯`. The existing `.header-pill` system stays; only height/treatment tighten.
- **Meta strip:** the destination · drive · distance · nights row becomes a **pill row** on
  the cream `--surface-raised` strip (stage pill keeps its `--planning-*` family). Reads as
  content, not chrome.
- **Hero:** kept, slightly shorter, with a soft bottom scrim behind the vibe tag.

## Tier 1 — calm prose sections (Overview, Route, Logistics)

No card. Each section is: a small overline label (`.text-caption`, `--accent-text`) → a
Fraunces title → a short `--accent` hairline rule → comfortable prose at a readable measure.
`Edit` / `↳ Ask` remain as quiet text actions on the header row. Sections are separated by
hairline dividers (`--border-subtle`). The empty-state placeholder + `Research →` affordance
is preserved, restyled to match. Long-section expand/collapse (overview/route) is preserved.

## Tier 2 — Plan section (`PlanSection.svelte`)

Wrap in an elevated card (`--surface-raised`, `--radius-lg`, `--shadow-card`).

- **Header:** Fraunces "Plan" + a right-aligned meta string (`2 days · Jun 20–21`) +
  existing `+ Add day` action.
- **Trip-prep bar:** the existing `Trip prep · X of Y done` row gains a thin **progress bar**
  (`--accent` fill on `--surface-sunken`); `Refresh prep` / `Re-generate all` become quiet
  chips.
- **Day card** (`.day-card`): `--surface-page`, `--radius-md`, `--border-subtle`, with a
  **colored left accent edge** (`--accent`) and a `Day N` chip beside the date in the
  `.day-header`. Day `⋯` menu and date/notes editors preserved.
- **Stop row** (`.stop-row`): a category **icon-chip** (rounded square filled with
  `--cat-<category>`, glyph in white/`-on`), then name (medium) + address (tertiary, quiet
  glyph). The drag affordance becomes a **subtle grip glyph** (no literal "drag" text),
  shown on hover/desktop; existing reorder + Arrange-mode behavior is unchanged.
- **Disclosure:** the `▸ N to-dos · N tips · hours & contact` summary becomes a **pill**
  (`--surface-raised`, `--border-subtle`, rounded), still a native `<details>`.
- **Drive distance:** moves from a floating right-edge badge to a **connector between stops**
  (`↓ 2 mi · 7 min`) on the vertical rail between rows. Reads as travel, not decoration.
- **Lodging** (`LodgingCard.svelte`): a tinted **sub-card** (`--surface-sunken`,
  `--radius-md`) with a bed glyph, name, `N nights · <tier>`, and an `--accent` **Book**
  button. The `+ Add lodging` empty state is preserved, restyled.
- **`+ Add stop`:** a quiet dashed ghost button.

## Tier 2 — Candidates section (`CandidatesSection.svelte`)

Elevated card to match Plan.

- **Header:** "Candidates" + the existing pin-status hint (`X of Y pinned` /
  `Geocoding X of Y…`).
- **Map:** kept inline, given `--radius-md` corners inside the card.
- **Stops / Lodging** tabs become a **segmented control** (pill track on `--surface-sunken`,
  active segment raised).
- **Category filter chips:** each chip lights in its own `--cat-<category>`/`-tint`/`-on`
  when active, neutral (`--border-subtle`) when not.
- **Candidate card:** category icon-chip + name (medium) + short description, with the
  existing `Promote to day…` action (rendered `+ Day`). On-plan candidates show their
  `Day N` badge + `Un-promote`. Subtle border, gentle hover elevation.

## Desktop — two-column + sticky trip rail

At `≥ ~960px`, `.layout` becomes a two-column grid: content column (max ~720px) on the left,
a **sticky trip rail** (~320px) on the right.

- **Rail contents:** a mini overview map (reuse `MiniMap`/`TripMap` overview), quick stats
  (distance · drive · nights · days planned), and a **section jump-nav** that scroll-spies
  and highlights the active section. Optionally the bookmark/star.
- Full-size maps stay **inline** in their sections (Overview route, Candidates pins) within
  the content column.
- Below the breakpoint the rail's content folds back into the normal single-column flow
  (overview map inline as today), so mobile is unaffected.
- The page's existing CSS-grid shell (`grid-template-rows`) and the sticky-header containing
  block are preserved; the two-column split happens inside `.layout`.

## Dark mode

Re-mapped, not inverted, per the existing "Dusk" spec. Tier-2 cards sit on
`--surface-raised`/`--surface-overlay`; elevation via lighter surface + `--border-subtle`
instead of shadow. Accent edges, icon-chips, badges, and the progress bar all use the
already-AA-safe semantic/category tokens, which carry dark stops. Verify AA in both modes on
every new text-on-tint pairing (category icon-chips, pills, the progress bar label).

## Shared-component caution

`StopCard.svelte` and `LodgingCard.svelte` may render outside the planning detail page
(e.g. brochure/today derivations or read-only completed views). Before restyling, confirm
each consumer and gate planning-only chrome so the brochure/today/offline surfaces — which
are explicitly out of scope — are not visually altered. Where a component is shared, scope
the new treatment to the planning detail context (a wrapper class or prop), not the
component globally. The test suite and `deriveBrochure` consumers are authoritative for who
renders what.

## Accessibility

- Tap targets ≥ `--tap-min` (44px) on coarse pointers; the existing `@media (pointer:
  coarse)` floors stay in force for the new chips/segmented control/pills.
- Disclosures remain native `<details>` (keyboard-accessible, no-JS-safe).
- Icon-chips are decorative; the category is already conveyed in text — mark glyphs
  `aria-hidden` and keep the textual category/name as the accessible label.
- The segmented control and filter chips are real buttons with `aria-pressed`/selected
  state; jump-nav links have discernible text.
- AA contrast verified in light **and** dark for every new pairing.

## Testing

- This is presentation-layer; the authoritative behavioral contracts (plan/candidates I/O,
  realize-plan, derive-brochure, frontmatter) are unchanged and their tests must stay green.
- `npm run verify` (svelte-check `--fail-on-warnings` + tests + build) is the go/no-go.
- No new logic to unit-test beyond a scroll-spy helper if extracted; if a pure
  `activeSection(scrollState)` helper is factored out for the jump-nav, cover it directly.
- Watch the worktree svelte-check gotcha (run with an explicit `--tsconfig` if checking from
  a worktree).

## Manual QA pass

Per repo convention (`docs/manual-qa.md`), drive a Playwright-MCP pass on a real planning
trip (e.g. `st-louis-brick-city`, which has a 2-day plan + large candidate pool) before
merge:

- [ ] Mobile viewport + `hasTouch:true`: page shell, meta pills, hero, tiered rhythm read
      as intended; Plan day cards, stop rows, drive connectors, disclosure pills, lodging
      sub-card, `+ Add stop` all correct.
- [ ] Tap floors: chips, segmented control, filter chips, and disclosure summaries clear
      44px on coarse pointers.
- [ ] Plan behaviors intact: reorder, per-day Arrange mode, day `⋯` menu, date/notes
      editors, trip-prep refresh, promote/un-promote.
- [ ] Candidates: segmented Stops/Lodging, category filter chips light correctly, map +
      pin-status hint, promote `+ Day` / `Un-promote`.
- [ ] Field-guide palette (`⌘K` / per-section `↳ Ask`) opens and inline diff/revert overlays
      still render at the right section.
- [ ] Desktop ≥960px: two-column layout, sticky rail, mini-map, quick stats, jump-nav
      scroll-spy; collapses cleanly to single column below the breakpoint.
- [ ] Dark mode parity: elevation reads, AA contrast holds, no raw-literal regressions.
- [ ] Out-of-scope surfaces unchanged: brochure, today view, offline bundle, completed-trip
      read-only render.

## Future extensions

- **Scroll-reactive context map.** Replace the rail's static mini-map with one map that
  follows what you're reading: home→destination route at the top, candidate pins in
  Candidates, that day's stops in Plan. Blocked on per-day stop geocoding (candidate coords
  exist; day-level stop framing/fit does not yet). File separately once this refresh lands.

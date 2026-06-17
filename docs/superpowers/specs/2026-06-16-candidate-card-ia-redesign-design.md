# Candidate stop card — information-architecture redesign

**Status:** approved (2026-06-16)
**Component:** `src/lib/components/StopCard.svelte` (non-compact / Candidates rendering only)
**Supersedes structurally:** the half-width-drawer overflow patch in #527 (the new expanded panel is full-width, so the `min-width: 0` band-aid is no longer load-bearing — but harmless to leave).

## Problem

The candidate stop card is a **triage surface**: skim ~12 stops, promote a few into
the plan. Today every card renders, at rest, the full `description` (what it is) **and**
the full `why_recommended` (why it fits) — ~6 lines tall. Across a dozen stops that's a
heavy, undifferentiated scroll, while the genuinely "once it's in / once I'm there"
fields (address, hours, phone) sit behind a `Details` disclosure that shares a flex row
with the source link and only uses the left half of the card when open.

The section "doesn't feel right" because the hierarchy optimizes for *reading about a
place* rather than *deciding whether it belongs in the plan*, and the open drawer is
visually lopsided.

This is a presentation redesign. No data, schema, prompt, or endpoint changes.

## Goal

Re-rank the card around the promote decision ("is this for me?"), make every secondary
field reachable but quiet, and give the card a clean rest/expanded model that also
retires the lopsided drawer.

## Non-goals / out of scope

- `compact` (Plan day card) and `inRail` (itinerary spine) renderings of `StopCard` —
  they keep their existing single-`<details>` drawer; this redesign touches only the
  non-compact branch.
- `LodgingCard` — a parallel treatment is desirable later but not in this change.
- Any change to candidate data, the enrich/geocode chain, or the candidate schema.
- Distance *correctness* (wrong distances from geocode mismatches) — that's the separate
  "data-trust" track; see Future work.

## Design

### Rest state (top → bottom)

1. **`●` name + category caption.** Keep the existing category-caption-under-name
   treatment (a recent deliberate refresh, orthogonal to this change).
2. **`↳ why_recommended` — the hero line.** Promoted to the top decision line. Rendered
   in the higher-emphasis text color (it currently sits below the description in
   `--text-tertiary`).
3. **`description`, clamped to 2 lines**, with an inline **`…more`** affordance shown
   only when the text overflows the clamp. Demoted to a secondary text color.
4. **Meta row:** `📍 {distance}` · `{primaryLabel} ↗` (the existing single deduped
   website/source link) · **`▾` chevron**. No `address` / `hours` / `phone` at rest.

When a field is absent the corresponding element is omitted (e.g. no link → no link;
no `distance` → no distance token), matching today's conditional rendering.

### Expanded state

A single toggle reveals, **full-width, growing downward**:

- the **full (un-clamped) `description`**, and
- a **logistics panel** (a full-width block, replacing the old `.rest-row` disclosure):
  - **hours** — the full freeform string; wraps cleanly at full width (the multi-day
    `"Mon–Thu … · Fri–Sat … · Sun … · closed holidays"` case that broke the old row),
  - **address** — tappable → maps (`mapsHref`),
  - **phone** — tappable → call (`telHref`),
  - the **website** only if it wasn't already the rest-row link (avoid duplicating it).

Because the panel is a full-width block rather than a flex item beside the link, the
overflow class of bug fixed in #527 cannot recur here.

### Expand mechanic + accessibility

- A single component-local **`expanded`** boolean (Svelte `$state`), **not** the native
  `<details>` element — so one toggle drives both the description un-clamp and the
  logistics panel together (the unified "one tap reveals the rest" behavior).
- **Forgiving toggle targets:** the meta row (outside the link), the `…more`, and the
  chevron all flip `expanded`.
- The toggle is a real focusable control with `aria-expanded`, Enter/Space activation,
  and a visible focus ring. The chevron rotates `▾ → ▴` on open (with a
  `prefers-reduced-motion` guard, matching the existing `.rest-chev` pattern).
- Inner interactive elements (link, address, phone, footer buttons) keep their
  `stopPropagation` so tapping them doesn't toggle the card.

### Cleanup (code we're touching)

- Remove the **dead `onClick` / `scrollToCard` wiring**: `CandidatesSection` passes
  `onClick={scrollToCard}` but `StopCard` never invokes `onClick` on the `<article>`, so
  whole-card click currently does nothing. Drop the unused prop pass-through (and the
  prop itself if no caller uses it) and the misleading `cursor: pointer`, or repurpose
  `cursor: pointer` onto the actual toggle affordance. The card→map highlight is driven
  by `onHover` (hover/focus) and is unchanged.
- The non-compact `.rest-row` / `.rest-disclosure` block (and the `min-width: 0` patch
  from #527 on those selectors) is replaced by the new rest meta row + expanded panel.
  Leave the `compact`-mode drawer styles intact.

### Footer

Unchanged: `Promote to day…` / `Un-promote` and the hover-revealed `Hide` button stay in
the footer with their existing handlers and `stopPropagation`.

## Future work (captured, not built here)

- **Exception hours chip.** Surface hours at rest *only* when notable — "Closed Mon" /
  "Seasonal" / "Reservations" — i.e. information, not a constant. Requires a reliable
  "notable hours" flag from the data-trust track (parsing freeform LLM hours), which we
  deliberately avoid guessing at now. High-value follow-up.
- **Distance confidence gating.** Show `distance` only when confidently near; part of the
  data-trust track (the same geocode-mismatch source that yields "1771 mi").
- **`LodgingCard`** parallel IA treatment for visual consistency across the two tabs.

## Testing / QA

- jsdom (the project's vitest env) cannot compute layout, and there is no Playwright e2e
  harness, so the regression check is a **Playwright-MCP pass at 390px**: open the
  expanded state on a real enriched trip and assert `scrollWidth ≤ clientWidth` on each
  card and no document overflow (the exact measurement that caught #527), including a
  card with a deliberately long multi-day hours string.
- Visual confirm of rest → expanded on a real enriched trip (e.g. `ozark-national-
  riverways`), and a card with a missing field (no website / no hours) to verify
  conditional omission.
- Any component-level assertions that fit jsdom (e.g. `expanded` toggles on
  click/Enter/Space, `aria-expanded` reflects state, `…more` only present when clamped).
- `npm run verify` (svelte-check `--fail-on-warnings` + tests + build) green before done.

## Manual QA pass

On `ozark-national-riverways` (already enriched) in the dev app at 390×844:

1. A card at rest shows: name + category, the `↳` why line as the emphasized hero,
   2-line description with `…more`, and the meta row `📍 mi · website ↗ · ▾`. No
   hours/address/phone visible.
2. Tap the row / `…more` / chevron → card expands full-width: full description + hours
   (incl. a long multi-day string wrapping cleanly) + tappable address + phone. Chevron
   rotates. No horizontal spill at 390px.
3. Tap address → maps; tap phone → call; tap website → opens site without toggling the
   card. Promote/Hide still work.
4. Keyboard: focus the toggle, Enter/Space expands/collapses; focus ring visible.
5. A card missing a website (and one missing hours) omits those elements cleanly in both
   states.

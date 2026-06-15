# Candidates card progressive disclosure — design

**Status:** approved (brainstorm) · **Date:** 2026-06-15
**Surface:** `CandidatesSection` cards — `StopCard.svelte`, `LodgingCard.svelte` (non-compact rendering only)

## Problem

On mobile, the candidate cards try to show every field at once and end up
showing *incomplete* information instead. Two concrete failures:

1. **The description is always truncated** at a 2-line `-webkit-line-clamp`
   with no way to read the rest. The description is the primary
   decision-driving content, and it's the one thing the user can't fully see.
2. **The visible metadata is mostly noise at the candidate stage.** Address,
   hours, and phone occupy the card's resting real estate, but the user is
   deciding *whether to keep a stop at all* — they don't need the phone number
   of a place they haven't selected. Those fields only become actionable once a
   stop is promoted into the Plan, where the day-card drawer + Today view
   already surface them.
3. **`why_recommended` is silently discarded.** It's a generator-authored,
   human-facing sentence ("one sentence linking to the trip vibe / the
   traveler's tastes from `home.md`") — the most *persuasive*, personalized
   field on the card. The current `summary` fold logic drops it entirely
   whenever `description.length + why.length >= 140`, i.e. on exactly the
   substantive cards. The single best decision signal is being thrown away.

## Principle

Triage card content by **decision-relevance at the candidate stage**, and use
progressive disclosure for the rest:

- **At rest (helps you decide):** name, category badge, distance-from-
  destination, **full description**, **`why_recommended`**, website link.
- **Behind a disclosure (only matters once selected):** address, hours, phone.

This deliberately keeps the two cards' metadata profiles different (StopCard
gains a disclosure; LodgingCard does not) — preserving the existing brief
principle that "stops look like a place to do; lodging looks like a place to
sleep."

## Scope guardrails

- **Presentational only.** No schema, data, endpoint, or generator changes.
  All fields already exist on the candidate objects.
- **Non-compact candidate rendering only.** The `compact` mode (Plan day
  cards) and the Today view are untouched — they already have their own
  details drawer. Every change is gated so `compact` is unaffected.
- **No new tokens or `app.css` changes.** Reuse existing CSS custom properties
  and the established `<details>/<summary>` disclosure vocabulary.

## StopCard (non-compact)

Resting layout, top to bottom:

1. **head** — category badge · name · distance chip · in-plan dot
   *(unchanged)*
2. **description** — full text, **`-webkit-line-clamp` removed**, shown
   unbounded. Descriptions are generator-authored single paragraphs (1–4
   sentences); no safety clamp — a clamp would re-introduce the exact
   "truncated with no escape hatch" problem this refactor exists to kill,
   since the `Details` disclosure holds only address/hours/phone, not the
   description tail.
3. **`why_recommended`** — rendered as its own line *when present*, never
   dropped. Muted treatment (`--text-secondary`/`--text-tertiary`) with a
   leading `↳` marker (a text glyph, not an absolutely-positioned side-stripe)
   to distinguish "why" from the factual "what" above it.
4. **website link** — pulled up out of the old meta-block to rest level
   (the one link a user follows to research a place before selecting it).
   Reuses the existing `webUrl` / `webLabel` derivations and `meta-act` link
   styling.
5. **`Details` disclosure** — a `<details>/<summary>` chevron pill reusing the
   exact vocabulary from the compact StopCard / TodayStopCard drawer (rotating
   chevron, tap-floored summary on coarse pointers, `prefers-reduced-motion`
   guard, native keyboard + no-JS behavior). Expanded, it reveals the
   **address (maps link) · hours · phone**, reusing the existing
   `addr-line` / `meta-act` markup moved inside the drawer.
6. **footer** — Promote / Source / Hide *(unchanged)*.

### Content model changes

- Replace the current `summary` derivation. `description` and `why_recommended`
  become **two independent rendered fields**, not a single folded string. The
  140-char fold heuristic is removed.
- `description` shows in full, unbounded (no clamp).
- `why_recommended` shows in full when non-empty.

### Disclosure gating

- The `Details` pill renders **only if** at least one of `address`, `hours`,
  `phone` is present. (Note: website is no longer part of this test — it lives
  at rest.)
- A stop with only a website shows the website at rest and **no** pill.
- A bare stop (name + description only) renders just those, no pill, no
  website line.

## LodgingCard (non-compact)

Single change: **remove the 2-line `-webkit-line-clamp` on `.summary`** so the
description shows in full. No disclosure is added — LodgingCard carries no
address/hours/phone; its meta (price ramp, price label, nights badge) and Book
link are all decision-relevant and stay at rest.

## Accessibility & touch

- Disclosure is native `<details>/<summary>` — keyboard and no-JS work for
  free.
- The summary gets the `min-height: var(--tap-min)` floor on
  `@media (pointer: coarse)`, matching the existing compact-drawer summary.
- Chevron rotation respects `@media (prefers-reduced-motion: reduce)`.
- Moving address/hours/phone into the drawer does not change their link
  semantics (maps `href`, `tel:` `href`); they keep `stopPropagation` on click.

## Out of scope / non-goals

- No change to the map, hover/pin sync, filter chips, toolbar, add/find-more
  panels, hide-with-undo, or the day-picker.
- No whole-card tap-to-expand (considered; the explicit disclosure row was
  chosen for a11y + consistency with existing patterns).
- No changes to how `why_recommended` is generated or stored.

## Manual QA pass

Drive with Playwright-MCP on a coarse-pointer / touch emulation (per
`docs/manual-qa.md`); exploratory, not a regression net:

- [ ] A stop with a long description shows it **in full** at rest (no ellipsis).
- [ ] A stop with `why_recommended` shows it as a distinct muted `↳` line,
      including on cards where description + why together exceed 140 chars
      (previously dropped).
- [ ] Website link appears at rest when present; opens in a new tab.
- [ ] `Details` pill appears only when address/hours/phone exist; expands to
      reveal them; address opens maps, phone dials.
- [ ] Stop with only a website: website at rest, **no** `Details` pill.
- [ ] Bare stop (name + description): no website line, no pill.
- [ ] Lodging description shows in full at rest; no disclosure added.
- [ ] Plan day cards (compact StopCard/LodgingCard) and the Today view are
      visually unchanged.
- [ ] Disclosure summary clears the 44px tap floor on touch; chevron honors
      reduced-motion.

# Mobile "Today" view — the live in-trip surface (design)

**Date:** 2026-06-06
**Issue:** [#442](https://github.com/WrongerSandwich/traverse-trip-planner/issues/442)
**Milestone:** v0.1.3 Offline support
**Status:** Draft — pending plan + implementation

## Problem

The brochure (`/trips/<slug>/brochure`) is **print-optimized** — cover photos, paper-map
insets, the whole trip as one artifact. That's a pre-trip, coffee-table shape. It is not
what you want on a phone in a cupholder. The per-stop metadata that landed in
[#403](https://github.com/WrongerSandwich/traverse-trip-planner/issues/403) (hours,
address, website, phone) and the prep that landed in
[#406](https://github.com/WrongerSandwich/traverse-trip-planner/issues/406) (tips, to-dos)
only pay off if there's a surface that puts *today's* slice of it in front of you at
arm's length.

This spec defines a responsive, phone-first **"Today" view**: a read-only, request-time
render of a single day of a trip's plan, optimized for use on the road. It is the surface
the milestone is named after. Offline packaging ([#443](https://github.com/WrongerSandwich/traverse-trip-planner/issues/443))
and in-trip capture ([#444](https://github.com/WrongerSandwich/traverse-trip-planner/issues/444))
are separate tickets that layer onto this surface.

## Scope

**In scope (#442):**
- A new route `src/routes/trips/[slug]/today/` rendering one day at a time.
- Request-time derivation by **reusing `deriveBrochure(slug)`** — no AI, no cache, no new
  data layer.
- Day selection: a pure `resolveCurrentDay(days, today)` default + a `?day=N` day picker.
- Per-stop essentials inline: hours, address, tap-to-navigate, call, website; collapsible
  tips & to-dos (to-dos rendered with their `done` state, read-only).
- Tonight's lodging for the selected day.
- Collapsible trip-wide field guide notes + gotchas.
- Entry points from the trip detail page and the `⋯` menu.
- Phone-first, high-contrast, large-tap-target styling using existing `app.css` tokens.

**Out of scope (deferred):**
- **In-trip capture** (mark visited/skipped, jot notes) — owned by #444. This surface is
  read-only; #444 adds the read/write layer.
- **Offline / PWA packaging and map-tile caching** — owned by #443.
- **Embedded day map** — deferred. Tap-to-navigate hands off to the phone's native map app
  (what you'd use while driving anyway), and an inline map is exactly the offline-tile
  problem #443 owns. Revisit as part of #443, not here.
- **Time-aware "next stop"** — without visited-state (#444) there is no reliable notion of
  which stop is next; we emphasize the day's *first* stop as a static anchor instead.
- **Per-day field guide notes** — the schema only carries trip-wide
  `field_guide_notes`/`gotchas`; surfacing them per-day would need a schema change. Out of
  scope; trip-wide notes are shown collapsed.
- **Editing** of any kind — all editing stays on the detail page.

## Architecture

A sibling route to the brochure, following the same request-time derivation pattern.

```
src/routes/trips/[slug]/today/
  +page.server.js   # load(): deriveBrochure + resolve selected day
  +page.svelte      # phone-first render of one day
src/lib/components/
  TodayStopCard.svelte   # new, read-only stop card with action buttons
src/lib/
  today.js          # pure helpers: resolveCurrentDay(), navUrl()  (+ today.test.js)
```

**Reuse `deriveBrochure(slug)` unchanged.** Its return shape already provides everything
the Today view needs (see `src/lib/server/derive-brochure.js` and the contract pinned by
`tests/derive-brochure.test.js`):

- `days[]` — each `{ n, date, drive_distance_mi, notes, stops[], lodging|null }`, where
  each stop carries `name, category, description, notes, coords, address, hours, website,
  phone, tips[], todos[]` and lodging carries `name, nights, coords`.
- `field_guide_notes[]`, `gotchas[]` — trip-wide.
- `title`, `target_date`, `duration_days`.

**Rejected alternative — a parallel `deriveToday()`:** pure duplication of merge logic that
`derive-brochure.test.js` already guards. The brochure shape is a superset of what Today
needs, so Today consumes it directly.

**New component, not an overload of `StopCard.svelte`.** The existing `StopCard` is built
for the plan/candidates *editing* UI (drag handles, hide/remove, edit affordances).
`TodayStopCard.svelte` is a focused read-only unit: name + category chip, the metadata
rows, the action button row, and a single collapsible tips/to-dos disclosure. Keeping it
separate keeps both components small and well-bounded.

## Data flow

`+page.server.js` `load({ params, url })`:

1. Validate slug (`isValidSlug`), `error(404)` on bad slug — matches the brochure route.
2. Load `enrichTrips()` + `getHome()` in parallel; find the trip.
3. Call `deriveBrochure(slug)` (wrapped like the brochure route so a derivation failure
   degrades to the empty state rather than crashing).
4. If `deriveBrochure` returns `null` (no `plan.yaml` / `candidates.yaml`), return a flag
   for the empty state — **not** a 404.
5. Resolve the selected day:
   - `requested = Number(url.searchParams.get('day'))`.
   - `selected = (valid requested in [1, days.length]) ? requested : resolveCurrentDay(days, new Date())`.
6. Return `{ trip, title, destination, selectedDay, dayCount, day, fieldGuideNotes,
   gotchas, startsInDays, hasPlan }`, where `day` is the single resolved
   `days[selected-1]` object.

`features` / `assistantName` come from parent layout data as on every route — no special
handling.

The page renders entirely from `data`; the day picker pills are `<a href="?day=N">` links,
so day switching works without JS and is instant under SvelteKit client nav. The server
remains the source of truth for the default day.

## Day resolution (`resolveCurrentDay`)

Pure function in `src/lib/today.js`, fully unit-tested:

```
resolveCurrentDay(days, today) -> dayNumber (1-based, clamped to [1, days.length])
```

- Empty `days` → caller shows empty state (function not called).
- A day whose `date` equals today's local date (`YYYY-MM-DD`) → that day's number.
- `today` before the first dated day → `1`.
- `today` after the last dated day → `days.length`.
- No dated days at all (no `target_date` propagated) → `1`.

`startsInDays` (for the "Trip starts in N days — showing Day 1" hint) is derived from the
first day's `date` minus today; omitted when the trip has started, has no dates, or is in
the past. Dates compared as server-local calendar dates.

## Actions

Pure `navUrl(stop)` in `src/lib/today.js`, unit-tested across all branches:

- `coords` present → `https://www.google.com/maps/dir/?api=1&destination=<lat>,<lng>`.
- else `address` present → `…&destination=<encoded address>`.
- else → `…&destination=<encoded "name, destination">`.

Cross-platform (Android, iOS, desktop all honor the Maps universal URL). The action row:

- **Navigate** — always present (always has at least name + destination).
- **Call** — `tel:` from `phone` (non-digits stripped); rendered only when `phone` exists.
- **Site** — `website`; rendered only when present.
- Lodging gets **Navigate** (from its `coords`/`name`) and **Booking** (`booking_url`)
  when present.

The day's **first** stop gets a "Start here" emphasis (border + numbered marker). This is a
static anchor; dynamic next-stop tracking is the seam for #444.

## UI structure

Phone-first, single column, matching the approved mockup
(`.superpowers/brainstorm/.../today-view-mockup.html`):

1. **Sticky header** — back chevron, "Today" eyebrow, trip title, and a horizontally
   scrollable day-picker (one pill per day: "Day N · <short date>"), active pill = selected.
2. **Smart-default hint** — "Trip starts in N days — showing Day 1" when `startsInDays` set.
3. **Day heading** — "<Weekday, Month D>", "Day N of M · <destination>".
4. **Stops** — `TodayStopCard` per stop, in plan order. Card: number, name, category chip
   (`--cat-*` tokens), hours + address rows, action row (Navigate/Call/Site), collapsible
   "Tips & to-dos" disclosure listing `tips[]` and `todos[]` (with done checkmarks,
   read-only).
5. **Tonight** — lodging card with Navigate + Booking, omitted if the day has none.
6. **Field guide & gotchas** — one collapsed disclosure with the trip-wide notes/gotchas.
7. **Footer** — "Read-only · derived live from this trip's plan".

## Styling & accessibility

- **Tokens only**, per the CLAUDE.md no-raw-color rule: `--surface-page/raised/sunken`,
  `--text-primary/secondary/tertiary`, `--border-*`, `--accent`/`--accent-text`,
  category chips via `--cat-<category>` / `--cat-<category>-tint` / `--cat-<category>-on`,
  `--state-*` for the gotcha emphasis. The mockup's brick-red literals are illustrative
  only and do not ship.
- Adapts to the app's existing light/dark theme; ensure AA contrast in both (the token set
  already encodes AA-safe text colors).
- Tap targets ≥ 44px; action buttons full-height rows.
- Disclosures are native `<details>` (keyboard-accessible, no-JS-safe); links carry
  discernible text.

## Entry points

- **Detail page** (planning trips with a populated plan): a prominent "Today / in-trip
  view" link near the existing `↗ View brochure (for print)` affordance.
- **`⋯` menu** Output group: a "Today view" entry alongside "View full brochure".
- Gating mirrors the brochure affordance (populated plan required). Completed trips may
  link too (still read-only and useful as a record), but the primary audience is planning
  trips.

## Edge cases & error handling

- **No plan/candidates** (`deriveBrochure` → null): empty state — "No day-by-day plan yet"
  with a link back to the detail page. Not a 404.
- **Day with no stops:** "No stops planned for this day" placeholder; lodging still shown
  if present.
- **No lodging for the day:** omit the Tonight section.
- **Missing per-stop fields:** the corresponding row/button is not rendered (no empty
  "Call" with no number, etc.).
- **Stop with neither coords nor address:** Navigate falls back to `name, destination`.
- **`?day` out of range or non-numeric:** ignored; fall back to `resolveCurrentDay`.
- **No `target_date`:** default to Day 1, no "starts in" hint.

## Testing

- `tests/today.test.js` (new) — `resolveCurrentDay` across all branches (exact match,
  before, after, no dates, single-day, clamping) and `navUrl` (coords vs address vs
  name fallback; `tel:` digit-stripping).
- A server-load test for the `today` route: correct selected day for a `?day` param, the
  `resolveCurrentDay` default, and the empty-state flag when `deriveBrochure` returns null.
- Derivation itself is already covered by `tests/derive-brochure.test.js` — not retested.
- `npm run verify` (svelte-check `--fail-on-warnings` + tests + build) is the go/no-go.

## Relationship to the rest of v0.1.3

- **#443 (offline/PWA):** this view is the surface to serialize/cache. The embedded-map and
  asset-inlining work lives there. #442 keeps assets minimal (no map) so #443 has a clean,
  light surface to make offline.
- **#444 (capture):** this is the read-only counterpart. #444 adds visited/skipped + notes
  on top of `TodayStopCard` / the day, and turns the static "Start here" anchor into real
  progress. Storage and retro hand-off are decided in #444.

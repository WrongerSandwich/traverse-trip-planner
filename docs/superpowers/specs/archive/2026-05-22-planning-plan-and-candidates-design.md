# Planning stage rework — Plan + Candidates model

**Date:** 2026-05-22
**Status:** Draft
**Origin:** Design conversation in `claude/trip-planning-output-9JnKd`
**Related:** [#134 planning detail IA](2026-05-16-planning-detail-ia-design.md), [#133 brochure/itinerary reconciliation](2026-05-16-brochure-itinerary-reconciliation-design.md) — this design supersedes the brochure-as-final-output framing those threads operated under.

## Problem

The planning stage today produces four prose files (`overview.md`, `route.md`, `stops.md`, `logistics.md`) rendered with equal visual weight, plus a user-triggered "Prepare brochure" ceremony that extracts a structured object (`brochure.md`) at the end. Two issues compound:

1. **The brochure does two jobs.** It is both the structured plan object (days, stops, lodging, gotchas) and its printable rendering (cover photos, map inset, print CSS). That coupling is why "Prepare brochure" feels like a heavy step to produce something whose main job is to exist as data the app can re-render.
2. **The four sections aren't shaped alike.** Overview is orientation, Route is map-primary, Stops is a list that wants curation, Logistics is a junk drawer with one list-shaped sub-thing (lodging). Rendering them identically hides what each is actually doing.

Underneath both: the natural way people plan road trips is wide-net-then-whittle — collect lots of options, then choose. Today's flow has the researcher pre-narrow (it writes a single prose `stops.md`), and the user's only curation lever is rewriting prose or asking the field guide to.

## Goals

1. Decouple plan-as-data from its renderings. The plan is the canonical object; the brochure is one view over it.
2. Introduce a candidate-pool model for stops and lodging so the user curates from a wide net rather than accepting the researcher's first pass.
3. Differentiate section rendering to match each section's actual shape.
4. Make the plan a first-class structured object that exists from the start of the planning stage (sparse), not partway through.
5. Eliminate the "Prepare brochure" user-triggered ceremony — extraction happens automatically as part of research.

## Non-goals

- **Field guide command vocab.** The current field guide will not understand the new model; it gets a ground-up rewrite as a follow-up. Disabled or broken during the transition is acceptable (pre-release).
- **Migration of existing trips.** Pre-release; existing planning trips and brochures will be deleted before this lands. No migration code.
- **"Find more candidates" action.** Future enhancement. Today, candidates accumulate from the initial research pass + user-added entries only.
- **Lifecycle stage changes.** Still idea → planning → completed. No new "researching" stage.
- **Brochure print layout.** The print/PDF view's content shape and chrome stay as-is; only its data source changes (derived from plan + candidates instead of `brochure.md` as source of truth).

## Approach

The planning stage produces two structured artifacts plus the existing prose research:

- **Plan** — the curated trip: which stops, where you're staying each night, day-by-day structure. Starts empty when an idea is promoted; the user populates it by promoting candidates.
- **Candidate pool** — the wide net: stops and lodging options the researcher surfaced, plus anything the user added manually. Candidates that get promoted into the plan stay in the pool with an "in plan" marker so un-promote is reversible.
- **Prose research output** — `overview.md`, `route.md`, `logistics.md` stay. `stops.md` goes away (its content becomes candidates). Prose is kept transiently; if testing shows it never gets revisited once extraction has run, drop it in a follow-up.

Days are first-class objects within the plan, carrying their own metadata (date, lodging assignment, ordered stops, drive distance, notes).

Research runs unchanged as an Ambient Background job. A new extractor pass runs immediately after it, in the same job, to populate the candidate pool from the prose. No new user-facing trigger.

## On-disk layout

```
planning/<slug>/
├── overview.md       # existing — short orientation prose + frontmatter
├── route.md          # existing — map-focused, capped prose
├── logistics.md      # existing — prose
├── plan.md           # NEW — structured plan (days, lodging assignments)
├── candidates.md     # NEW — list of stop + lodging candidates
└── brochure.md       # existing — becomes a derived rendering, regenerated lazily
```

`stops.md` is no longer produced. Existing trips will be deleted, so no migration concerns.

### `plan.md` schema

```yaml
---
days:
  - number: 1
    date: 2026-07-15           # optional — present once committed
    lodging_id: <candidate-id> # optional — references candidates.md
    stops:                     # ordered list of candidate ids
      - <candidate-id>
      - <candidate-id>
    drive_distance_mi: 240     # optional
    notes: ""                  # optional, freeform
  - number: 2
    ...
---
```

Body is empty or holds user prose notes about the plan as a whole (rare; primary data is in frontmatter).

### `candidates.md` schema

```yaml
---
stops:
  - id: sleeping-bear-dunes
    name: "Sleeping Bear Dunes National Lakeshore"
    category: outdoors
    description: "Sand dunes on Lake Michigan with a scenic drive and overlooks."
    why_recommended: "Major scenic landmark; aligns with your park-leaning trips."
    source_url: "https://..."
    coords: { lat: 44.88, lng: -86.05 }   # optional, filled by geocode
    promoted: true                         # mirrors membership in plan.md
    user_added: false
lodging:
  - id: traverse-city-inn
    name: "..."
    description: "..."
    price_tier: mid                        # budget | mid | splurge
    nights: 2                              # typical recommended stay
    booking_url: "..."
    coords: { ... }
    promoted: true
    user_added: false
---
```

Lodging is a separate list, not a category within stops.

**Per-stop metadata fields** (added in v0.1.2, see [`2026-05-27-per-stop-metadata-design.md`](../2026-05-27-per-stop-metadata-design.md)) — four optional fields populated by the post-deepen follow-on jobs:
- `address` — written by `geocode-candidates` from Nominatim's reverse lookup (free byproduct of the existing coords query)
- `hours`, `website`, `phone` — written by `enrich-candidates`, a new follow-on job that runs `chat()` + `web_search` once per candidate

**Per-stop prep fields** (added in v0.1.2, see [`2026-06-02-per-stop-todos-design.md`](../2026-06-02-per-stop-todos-design.md)) — two optional fields written by the `stop-prep` follow-on job (the terminal leg of the post-deepen chain):
- `tips` *(optional, string[])* — short read-only in-trip pointers (best entrance, where to park, what to bring, light timing). Capped at 5.
- `todos` *(optional, object[])* — pre-trip to-dos. Each is `{ id, text, done }`; `id` is a `makeCandidateId`-derived slug, `done` defaults `false` and is toggled by the user. Capped at 4.

### Widened stop category enum

Starting point — refine against real extractor output during implementation:

```
historic | food | outdoors | view | entertainment | landmark |
cultural | quirky | shopping | experience | misc
```

`lodging` is removed from the enum since lodging lives in its own list.

## Pipeline changes

### Research → Extractor pass

The existing prose researcher (`Research →` action) runs unchanged: web search + `chat()` produces `overview.md`, `route.md`, `logistics.md`, frontmatter waypoints.

A second AI pass runs immediately after, in the same Ambient Background job:
- Input: the prose research output.
- Output: structured candidates written to `candidates.md`.
- Uses `chat()` with a `label` like `"extract-candidates"`.

Geocoding for candidate coordinates can be folded into the extractor pass or run as a separate cheap follow-up pass — implementer's call.

### Brochure becomes a derived rendering

`brochure.md` no longer authored manually or by a dedicated "Prepare brochure" action. Instead, it is regenerated **lazily on view** if the plan has changed since the brochure was last written. Content is derived from `plan.md` + `candidates.md`; map generation and print-specific layout stay where they are.

Concretely: on each request that needs the brochure, compare a `plan.md` content hash (or mtime) against a `brochure_source_hash` recorded in `brochure.md` frontmatter. If stale, regenerate before serving.

## UX surfaces

### Planning page restructure

Sections are no longer rendered uniformly. Each gets shape-appropriate treatment:

- **Overview** — short prose with a hard length cap (~3 sentences + an optional TL;DR line). Researcher prompt updated to respect this.
- **Route** — map-primary; capped prose annotation underneath. Waypoints stay in frontmatter; OSRM line behavior unchanged.
- **Plan** — replaces the current Stops section. Day-organized: each day card shows assigned stops in order + the lodging for that night. Per-day affordances: `+ Add stop` (opens candidate picker), `+ Add lodging`, edit day metadata. Footer affordance: `+ Add day`.
- **Candidates** — new section below the plan. Two stacked lists (Stops | Lodging) or a tabbed view. Each candidate is a card with: name, category badge, one-line description, why-recommended, source link. Primary action: `Promote to day…` (day picker). Promoted candidates remain visible with an "In plan" badge and an `Un-promote` action. `+ Add stop` / `+ Add lodging` at the top of each list for user-added candidates (form with the same fields).
- **Logistics** — prose, unchanged.

### Candidate card design principles

Enough surface to evaluate at a glance — name, category, one-line description, why-recommended — without overwhelming detail. Source URL is one click away. Avoid expanding cards to full detail in the list view; if more detail is needed, link out or use a small overlay.

### Day assignment UX (recommendation)

Primary mental model is **day-first**: the plan view is organized by day, and the natural way to add a stop is from inside a day's `+ Add stop` action, which opens a sheet/popover of unpromoted candidates (with category filter). Selecting one promotes it and assigns it to that day in a single action.

From the candidate pool view, each candidate also has a `Promote to day…` quick action with a day picker — supports the user who's browsing candidates and wants to assign as they go.

No unassigned-but-promoted limbo state. Promote always picks a day (or creates Day 1 if none exists yet).

Reorder within a day via drag handle. Move between days via drag or per-stop overflow menu (`Move to day…`). Removing a day with assigned stops prompts the user to move them first.

Day metadata (date, drive distance, notes) is editable inline on the day card via an expand-to-edit pattern, not a separate sheet.

Lodging assignment is per-night. The `nights` field on a lodging candidate is a hint; the user assigns the same lodging to consecutive days manually if appropriate (future enhancement could span automatically).

### AI workflow archetypes

- **Research + extractor pass**: Ambient Background (existing archetype, unchanged externally). One job, two AI calls.
- **Promote / un-promote / reorder / add candidate / day edits**: Instant Inline.
- **Brochure regeneration**: lazy on view, no user-facing trigger; the regeneration itself is server-side and synchronous from the view's perspective (cached after).
- **"Find more candidates"** — out of scope for this rework; future Ambient Background.

## Phasing

Each step is a releasable PR. Suggested order:

1. **Schema + readers.** `plan.md` and `candidates.md` schema, file parsers/writers, TypeScript-ish types. No UI yet.
2. **Extractor pass.** Runs after research, populates `candidates.md`. Test against several research outputs to validate the widened category enum.
3. **Candidate browsing UI** — read-only first, then `Promote to day…` / un-promote actions. Plan view stays minimal in this PR.
4. **Day assignment** — day-as-object, plan view organized by day, picker UX, reorder, day metadata editing, add/remove day.
5. **Differentiated section rendering** — overview length cap, route map-primary layout, logistics styling pass.
6. **Brochure becomes derived** — regenerate-on-view-if-stale; remove the "Prepare brochure" entry points; brochure print view reads from plan + candidates.
7. **Field guide vocab rewrite** — tracked separately; this rework does not block on it.

Each PR runs `npm run verify` to gate.

## Conventions reminder

- All AI calls go through `chat()` in `src/lib/server/ai.js` with a `label`.
- All web search goes through `search()` in `src/lib/server/search.js`.
- Ambient Background work registers with `src/lib/server/jobs.js` and reuses shared workflow primitives (`src/lib/workflow-status/`, `BackgroundJobsIndicator`, `TripJobBadge`, `PromiseTooltip`, `ConfirmModal`).
- Typed failures route through `ERROR_REGISTRY` in `src/lib/errors-registry.js` — no inline catch sentences.
- Use CSS custom-property tokens from `src/app.css`; no raw color literals except shadows/scrims.
- `enrichTrips()` GC sweep needs to learn about the new files so deleted trips' caches still get pruned correctly.

## Open implementation questions

These don't block starting, but the implementer should resolve them early:

- **Candidate ID scheme.** Slug from name (with collision suffix)? UUID? Content hash? Slug is most human-readable but needs collision handling.
- **Widened category enum.** The list above is a starting point; validate against extractor output before locking it in. Consider whether `experience` and `entertainment` are distinct enough to coexist.
- **Prose `overview.md` length cap.** Enforce in the researcher prompt only, or also truncate in the renderer as a backstop?
- **Stop dedup** between user-added candidates and researcher-extracted ones. Probably name + coords fuzzy match; not critical until "find more candidates" exists.
- **Whether `stops.md` is dropped on day one or kept transiently** until testing proves it's never accessed (recommend keep transiently for one milestone, then delete).
- **Lodging multi-night spans.** Today the model assigns lodging per day; if "nights" suggests 2, do we auto-assign to Day N+1 too, or leave it manual?
- **Brochure staleness detection.** Hash `plan.md` content, mtime comparison, or version counter? Hash is simplest and survives unrelated edits to other files.

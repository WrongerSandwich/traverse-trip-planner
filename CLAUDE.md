# Atlas

A personal travel filing cabinet — road trips and fly-in destinations — managed via Claude Code. Trips live as markdown; status is encoded by both folder location and frontmatter so files are self-describing.

## Personal context

User-specific details (home base, vehicle, travelers, taste, seasonal preferences, recurring weekly commitments) live in `home.md`. **Always read `home.md` before generating, evaluating, or deepening trip ideas.** Its frontmatter is the source of truth for structured values like home coordinates, default travel radius, and vehicle specs; its prose is the source for taste and constraints.

When a user preference or constraint surfaces that isn't in `home.md`, flag it rather than silently encoding it in a trip file.

## Folder structure

```
atlas-trip-planner/
├── CLAUDE.md          # this file — repo conventions
├── home.md            # user-specific preferences and constraints
├── PRODUCT.md         # design context for the frontend
├── TODO.md            # deferred UX/perf follow-ups
├── .claude/
│   ├── commands/      # slash commands (seed, deepen)
│   └── agents/        # subagents (researcher)
├── src/               # SvelteKit frontend (npm run dev -- --port 3456)
├── ideas/             # parked, lightly sketched (single .md files)
├── exploring/         # being researched (folders with overview.md)
├── planning/          # actively becoming reality (folders)
├── completed/         # archive with retrospectives
└── archived/          # hidden from frontend; structure mirrors source stage
    ├── ideas/
    ├── exploring/
    ├── planning/
    └── completed/
```

## Lifecycle

Trips progress through four stages. Earlier-stage fields are never removed — structure accrues as a trip matures.

1. **idea** — single `.md` file in `ideas/`. Fields: `title`, `status`, `destination`, `pitch`, `created`, `vibe`. For fly-in trips, also add `fly_in: true` and `vehicle: rental`. Target: <30 seconds to create.
2. **exploring** — promoted to a folder. `overview.md` carries expanded frontmatter; siblings `route.md`, `stops.md`, `logistics.md` appear as research fleshes them out.
3. **planning** — concrete dates, lodging, reservations. The frontend's planning page enables in-place editing of any section + an "Ask Claude" chat that writes section updates back to disk.
4. **completed** — moved to `completed/` with a `notes.md` retrospective.

**Archive (orthogonal to lifecycle):** any trip can be archived via the detail view. Archived trips move to `archived/<source-stage>/<slug>/` with the original status frontmatter intact. The frontend never displays them, but the seed action still scans them so previously-rejected destinations don't get re-suggested.

## Frontmatter schema

**Minimum (idea):**
```
title, status, destination, pitch, created, vibe
```
For fly-in trips also add: `fly_in: true`, `vehicle: rental`

**Added at exploring:**
```
region, home_distance_mi, driving_hours, duration_days, weekend_viable,
best_seasons, avoid_months, travelers, pet_sitter_needed, ev_friendly,
vehicle (optional override), tags, vibe, cost_tier, waypoints
```
Optional flags: `national_park: true` (for NPS units), `starred: true` (bookmarked)

**Added at planning:**
```
target_date, pet_sitter, lodging, reservations_needed,
charging_stops (EV trips), cost_estimate_usd
```

### Field notes

- `vibe` — short phrase describing the trip character (e.g. `"quirky mountain town"`, `"coastal scenic drive"`). Required at idea stage.
- `fly_in: true` — marks a trip that requires flying. Add `vehicle: rental` alongside it.
- `waypoints` — key cities along the driving route as an inline array: `[Overland Park KS, Leavenworth KS, Atchison KS]`. Used by the frontend to fetch an OSRM road-following route line. For fly-in trips, use the driving segment from arrival airport to destination. Required for the solid route line to appear on the map.
- `national_park: true` — add to any trip where the primary draw is an NPS unit (national park, preserve, scenic riverway). Surfaces a badge on the trip card.
- `starred: true` — bookmarked trip. Toggled by the frontend; write it here if pre-seeding a bookmark.
- `cost_tier` — `budget` | `mid` | `splurge`. Calibrated to the trip type (fly-in "mid" is different from drive "mid").

Omit fields rather than guess at creation. Dates are ISO 8601. Distances default to miles.

## Slash commands and in-browser actions

The same lifecycle operations are reachable two ways: as Claude Code slash commands (run from a terminal session) and as in-browser buttons on the frontend.

**Slash commands** in `.claude/commands/`:

- `/seed [n]` — generate `n` new idea files (default 5, max 15) using `home.md` preferences. Includes fly-in options when appropriate.
- `/deepen <trip>` — dispatch the `researcher` subagent to flesh out an idea into an exploring-stage folder. Adds `waypoints` so the OSRM route line will draw on the map.

**In-browser actions** (live on the SvelteKit app):

- **Seed** (`+` button on the home page) — same as `/seed` plus an optional steering prompt. Streams progress over SSE.
- **Research** (button on idea cards) — same as `/deepen`. Confirms before kicking off.
- **Start Planning** (exploring trips) — promotes `exploring/<slug>/` → `planning/<slug>/` and rewrites the status frontmatter.
- **Bookmark** (star icon) — toggles `starred: true|false` in the trip's frontmatter.
- **Archive** (detail view, gated by confirm) — moves the trip to `archived/<stage>/<slug>/`. The trip vanishes from the UI but stays in the seed-avoidance list.

## Frontend

The SvelteKit app in `src/` is the primary interface. Two ways to run it:

- **Dev:** `npm run dev -- --port 3456` (hot reload)
- **Prod:** `npm run build && pm2 restart atlas` (or `node build/index.js`) — what runs on the home server

The frontend reads trip data from the markdown files on each page load. All three external lookups are disk-backed and persist across restarts:

- `.geocode-cache.json` — Nominatim destination + waypoint coordinates
- `.image-cache.json` — Pexels photo URLs
- `.route-cache.json` — OSRM road route geometries

`enrichTrips()` runs a GC pass each request that prunes orphaned cache entries (e.g. when a trip is deleted or its `waypoints` change), guarded so a transient empty trip list can't wipe everything.

Routes themselves are **not** shipped in the SSR HTML — that bloated each page load by ~80 KB. They're served lazily via `/api/route/[slug]` and fetched client-side when a card is hovered/scrolled-into-focus.

After adding or renaming trips, the next page load picks them up automatically; no manual cache warming needed.

## Conventions

- File names: kebab-case, no dates (e.g. `ozarks-backroads.md`)
- Never remove frontmatter fields during promotion; only add or refine
- When uncertain about a field at creation, omit it
- Research subagents write to their own files (`route.md`, `stops.md`, etc.) and summarize in `overview.md`; no silent edits to user-written prose
- Distance, radius, and vehicle-specific logic read from `home.md` frontmatter; don't hardcode user-specific numbers in commands or subagents
- After a meaningful unit of work, commit and push — the repo is on GitHub at `WrongerSandwich/atlas-trip-planner`

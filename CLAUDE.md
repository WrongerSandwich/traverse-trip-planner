# Atlas

A personal travel filing cabinet — road trips and fly-in destinations — managed via Claude Code. Trips live as markdown; status is encoded by both folder location and frontmatter so files are self-describing.

## Personal context

User-specific details (home base, vehicle, travelers, taste, seasonal preferences, recurring weekly commitments) live in `home.md`. **Always read `home.md` before generating, evaluating, or deepening trip ideas.** Its frontmatter is the source of truth for structured values like home coordinates, default travel radius, and vehicle specs; its prose is the source for taste and constraints.

When a user preference or constraint surfaces that isn't in `home.md`, flag it rather than silently encoding it in a trip file.

## Folder structure

```
travel-agent/
├── CLAUDE.md          # this file — repo conventions
├── home.md            # user-specific preferences and constraints
├── PRODUCT.md         # design context for the frontend
├── .claude/
│   ├── commands/      # slash commands (seed, deepen)
│   └── agents/        # subagents (researcher)
├── src/               # SvelteKit frontend (npm run dev -- --port 3456)
├── ideas/             # parked, lightly sketched (single .md files)
├── exploring/         # being researched (folders with overview.md)
├── planned/           # actively becoming reality (folders)
└── completed/         # archive with retrospectives
```

## Lifecycle

Trips progress through four stages. Earlier-stage fields are never removed — structure accrues as a trip matures.

1. **idea** — single `.md` file in `ideas/`. Fields: `title`, `status`, `destination`, `pitch`, `created`, `vibe`. For fly-in trips, also add `fly_in: true` and `vehicle: rental`. Target: <30 seconds to create.
2. **exploring** — promoted to a folder. `overview.md` carries expanded frontmatter; siblings `route.md`, `stops.md`, `logistics.md` appear as research fleshes them out.
3. **planned** — concrete dates, lodging, reservations. Add `itinerary.md` and `packing.md`.
4. **completed** — moved to `completed/` with a `notes.md` retrospective.

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

**Added at planned:**
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

## Slash commands

Two commands are implemented in `.claude/commands/`:

- `/seed [n]` — generate n new idea files (default 5, max 15) using `home.md` preferences. Includes fly-in options when appropriate. Restarts the dev server after writing to warm Pexels images.
- `/deepen <trip>` — dispatch researcher subagent to flesh out an idea into an exploring-stage folder. Adds waypoints, fetches OSRM route, restarts server to cache everything.

Other commands listed in earlier versions (`/new-idea`, `/promote`, `/list`, `/pack`) are not yet implemented.

## Frontend

The SvelteKit app in `src/` is the primary interface. Run with:
```bash
npm run dev -- --port 3456
```

The frontend reads trip data from the markdown files on each page load. Caches live in:
- `.image-cache.json` — Pexels photo URLs (disk-backed, survives restarts)
- `.route-cache.json` — OSRM road route coordinates (disk-backed, survives restarts)
- Nominatim geocodes are in-memory only (re-fetched on each server restart, ~1.1s/destination)

**After adding new trips or changing `waypoints`, restart the server** to warm the geocode and OSRM caches. The dev server is at port 3456.

## Conventions

- File names: kebab-case, no dates (e.g. `ozarks-backroads.md`)
- Never remove frontmatter fields during promotion; only add or refine
- When uncertain about a field at creation, omit it
- Research subagents write to their own files (`route.md`, `stops.md`, etc.) and summarize in `overview.md`; no silent edits to user-written prose
- Distance, radius, and vehicle-specific logic read from `home.md` frontmatter; don't hardcode user-specific numbers in commands or subagents
- The project has no git history; the "commit" step in `/deepen` is aspirational

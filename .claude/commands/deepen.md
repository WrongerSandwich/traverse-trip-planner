---
description: Research and flesh out a trip idea into an exploring-stage folder
argument-hint: <trip-slug-or-title>
---

Promote a single trip from `ideas/` to `exploring/` with research-backed detail.

**Target:** `$ARGUMENTS` — either a slug (`ozarks-backroads`), a filename (`ozarks-backroads.md`), or a fuzzy title match (`ozarks`).

## Process

1. **Locate the trip.**
   - Search `ideas/` first, then `exploring/` (re-deepening existing explorations is allowed).
   - If exactly one match, proceed. If multiple, list them and stop. If none, stop and tell the user.
   - Capture the current frontmatter as your starting point.

2. **Read context.**
   - Read `home.md` for personal preferences, home location, default vehicle.
   - Read the current idea/overview file for the pitch and any prior notes.

3. **Dispatch the `researcher` subagent** (`.claude/agents/researcher.md`).
   Pass it: trip title, destination, pitch, home city, default vehicle type (and range/charging specs if `bolt`), relevant taste cues from `home.md`, and whether the trip is fly-in.
   Request the researcher return:
   - Structured findings suitable for expanded frontmatter
   - A prose overview (2–4 paragraphs)
   - Route highlights (for `route.md`) — for fly-in trips, include both the flight overview and the driving route within the destination
   - Notable stops (for `stops.md`)
   - Logistics: lodging, reservations, seasonal gotchas, charging if vehicle is `bolt` (for `logistics.md`)

4. **Build the folder.**
   If the trip is currently a flat file in `ideas/`:
   ```
   mv ideas/<slug>.md exploring/<slug>/overview.md
   mkdir -p exploring/<slug>
   ```
   Then create sibling files from the researcher's output:
   - `route.md`
   - `stops.md`
   - `logistics.md`

5. **Update `overview.md` frontmatter** to the exploring-stage schema.
   - Keep existing fields (`title`, `destination`, `pitch`, `created`, `vibe`, `fly_in`, `vehicle`).
   - Set `status: exploring`.
   - Add exploring fields per `CLAUDE.md` schema: `region`, `home_distance_mi`, `driving_hours`, `duration_days`, `weekend_viable`, `best_seasons`, `avoid_months`, `travelers` (default from `home.md`), `pet_sitter_needed` (true if ≥1 night), `ev_friendly`, `tags`, `cost_tier`.
   - **Add `waypoints`** from the route research:
     - Drive trips: key cities along the route as `[City ST, City ST, ...]` starting from home (e.g. `[Overland Park KS, Leavenworth KS, Atchison KS]`).
     - Fly-in trips: the driving segment from the arrival airport to the destination (e.g. `[Salt Lake City UT, Scipio UT, Salina UT, Torrey UT]`).
     - This enables the solid OSRM route line on the map.
   - **Add `national_park: true`** if the primary draw is an NPS unit (national park, preserve, scenic riverway, etc.).
   - Omit any field the research couldn't confidently populate. Omit `starred` unless previously set.

6. **Summarize** what changed: files created, key findings, anything uncertain worth user input (e.g. rental car upgrade decision, permit requirements, timing gotchas).

The geocode, image, and route caches are disk-backed and warm on first request — no manual server restart needed. The new `waypoints` will geocode and the OSRM route will fetch the next time anyone hovers/scrolls to this trip. Routes are pulled lazily via `/api/route/[slug]`, so the SSR payload stays small either way.

## Guardrails

- The `researcher` subagent is the only thing that should hit the web. Don't duplicate its work.
- If the researcher returns low-confidence or sparse output, say so and let the user decide whether to proceed or iterate.
- Never overwrite user prose in an existing `overview.md` on re-deepen — append to sections rather than replace.
- Don't invent frontmatter values. Omit fields you can't confidently populate.
- If the trip is already `planning` or `completed`, stop. Deepening is for idea → exploring only.

---
description: Generate new trip idea files (road trips and fly-in destinations) seeded from home.md preferences
argument-hint: "[n] (default 5, max 15) — optionally with constraints like 'within 3 hours' or 'fly-in national parks'"
---

Generate a set of new trip ideas and write them to `ideas/`.

**Count:** `$ARGUMENTS` if it's a positive integer ≤ 15, otherwise 5. If the argument contains descriptive constraints (e.g. "within 3 hours", "fly-in"), use 5 and apply those constraints to the candidates.

## Process

1. **Read `home.md`** top to bottom. The frontmatter gives you structured defaults (home coords, default travel radius, vehicles). The prose gives you taste — trip profile, seasonal notes, weekly constraints.

2. **List existing trips** across `ideas/`, `exploring/`, `planned/`, and `completed/`. Do not propose destinations that already exist at any stage.

3. **Generate candidates** that are:
   - **Diverse** across region, vibe, and distance. Don't cluster all ideas in one direction or one season.
   - **On-profile.** Each idea should pass a "would they actually go on this?" test against the trip profile in `home.md`.
   - **Route-forward where possible.** The drive is often the point for road trips. For fly-in trips, the destination and rental-car drives within the region are the point.
   - **Mix of road trips and fly-in destinations** unless the user specifies otherwise. Fly-in trips need `fly_in: true` and `vehicle: rental`.

4. **Write files** at `ideas/<kebab-case-title>.md` with this structure:

   **Drive trip:**
   ```markdown
   ---
   title: <Human-readable title>
   status: idea
   destination: <Primary town/city, State>
   pitch: <2–3 sentences. Concrete, not generic — name the specific draw.>
   created: <today's ISO date>
   vibe: <short phrase, e.g. "quirky mountain town" or "prairie scenic drive">
   ---
   ```

   **Fly-in trip** (add these two fields):
   ```markdown
   ---
   ...
   fly_in: true
   vehicle: rental
   ---
   ```

   Good pitch: "Hot Springs, AR for the historic bathhouses downtown and the Ouachita Mountain drives around the lake. Compact weekend; ~6 hours each way."

   Weak pitch: "Hot Springs is a fun weekend getaway with lots to do."

   Also add `national_park: true` if the primary draw is an NPS unit (national park, preserve, scenic riverway, etc.).

5. **Warm images.** After writing all files, restart the dev server so Pexels images and geocodes are pre-fetched before the next page load:
   ```bash
   kill $(lsof -ti:3456) 2>/dev/null
   npm run dev -- --port 3456 > /tmp/svelte-dev.log 2>&1 &
   sleep 30
   grep -E "Ready|images" /tmp/svelte-dev.log | tail -3
   ```

6. **Summarize** what you created. Compact table with columns: title, destination, rough one-way distance (or "fly"), vibe tag, one-line rationale.

## Guardrails

- If `home.md` is missing or thin on taste/location, stop and ask the user to fill it in before continuing.
- If you can't produce N genuinely distinct on-profile ideas without stretching, produce fewer and say so.
- Don't invent facts about destinations. If you're unsure whether a detail is true, keep the pitch at a higher level or flag it for `/deepen` to verify.

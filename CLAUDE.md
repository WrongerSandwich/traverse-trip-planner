# Traverse

A personal road-trip filing cabinet — managed via Claude Code. Trips live as markdown; status is encoded by both folder location and frontmatter so files are self-describing. Fly-in destinations are out of scope — every idea should be drivable from `home.md`'s `home_coords`.

## Personal context

User-specific details (home base, vehicle, travelers, taste, seasonal preferences, recurring weekly commitments) live in `home.md`. **Always read `home.md` before generating, evaluating, or deepening trip ideas.** Its frontmatter is the source of truth for structured values like home coordinates, default travel radius, and vehicle specs; its prose is the source for taste and constraints.

When a user preference or constraint surfaces that isn't in `home.md`, flag it rather than silently encoding it in a trip file.

## Folder structure

```
traverse/
├── CLAUDE.md          # this file — repo conventions
├── home.md            # user-specific preferences and constraints
├── PRODUCT.md         # design context for the frontend
├── .claude/
│   └── agents/        # subagents (researcher) — for ad-hoc Claude Code use
├── src/               # SvelteKit frontend (npm run dev -- --port 3456)
├── ideas/             # parked, lightly sketched (single .md files)
├── planning/          # researched and actively becoming reality (folders)
├── completed/         # archive with retrospectives
└── archived/          # hidden from frontend; structure mirrors source stage
    ├── ideas/
    ├── planning/
    └── completed/
```

(Legacy `archived/exploring/` may exist for trips archived before the
exploring stage was retired — `collectExistingDestinations()` still
scans it so those destinations stay in the seed-avoidance list.)

## Lifecycle

Trips progress through three stages. Earlier-stage fields are never removed — structure accrues as a trip matures.

1. **idea** — single `.md` file in `ideas/`. Fields: `title`, `status`, `destination`, `pitch`, `created`, `vibe`. Target: <30 seconds to create.
2. **planning** — promoted to a folder by the Research action. `overview.md` carries expanded frontmatter; siblings `route.md`, `stops.md`, `logistics.md` appear as research fleshes them out. Concrete dates, lodging, and reservations accrue here as the trip firms up. The frontend's planning page enables in-place editing of any section + an "Ask Field guide" chat that writes section updates back to disk.
3. **completed** — moved to `completed/`. The Mark-as-completed action offers an AI-prompted retro flow that writes `notes.md` (skippable; available later via an "Add retro" button on the completed view).

**Canonical section sets per stage:** The detail view always renders a fixed set of sections regardless of which files actually exist on disk. Missing files show an empty-state placeholder — producers (deepen, chat) are not required to write every section. The canonical sets are:
- planning: `overview`, `route`, `stops`, `logistics`
- completed: `overview`, `route`, `stops`, `logistics`, `notes`

When `itinerary.md` exists in a planning or completed folder and no `brochure.md` is present, it renders above the canonical sections as a read-only legacy artifact. Once a brochure is prepared, `brochure.days` takes over the day-by-day slot; the `itinerary.md` is ignored but kept on disk.

**Archive (orthogonal to lifecycle):** any trip can be archived via the detail view. Archived trips move to `archived/<source-stage>/<slug>/` with the original status frontmatter intact. The frontend never displays them, but the seed action still scans them so previously-rejected destinations don't get re-suggested.

## Frontmatter schema

**Minimum (idea):**
```
title, status, destination, pitch, created, vibe
```

**Added at planning (set by Research, accrue as the trip firms up):**
```
region, home_distance_mi, driving_hours, duration_days, weekend_viable,
best_seasons, avoid_months, travelers, pet_sitter_needed, ev_friendly,
vehicle (optional override), tags, vibe, cost_tier, waypoints,
target_date, pet_sitter, lodging, reservations_needed,
charging_stops (EV trips), cost_estimate_usd
```
Optional flags: `national_park: true` (for NPS units), `starred: true` (bookmarked)

### Field notes

- `vibe` — short phrase describing the trip character (e.g. `"quirky mountain town"`, `"coastal scenic drive"`). Required at idea stage.
- `waypoints` — key cities along the driving route as an inline array: `[Overland Park KS, Leavenworth KS, Atchison KS]`. Used by the frontend to fetch an OSRM road-following route line. Required for the solid route line to appear on the map.
- `national_park: true` — add to any trip where the primary draw is an NPS unit (national park, preserve, scenic riverway). Surfaces a badge on the trip card.
- `starred: true` — bookmarked trip. Toggled by the frontend; write it here if pre-seeding a bookmark.
- `cost_tier` — `budget` | `mid` | `splurge`.

Omit fields rather than guess at creation. Dates are ISO 8601. Distances default to miles.

## In-browser actions

All lifecycle operations live in the SvelteKit app — the browser is the canonical interface.

**AI workflow UX rubric.** Every AI-driven workflow conforms to one of four archetypes defined in [`docs/ai-workflow-ux.md`](docs/ai-workflow-ux.md): **Instant Inline** (button-as-spinner, <15s), **In-Page Stream** (banner + streaming body, 15–60s), **Ambient Background** (user can navigate away; progress surfaced via the global pill in the app header and a per-trip badge on cards/detail headers), and **Conversational/Modal** (multi-step wizard). New AI workflows pick an archetype and reuse the primitives under `src/lib/workflow-status/`, `src/lib/components/BackgroundJobsIndicator.svelte`, and `src/lib/components/TripJobBadge.svelte`. Cancel for Ambient jobs lives in the jobs drawer; every typed failure routes through `ERROR_REGISTRY` in `src/lib/errors-registry.js`.

- **Seed** (`+` button on the home page) — generates 5 new idea files using `home.md` preferences. Optional steering prompt to focus the batch (e.g. "fall colors within 4 hours", "scenic byways with quirky small towns"). Instant Inline.
- **Add destination** (pin button on the home page) — generates a single idea file for a specific destination you name. Includes a semantic duplicate check against existing trips. Instant Inline.
- **Research →** (button on idea cards) — promotes an idea into a planning-stage folder with web-searched details: hours, prices, lodging, route highlights, logistics. Adds `waypoints` so the OSRM route line draws on the map. Ambient Background: 60–120s, navigate away while it runs; cancel from the jobs drawer.
- **Bookmark** (star icon) — toggles `starred: true|false` in the trip's frontmatter.
- **Prepare brochure** (planning detail view) — Ambient Background. Confirm modal carries the promise sentence ("~45s, ~2–5k tokens"). After confirming, runs AI extraction over the planning sections in the background; you can navigate away. The global indicator surfaces progress; success toast links to the review form, which opens `brochure.md` (`days` / `stops` / `lodging` / `field_guide_notes` / `gotchas`) so you can edit before saving. Stops carry an enum `category` (`historic | food | lodging | outdoors | view | entertainment | misc`).
- **Re-geocode stops** (button on the prepare form) — re-runs Nominatim against each stop with fallback queries (address → name + destination context → name) to fill in missing pin coords without re-extracting from the planning text. Useful when the first pass leaves stops unmapped. Instant Inline.
- **View brochure** (`/trips/<slug>/brochure` once `brochure.md` exists) — print-optimized layout: cover photos and hero meta (date · distance · drive time · duration), paper-map route inset from home, Stadia destination map with numbered pin overlay (edge indicators for off-viewport stops, "unmapped" tag for stops whose pin we couldn't geocode), and sectioned content (stops, lodging, field guide notes, gotchas). Also reachable under `/share/<token>/brochure` when sharing is enabled. The brochure's `days` section renders in the day-by-day slot on the detail page and is the canonical print target.
- **Print / Save PDF** (detail page, when a day-by-day view is available) — opens the browser print dialog. Print CSS hides all chrome so only the day-by-day content renders.
- **Share** (any detail view, when `TRAVERSE_SHARE_SECRET` is set) — generates a public read-only `/share/<token>` URL backed by an HMAC of the slug. Disabling revokes access immediately.
- **Mark as completed** (planning detail view) — Conversational/Modal. Moves the trip to `completed/` and opens an AI-prompted retro modal: 5 trip-specific questions, a star rating, and a "would do again" toggle. Each step renders failure via `ERROR_REGISTRY`; closing mid-flow with answers entered prompts a discard confirmation. The model writes a prose `notes.md` body with a `## Highlights` section; the server lifts those bullets into the file's YAML frontmatter alongside `rating`, `would_repeat`, and `date_completed`. Skippable; an "Add retro" button on the completed callout lets you fill it in later. PUT returns 409 if `notes.md` already exists — to redo, delete the file and reload.
- **Add receipts** (completed detail view, when a vision-capable model is configured) — Instant Inline. Accepts one or more receipt photo uploads (JPEG/PNG/WebP/GIF, max 10 × 5 MB). Sends images to `chat()` as normalized `{type: 'image', mediaType, data}` content blocks; both Anthropic and OpenAI/OpenRouter adapters translate to their respective wire formats. Parses each receipt into a `date · merchant · amount · category` line and appends a `## Receipts` section to `notes.md` via `appendToNotes()` (append-only, never rewrites). Requires a vision-capable model for `modelDefault` (e.g. `claude-sonnet-4-6`, `gpt-4o`).
- **Archive** (detail view, gated by confirm) — moves the trip to `archived/<stage>/<slug>/`. The trip vanishes from the UI but stays in the seed-avoidance list.

### Ad-hoc research via Claude Code

`.claude/agents/researcher.md` defines a `researcher` subagent that Claude Code can dispatch for one-off destination research outside the formal lifecycle ("what's the best time of year to visit Glacier?"). It's not invoked by any in-browser action — those reimplement the research loop directly via `chat()` + the `web_search` tool. Use the subagent when you want Claude Code to do exploratory research without writing files.

## Frontend

The SvelteKit app in `src/` is the primary interface. Two ways to run it:

- **Dev:** `npm run dev -- --port 3456` (hot reload)
- **Prod:** `npm run build && pm2 restart traverse` (or `node build/index.js`) — what runs on the home server

The frontend reads trip data from the markdown files on each page load. All three external lookups are disk-backed and persist across restarts:

- `.geocode-cache.json` — Nominatim destination + waypoint coordinates
- `.image-cache.json` — Pexels photo URLs
- `.route-cache.json` — OSRM road route geometries

A fourth disk-backed file, `.workflow-stats.json`, holds rolling p50 telemetry for the `_promise` time/token estimates (see `src/lib/server/workflow-stats.js`). It's written from `chat()` on every AI call and read by `getResolvedPromises()` at load time; the layout server passes the resolved map to the client as `data.promises`.

`enrichTrips()` runs a GC pass each request that prunes orphaned cache entries (e.g. when a trip is deleted or its `waypoints` change), guarded so a transient empty trip list can't wipe everything.

Routes themselves are **not** shipped in the SSR HTML — that bloated each page load by ~80 KB. They're served lazily via `/api/route/[slug]` and fetched client-side when a card is hovered/scrolled-into-focus.

After adding or renaming trips, the next page load picks them up automatically; no manual cache warming needed.

## Conventions

- File names: kebab-case, no dates (e.g. `ozarks-backroads.md`)
- Never remove frontmatter fields during promotion; only add or refine
- When uncertain about a field at creation, omit it
- Research subagents write to their own files (`route.md`, `stops.md`, etc.) and summarize in `overview.md`; no silent edits to user-written prose
- Distance, radius, and vehicle-specific logic read from `home.md` frontmatter; don't hardcode user-specific numbers in commands or subagents
- All model calls go through `chat()` in `src/lib/server/ai.js`; all web search goes through `search()` / `searchToolDefinition()` in `src/lib/server/search.js`. Don't `import Anthropic` (or any other SDK) in route handlers — add a new adapter under `src/lib/server/{ai,search}/` instead. Pass a `label` to `chat()` so token-usage logs are grouped by feature.
- AI workflows must pick an archetype from [`docs/ai-workflow-ux.md`](docs/ai-workflow-ux.md) and reuse the shared primitives (`src/lib/workflow-status/`, `src/lib/components/BackgroundJobsIndicator.svelte`, `src/lib/components/TripJobBadge.svelte`, `src/lib/components/PromiseTooltip.svelte`, `src/lib/components/ConfirmModal.svelte`). Ambient Background workflows register with `src/lib/server/jobs.js`; failures map to `ERROR_REGISTRY` codes from `src/lib/errors-registry.js` — no inline catch sentences.
- Page data on every route includes `data.features` (from `getFeatureAvailability()`) and `data.assistantName` (from `TRAVERSE_ASSISTANT_NAME`). Use them to gate UI affordances and render assistant-name strings rather than hardcoding.
- `npm run verify` is the standard go/no-go: svelte-check (`--fail-on-warnings`) + tests + build. Run it before declaring work done and before opening a PR. CI runs the same command.
- `npm run smoke` does a 1-token round-trip per configured provider plus a tool-loop probe when search backend is non-builtin. Run it before deploys, after env changes, and after touching any `chat()` call site or AI/search adapter.
- For async-agent handoff (cloud sessions picking up issues from GitHub), see [AGENTS.md](AGENTS.md) — it covers the verification flow, ticket conventions, and the `design` label that marks issues unsafe for autonomous pickup.
- When a module's behavior is unclear, **the test suite is authoritative.** AI adapters (`tests/ai-anthropic.test.js`, `tests/ai-openai.test.js`), brochure extraction (`tests/brochure.test.js`), share-token HMAC (`tests/share.test.js`), and frontmatter parsing (`tests/data-frontmatter.test.js`) document the contract more precisely than reading the implementation.
- After a meaningful unit of work, commit and push — the repo is on GitHub at `WrongerSandwich/traverse`

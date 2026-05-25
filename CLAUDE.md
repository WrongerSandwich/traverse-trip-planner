# Traverse

A personal road-trip filing cabinet — managed via Claude Code. Trips live as markdown; status is encoded by both folder location and frontmatter so files are self-describing. Fly-in destinations are out of scope — every idea should be drivable from `home.md`'s `home_coords`.

## Personal context

User-specific details (home base, vehicle, travelers, taste, seasonal preferences, recurring weekly commitments) live in `home.md`. **Always read `home.md` before generating, evaluating, or deepening trip ideas.** Its frontmatter is the source of truth for structured values like home coordinates, default travel radius, and vehicle specs; its prose is the source for taste and constraints.

When a user preference or constraint surfaces that isn't in `home.md`, flag it rather than silently encoding it in a trip file.

## Folder structure

```
traverse/
├── CLAUDE.md          # this file — repo conventions
├── AGENTS.md          # async-agent handoff conventions
├── docs/
│   ├── product.md     # design context for the frontend
│   ├── deploy.md      # self-host walkthrough (Docker / Node)
│   └── …              # additional design + ops docs
├── src/               # SvelteKit frontend (npm run dev -- --port 3456)
├── sample-data/       # bundled demo dataset for `npm run seed-sample`
└── data/              # user-managed runtime state (gitignored)
    ├── home.md        # personal preferences and constraints
    ├── settings.json  # runtime-editable provider keys + feature flags
    ├── ideas/         # parked, lightly sketched (single .md files)
    ├── planning/      # researched and actively becoming reality
    ├── completed/     # archive with retrospectives
    ├── archived/      # hidden from frontend; structure mirrors source stage
    │   ├── ideas/
    │   ├── planning/
    │   └── completed/
    └── .cache/        # geocode/image/route/workflow-stats caches
```

(Legacy `data/archived/exploring/` may exist for trips archived before the
exploring stage was retired — `collectExistingDestinations()` still
scans it so those destinations stay in the seed-avoidance list.)

Everything user-managed lives under `data/`. Path constants in
`src/lib/server/data.js` are anchored to `DATA_DIR = join(ROOT, 'data')`;
new code that touches trip files should join from `DATA_DIR`, never from
`ROOT` directly.

## Lifecycle

Trips progress through three stages. Earlier-stage fields are never removed — structure accrues as a trip matures.

1. **idea** — single `.md` file in `ideas/`. Fields: `title`, `status`, `destination`, `pitch`, `created`, `vibe`. Target: <30 seconds to create.
2. **planning** — promoted to a folder by the Research action. `overview.md` carries expanded frontmatter; siblings `route.md`, `logistics.md` appear as research fleshes them out. `plan.md` (day cards with lodging and field guide notes) and `candidates.md` (stop + lodging candidate pool) are written automatically as the second leg of the Research job. `stops.md` is kept if it already exists as a legacy artifact but is no longer produced. Concrete dates, lodging, and reservations accrue here as the trip firms up. The frontend's planning page enables in-place editing of any section + a "Field guide" command palette (Cmd-K or per-section `↳ Ask` buttons) that writes section updates back to disk, with diff-and-revert overlays rendered inline at the affected section.
3. **completed** — moved to `completed/`. The Mark-as-completed action offers an AI-prompted retro flow that writes `notes.md` (skippable; available later via an "Add retro" button on the completed view).

**Canonical section sets per stage:** The detail view always renders a fixed set of sections regardless of which files actually exist on disk. Missing files show an empty-state placeholder — producers (deepen, chat) are not required to write every section. The canonical sets are:
- planning: `overview`, `route`, `logistics`, `plan`, `candidates`
- completed: `overview`, `route`, `logistics`, `plan`, `candidates`, `notes`

When `itinerary.md` exists in a planning or completed folder, it renders above the canonical sections as a read-only legacy artifact. The brochure view (`/trips/<slug>/brochure`) is derived at request time from the current `plan.md` + `candidates.md` state — no separate brochure file is written or cached.

**Archive (orthogonal to lifecycle):** any trip can be archived via the detail view. Archived trips move to `archived/<source-stage>/<slug>/` with the original status frontmatter intact. The frontend never displays them, but the seed action still scans them so previously-rejected destinations don't get re-suggested.

## Frontmatter schema

**Minimum (idea):**
```
title, status, destination, pitch, created, vibe, image_query
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
- `image_query` — 2–4 concrete words sent to Pexels' keyword search for the card's hero photo (e.g. `"Chicago skyline downtown"`, `"Glacier mountains"`). Authored by the seed/add LLM because Pexels rewards visual nouns and punishes atmospheric phrases — letting the model pick the query produces far better matches than scraping the human-readable title. Legacy ideas without this field fall back to a stopword-stripped title in `imageQuery()` (`src/lib/server/data.js`).
- `waypoints` — key cities along the driving route as an inline array: `[Cleveland OH, Sandusky OH, Toledo OH]`. Used by the frontend to fetch an OSRM road-following route line. Required for the solid route line to appear on the map.
- `national_park: true` — add to any trip where the primary draw is an NPS unit (national park, preserve, scenic riverway). Surfaces a badge on the trip card.
- `starred: true` — bookmarked trip. Toggled by the frontend; write it here if pre-seeding a bookmark.
- `cost_tier` — `budget` | `mid` | `splurge`.

Omit fields rather than guess at creation. Dates are ISO 8601. Distances default to miles.

`plan.md` and `candidates.md` are structured-YAML files with their own schemas (see `docs/superpowers/specs/2026-05-22-planning-plan-and-candidates-design.md`). They are written by `realizePlan()` (`src/lib/server/realize-plan.js`) as the post-LLM half of the deepen pipeline, and edited by the Plan + Candidates UI; do not hand-edit their internal structure outside of the spec's defined fields.

## In-browser actions

All lifecycle operations live in the SvelteKit app — the browser is the canonical interface.

**Section editing.** Each section on a planning trip has its own `Edit` button — no global mode toggle. Click `Edit` on a section to open it in a textarea with Save / Cancel; the `Research →` button on empty sections is always visible. Completed trips render sections read-only (no per-section Edit). Lifecycle actions live in the `⋯` menu on every detail page.

**AI workflow UX rubric.** Every AI-driven workflow conforms to one of four archetypes defined in [`docs/ai-workflow-ux.md`](docs/ai-workflow-ux.md): **Instant Inline** (button-as-spinner, <15s), **In-Page Stream** (banner + streaming body, 15–60s), **Ambient Background** (user can navigate away; progress surfaced via the global pill in the app header and a per-trip badge on cards/detail headers), and **Conversational/Modal** (multi-step wizard). New AI workflows pick an archetype and reuse the primitives under `src/lib/workflow-status/`, `src/lib/components/BackgroundJobsIndicator.svelte`, and `src/lib/components/TripJobBadge.svelte`. Cancel for Ambient jobs lives in the jobs drawer; every typed failure routes through `ERROR_REGISTRY` in `src/lib/errors-registry.js`.

- **Seed** (`+` button on the home page) — generates 5 new idea files using `home.md` preferences. Optional steering prompt to focus the batch (e.g. "fall colors within 4 hours", "scenic byways with quirky small towns"). Instant Inline.
- **Add destination** (pin button on the home page) — generates a single idea file for a specific destination you name. Includes a semantic duplicate check against existing trips. Instant Inline.
- **Research →** (button on idea cards) — promotes an idea into a planning-stage folder with web-searched details: hours, prices, lodging, route highlights, logistics. Adds `waypoints` so the OSRM route line draws on the map. A single unified `chat()` envelope produces all six outputs (prose `overview.md` / `route.md` / `logistics.md` plus structured `plan.yaml` / `candidates.yaml`); the post-LLM `realizePlan()` step merges with any user-added candidates and writes everything atomically. Ambient Background: ~60s. Once research completes, a follow-on `geocode-candidates` background job (~15s, also Ambient Background) fills in candidate pin coords by name — the user sees two sequential pills (`Researching… → Research complete ✓ → Geocoding… → Geocoding complete ✓`) and the Candidates section header shows `Geocoding X of Y…` in flight / `X of Y pinned` after settled with some unmapped. Either job is cancellable from the jobs drawer.
- **Bookmark** (star icon) — toggles `starred: true|false` in the trip's frontmatter.
- **Plan section** (planning trips) — day-organized planner rendered from `plan.md`. Actions: `+ Add day` (appends a new empty day), `+ Add stop` (opens a picker over the candidates pool to promote a stop into a specific day), ↑↓ reorder stops within a day, edit day metadata (title, date, notes), set day lodging. On completed trips renders read-only.
- **Candidates section** (planning trips) — tabbed Stops / Lodging browse rendered from `candidates.md`. Each card shows category, name, and a short description. Actions: "Promote to day…" (picks a target day and moves the candidate into the Plan), "Un-promote" (removes a stop from its day and returns it to the candidate pool). On completed trips renders read-only.
- **View brochure** (`/trips/<slug>/brochure` for trips with a populated plan) — reached via `View full brochure ↗` in the `⋯` menu (Output group). A `↗ View brochure (for print)` affordance also appears above the section list on the detail page for new-flow trips with a populated plan. The brochure is derived at request time from the current `plan.md` + `candidates.md` state — no AI, no file cache, no user trigger needed. Print-optimized layout: cover photos and hero meta (date · distance · drive time · duration), paper-map route inset from home, Stadia destination map with numbered pin overlay (edge indicators for off-viewport stops, "unmapped" tag for stops whose pin we couldn't geocode), and sectioned content (stops, lodging, field guide notes, gotchas).
- **Print / Save PDF** (detail page, when a day-by-day view is available) — opens the browser print dialog. Print CSS hides all chrome so only the day-by-day content renders.
- **Mark as completed** (planning trips) — accessed from the `⋯` menu (Lifecycle group). Conversational/Modal. Moves the trip to `completed/` and opens an AI-prompted retro modal: 5 trip-specific questions, a star rating, and a "would do again" toggle. Each step renders failure via `ERROR_REGISTRY`; closing mid-flow with answers entered prompts a discard confirmation. The model writes a prose `notes.md` body with a `## Highlights` section; the server lifts those bullets into the file's YAML frontmatter alongside `rating`, `would_repeat`, and `date_completed`. Skippable; "Add retro" is available later in the `⋯` menu. PUT returns 409 if `notes.md` already exists — to redo, delete the file and reload.
- **Add retro** (completed trips, when `notes.md` is absent) — accessed from the `⋯` menu (Activity group). Opens the same AI-prompted retro modal as the initial Mark-as-completed flow.
- **Add receipts** — _disabled pre-launch (see issue #367)._ `getFeatureAvailability().receipts` is hard-coded to `false` in `src/lib/server/config.js`, which hides the `⋯` menu entry. The endpoint, error mapping, telemetry promise, and UI block all remain mounted so the redesign can iterate without re-plumbing. Reintroduction is gated on the receipts-as-ledger design — touch this code path when reviving the feature, not for incidental refactors. The shipped (now-hidden) behavior: accepts JPEG/PNG/WebP/GIF uploads on completed trips (max 10 × 5 MB), sends images to `chat()` as `{type: 'image', mediaType, data}` content blocks (Anthropic + OpenAI/OpenRouter both translate), parses each into a `date · merchant · amount · category` line, appends a `## Receipts` section to `notes.md` via `appendToNotes()`.
- **Archive** (detail view, gated by confirm) — accessed from the `⋯` menu (Lifecycle group, danger styling). Moves the trip to `archived/<stage>/<slug>/`. The trip vanishes from the UI but stays in the seed-avoidance list.

## Frontend

The SvelteKit app in `src/` is the primary interface. Two ways to run it:

- **Dev:** `npm run dev -- --port 3456` (hot reload)
- **Prod:** Docker (`docker compose up -d` / `docker compose logs -f traverse`) — the home server runs the `traverse` container, port 3456. PM2 / `node build/index.js` are legacy paths, no longer in use.

The frontend reads trip data from the markdown files on each page load. All three external lookups are disk-backed under `data/.cache/` and persist across restarts:

- `data/.cache/.geocode-cache.json` — Nominatim destination + waypoint coordinates
- `data/.cache/.image-cache.json` — Pexels photo URLs
- `data/.cache/.route-cache.json` — OSRM road route geometries

A fourth disk-backed file, `data/.cache/.workflow-stats.json`, holds rolling p50 telemetry for the `_promise` time/token estimates (see `src/lib/server/workflow-stats.js`). It's written from `chat()` on every AI call and read by `getResolvedPromises()` at load time; the layout server passes the resolved map to the client as `data.promises`.

A fifth file, `data/.cache/.jobs.json`, is the volatile registry of in-flight Ambient Background jobs (written by `startJob` / `completeJob` / `failJob` in `src/lib/server/jobs.js`). On boot, `sweepStaleJobs()` reads it, marks each listed trip's frontmatter with `last_run_error: 'interrupted'`, then deletes the file. It lives under `.cache/` for the bind-mount reasons below but is registry state, not memoized lookups.

The `.cache/` directory rather than root-level files is so Docker can bind-mount a directory: per-file bind mounts break the atomic-write rename with `EBUSY` (kernel won't replace a bind-mount target). A one-shot migration in `data.js` / `workflow-stats.js` moves any pre-`.cache/` files into the new location on first read.

`enrichTrips()` runs a GC pass each request that prunes orphaned cache entries (e.g. when a trip is deleted or its `waypoints` change), guarded so a transient empty trip list can't wipe everything.

Routes themselves are **not** shipped in the SSR HTML — that bloated each page load by ~80 KB. They're served lazily via `/api/route/[slug]` and fetched client-side when a card is hovered/scrolled-into-focus.

After adding or renaming trips, the next page load picks them up automatically; no manual cache warming needed.

## Conventions

- File names: kebab-case, no dates (e.g. `ozarks-backroads.md`)
- Never remove frontmatter fields during promotion; only add or refine
- When uncertain about a field at creation, omit it
- Research is a single `chat()` envelope (post-#380): the deepen handler asks for `<overview_prose>`, `<frontmatter>`, `<route_md>`, `<logistics_md>`, `<plan>` YAML, and `<candidates>` YAML in one round-trip, then `realizePlan()` writes them atomically. No subagents, no per-file prompts, no separate extract leg. Re-running on a planning trip is gated by a dirty-section scan (`_collectDirtySections` in `src/routes/api/actions/deepen/[slug]/+server.js`) that returns 409 with the list of edited sections so the UI can confirm an overwrite.
- Distance, radius, and vehicle-specific logic read from `home.md` frontmatter; don't hardcode user-specific numbers in commands or subagents
- All model calls go through `chat()` in `src/lib/server/ai.js`; all web search goes through `search()` / `searchToolDefinition()` in `src/lib/server/search.js`. Don't `import Anthropic` (or any other SDK) in route handlers — add a new adapter under `src/lib/server/{ai,search}/` instead. Pass a `label` to `chat()` so token-usage logs are grouped by feature.
- AI workflows must pick an archetype from [`docs/ai-workflow-ux.md`](docs/ai-workflow-ux.md) and reuse the shared primitives (`src/lib/workflow-status/`, `src/lib/components/BackgroundJobsIndicator.svelte`, `src/lib/components/TripJobBadge.svelte`, `src/lib/components/PromiseTooltip.svelte`, `src/lib/components/ConfirmModal.svelte`). Ambient Background workflows register with `src/lib/server/jobs.js`; failures map to `ERROR_REGISTRY` codes from `src/lib/errors-registry.js` — no inline catch sentences.
- Page data on every route includes `data.features` (from `getFeatureAvailability()`) and `data.assistantName` (from `TRAVERSE_ASSISTANT_NAME`). Use them to gate UI affordances and render assistant-name strings rather than hardcoding.
- `npm run verify` is the standard go/no-go: svelte-check (`--fail-on-warnings`) + tests + build. Run it before declaring work done and before opening a PR. CI runs the same command.
- `npm run smoke` does a 1-token round-trip per configured provider plus a tool-loop probe when search backend is non-builtin. Run it before deploys, after env changes, and after touching any `chat()` call site or AI/search adapter.
- For async-agent handoff (cloud sessions picking up issues from GitHub), see [AGENTS.md](AGENTS.md) — it covers the verification flow, ticket conventions, and the `design` label that marks issues unsafe for autonomous pickup.
- When a module's behavior is unclear, **the test suite is authoritative.** AI adapters (`tests/ai-anthropic.test.js`, `tests/ai-openai.test.js`), the post-LLM plan/candidates realizer (`tests/realize-plan.test.js`), plan/candidates I/O (`tests/plan-io.test.js`, `tests/candidates-io.test.js`), brochure derivation (`tests/derive-brochure.test.js`), and frontmatter parsing (`tests/data-frontmatter.test.js`) document the contract more precisely than reading the implementation.
- Use CSS custom-property tokens, not raw color literals. Hardcoded `#`/`rgba/hsl` values are acceptable only for (a) shadows or (b) scrims over photographic content. Any other literal should reference a token in `src/app.css` so it adapts in dark mode.
- After a meaningful unit of work, commit and push — the repo is on GitHub at `WrongerSandwich/traverse-trip-planner`

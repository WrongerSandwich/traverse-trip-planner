# Changelog

All notable changes to Traverse are recorded here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] — 2026-05-25

First public release. Stable enough for daily personal use, with a recommended
self-host path that doesn't require a Node toolchain on the host.

### Trip lifecycle

- `idea → planning → completed` flow with an orthogonal `archived/<stage>/`
  side-state for "remembered but hidden."
- Trip data is plain markdown on disk — `overview.md`, `route.md`,
  `logistics.md` for prose; structured YAML in `plan.md` (day-by-day stops +
  lodging) and `candidates.md` (the unassigned stop/lodging pool); optional
  `notes.md` retrospective on completion.
- All user state under a single `data/` directory designed for Docker
  bind-mount.

### AI-assisted workflows

- **Seed** — generate a batch of trip ideas from your `home.md` taste profile
  with an optional steering prompt.
- **Add destination** — generate a single idea for a named place, with a
  semantic duplicate check against existing trips.
- **Research →** — promote an idea into a full planning trip with
  web-searched details: overview, route, logistics, day-by-day plan, and a
  pool of stop/lodging candidates — all from one model envelope, followed by
  a background `geocode-candidates` pass that fills in pin coordinates.
- **Field guide chat** — Cmd-K or per-section `↳ Ask` opens an AI assistant
  that edits any section in place, with inline diff-and-revert overlays.
- **Retro on completion** — AI-prompted 5-question Q&A writes a structured
  `notes.md` retrospective (highlights, star rating, would-repeat flag).

### Frontend

- SvelteKit app with home/map/detail/brochure/onboarding/home-base/configuration
  routes.
- Plan + Candidates structured editors: add/reorder days, promote candidates
  into days, set day-level lodging.
- Print-optimized brochure (`/trips/<slug>/brochure`) derived live from
  `plan.md` + `candidates.md` — cover photo, paper-map route inset, numbered
  destination map, sectioned content. No file cache, no AI on request.
- Interactive home-page map with drive-time routing (OSRM), filtering by
  stage / drive time / cost tier / NPS units / bookmarks.
- ICS calendar feed (`/api/cal.ics` and per-trip `/api/cal/<slug>.ics`) for
  subscribing planned trips to Google / Apple / Outlook.
- Dark mode via CSS custom-property tokens.
- AI workflow UX standardized across four archetypes (Instant Inline,
  In-Page Stream, Ambient Background, Conversational/Modal) with shared
  primitives for global job pill, per-trip badges, promise-tooltip ETAs,
  and an error registry.

### Providers (bring your own keys)

- **Anthropic**, **OpenAI**, and **OpenRouter** all first-class, with
  per-feature model overrides.
- **Search backends**: `anthropic-builtin` (server-side web search, the
  default) and `tavily` (portable across any model provider).
- Startup banner enumerates which provider/model is wired for each feature
  and tags overrides.

### Self-hosting

- Docker is the canonical deployment path (`docker compose up -d --build`);
  the README also documents an npm path for development.
- In-app onboarding wizard creates `data/home.md` on first run — no
  hand-editing required.
- Settings UI split into `/home-base` (personal preferences) and
  `/configuration` (API keys, model routing, feature flags).
- `TRAVERSE_DISABLE_SETTINGS_UI` for production deployments that prefer
  `.env`-only key management; `TRAVERSE_ALLOW_LAN_WRITES` /
  `TRUST_PROXY_FOR_AUTH` for non-loopback browser access.
- Sample dataset shipped under `sample-data/`; `npm run seed-sample`
  populates `data/` with twelve real-shaped trips for instant exploration.

### Reliability

- All model calls flow through one `chat()` adapter with per-feature labels,
  per-call token logging, exponential-backoff retry on transient failures
  (network blips, 429, 5xx), and a smoke check (`npm run smoke`) for
  cold-start provider verification.
- All web search flows through one `search()` adapter.
- Disk-backed caches under `data/.cache/` for geocode (Nominatim), images
  (Pexels), routes (OSRM), and workflow-stats telemetry (rolling p50s that
  feed the in-flight ETA tooltips).
- Background-job registry (`data/.cache/.jobs.json`) with stale-sweep on
  boot — interrupted Ambient jobs surface in the UI rather than hanging.
- Atomic-write semantics for all trip-file mutations (`tmp` staging +
  `rename`) to survive crashes mid-write.

### Testing + CI

- `npm run verify` (the standard go/no-go): `svelte-check --fail-on-warnings`,
  the test suite, and a production build. Runs in CI on every PR.
- ~80 test files covering the AI adapters, search adapters, planning I/O,
  brochure derivation, frontmatter parsing, retro flow, deepen pipeline,
  realize-plan post-LLM merge, jobs registry, error registry, and frontend
  components.

### Documentation

- README with self-host quickstart, configuration paths, and screenshots.
- `docs/deploy.md` for the full Docker / npm walkthrough and configuration
  reference.
- `docs/product.md` for the design rationale.
- `docs/ai-workflow-ux.md` for the workflow-archetype rubric new AI features
  must conform to.
- `docs/manual.md` as the user-facing operating manual.
- `AGENTS.md` for cloud-session ticket pickup conventions.

### Known limitations at this release

- Receipts feature is wired but disabled pre-launch (see
  `getFeatureAvailability().receipts`) pending the receipts-as-ledger redesign.
- Itinerary parsing of legacy `itinerary.md` artifacts is read-only; new
  trips use `plan.md` + `candidates.md`.
- Single-user assumption: no auth model, no per-user data isolation. Sit
  behind a reverse proxy with basic auth if exposing beyond `localhost`.

[Unreleased]: https://github.com/WrongerSandwich/traverse-trip-planner/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/WrongerSandwich/traverse-trip-planner/releases/tag/v0.1.0

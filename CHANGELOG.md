# Changelog

All notable changes to Traverse are recorded here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.1] — 2026-05-27

Stability & polish release. Eight tickets across security hardening,
performance, a cache-coordination bug, and open-source documentation cleanup.

### Security

- **CSP without `'unsafe-inline'` on `script-src`** ([#426], #433). Content-Security-Policy is now owned by SvelteKit's `kit.csp` config (mode `hash`); inline scripts — both SvelteKit's own hydration script and the static theme bootstrap in `app.html` — are admitted by sha256 hash rather than the blanket `'unsafe-inline'` previously emitted from `hooks.server.js`. An XSS-injected inline script no longer executes.
- **`X-Forwarded-For` chain validation** ([#419], #431). When `TRUST_PROXY_FOR_AUTH=1`, the loopback gate now rejects multi-hop XFF chains as untrusted. A LAN attacker behind an nginx proxy with the default `proxy_add_x_forwarded_for` could previously spoof a loopback prefix and bypass the config-writer gate on `/api/settings` and `/api/home`; that path is closed. New shared `clientIpFor()` helper in `src/lib/server/client-ip.js`; `docs/deploy.md` now carries working Caddy + nginx snippets.
- **Deepen XML allowlist** ([#422], #432). The deepen pipeline rejects any LLM response containing XML tags outside the six expected envelope tags (`overview_prose`, `frontmatter`, `route_md`, `logistics_md`, `plan`, `candidates`). A prompt-injected trip note can no longer smuggle a `<file>` directive past the parser. New error code `model_returned_unexpected_xml`; not retried.

### Performance

- **Parallel cache-hit geocoding** ([#421], #430). Home-page SSR no longer pays the 1.1s-per-trip Nominatim throttle on warm cache hits. A two-tier resolution pass synchronously reads cached coordinates first and only serializes the cache-miss subset through the rate-limited path. Warm-cache geocode phase drops from ~11s for 10 trips to <200ms.

### Fixes

- **Atomic cache flush** ([#420], #434). The three disk-backed caches (geocode, image, route) are now stored in a single combined file under `data/.cache/.caches.json`. `flushCaches()` performs one `atomicWrite()` per flush, so concurrent SSR requests can't interleave with `pruneCaches()` and leave the three caches referentially out of sync. One-shot migration on first boot merges any legacy files into the combined layout and deletes them.
- **`.env.example` placeholders no longer enable AI features** ([#425], #429). The bundled `ANTHROPIC_API_KEY=sk-ant-api03-...` placeholder was truthy under the old `Boolean(envObj[keyName])` check, so a fresh `cp .env.example .env` made AI features appear configured even without a real key. The placeholder is now commented out; provider-key validation goes through `isRealKey()` as defense-in-depth so the failure mode is impossible to re-introduce.

### Docs & dependencies

- **Open-source setup references** ([#424], #427). Stale `/settings` references replaced with `/home-base` / `/configuration` across `README.md`, `SUPPORT.md`, `docs/deploy.md`, and `.env.example`. `settings.example.json` now includes the `services`, `search.provider`, and `assistantName` keys that the documented overlay shape expects.
- **Drop stale `package.json` overrides** ([#423], #428). The `@sveltejs/vite-plugin-svelte` pin was a no-op after the SvelteKit/Vite bumps and has been removed. The `cookie: ^0.7.2` override was *not* a no-op — `@sveltejs/kit` requires `cookie: ^0.6.0` directly, and removing the pin would float it to the vulnerable 0.6.0 (CVE GHSA-pxg6-pf52-xh8x). The retained override is now annotated as a security pin.

[#419]: https://github.com/WrongerSandwich/traverse-trip-planner/issues/419
[#420]: https://github.com/WrongerSandwich/traverse-trip-planner/issues/420
[#421]: https://github.com/WrongerSandwich/traverse-trip-planner/issues/421
[#422]: https://github.com/WrongerSandwich/traverse-trip-planner/issues/422
[#423]: https://github.com/WrongerSandwich/traverse-trip-planner/issues/423
[#424]: https://github.com/WrongerSandwich/traverse-trip-planner/issues/424
[#425]: https://github.com/WrongerSandwich/traverse-trip-planner/issues/425
[#426]: https://github.com/WrongerSandwich/traverse-trip-planner/issues/426

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

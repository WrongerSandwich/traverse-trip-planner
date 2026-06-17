# Changelog

All notable changes to Traverse are recorded here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.4] — 2026-06-17 · Planning-page refresh & candidate overhaul

### Added
- **Auto-enriched candidates** (#526). When you **Find more** or **Add** a
  candidate, the new stop now automatically runs the same `geocode → enrich`
  background chain the Research action uses — filling in coordinates, address,
  hours, website, and phone — instead of landing bare and needing a separate
  enrichment pass. The chain is idempotent and pool-wide, so it also backfills
  older candidates that were missing metadata. Surfaced via the usual
  Ambient-Background pills; the Add-a-candidate card still appears instantly while
  the details fill in behind it.

### Changed
- **Planning page visual refresh** (#510, #511, #516). Redesigned the trip detail
  page (`/trips/<slug>`) into a tiered "soft-card dashboard": calm editorial prose
  for Overview/Route/Logistics, elevated cards for Plan & Candidates (day-card
  accent edges, category icon-chips, disclosure pills, between-stop drive
  connectors, lodging sub-card), a slim gradient header with a meta pill row,
  and — on desktop (≥960px) — a two-column layout with a sticky **trip rail** (mini
  overview map, quick stats, scroll-spy section nav). Adds elevation/radius + chip
  design tokens to `app.css`. Mobile-first; all behavior preserved.
- **Decision-first candidate cards** (#518, #519, #520, #528). The candidate stop
  card was re-ranked around the "does this belong in my plan?" decision: the
  personalized **why-it-fits** line leads, the factual description clamps to two
  lines with a `…more`, and a single tap expands the card to a **full-width** panel
  of hours/address/phone — retiring the old half-width Details drawer. The source
  link is deduped to one, and the category reads as a caption under the name.
  Progressive disclosure keeps a long candidate pool scannable.
- **Candidates browsing** (#511). Stops/Lodging is now a segmented control, and
  the category filter collapses behind an opt-in **Filter** affordance (scoped to
  Stops) so the section leads with content instead of a chip wall. Chip/badge
  geometry consolidated into shared `app.css` primitives for consistency.
- **Plan section, mobile** (#508, #509). Bigger tap targets and clearer reorder
  controls, tighter day-card density, and confirm-gated destructive actions on
  phones.

### Fixed
- **Candidate card off-screen overflow** (#527). Opening a candidate's Details on
  a narrow viewport pushed the description/link rows off the right edge — a
  flex/grid `min-width:auto` overflow trap. (Structurally retired by the #528
  full-width panel above; the fix stands for any remaining narrow-card cases.)
- **Accessibility** (#511). AA contrast on accent-filled controls (e.g. the
  lodging "Book" button) and category-chip glyphs in both themes; corrected a
  skipped heading level (h2→h3) in Candidates; the prep progress bar no longer
  animates a layout property.
- **Sticky header + trip rail** (#512). The trip detail page set `overflow: auto`
  on `<html>` to re-enable scrolling, which silently broke `position: sticky` for
  the header and rail (they scrolled away). Use `overflow: visible`.
- **Map over sticky header / iOS overscroll** (#513). Leaflet maps no longer paint
  over the sticky header (`TripMap` isolates its stacking context), and
  `overscroll-behavior-x: none` stops a few px of horizontal rubber-band on iPad.
- **Fetch-failure safety** (#499). DetailPanel surfaces load errors instead of
  hanging, bookmark toggles revert on a failed write, and concurrent palette edits
  no longer clobber each other.
- **Today empty state** (#505). A trip whose plan has zero days degrades to the
  empty state instead of erroring.
- **Data-layer robustness** (#503). Surfaced previously-swallowed geocode errors,
  graceful route-line degradation, and fixed cache GC / memoization races.
- **Background jobs** (#500). Registry-persistence failures are surfaced rather
  than lost.
- **AI token ceiling** (#501). Enforce a cumulative output-token ceiling across the
  whole tool loop, not just per call.
- **Defense-in-depth** (#502). A hardening batch across input handling.

### Internal
- Dev-experience: a worktree bootstrap script + dev-credentials template (#504),
  worktree dev-server hydration + smoke-probe sizing for reasoning models (#506),
  untracked an accidental `node_modules` symlink and hardened `.gitignore` (#507),
  and a housekeeping batch — engines, doc paths, color tokens, popover focus
  (#498).
- Design docs: added `DESIGN.md` so the design context auto-loads (#515), recorded
  the itinerary-rail / marker / no-emoji-icon patterns (#517), and the
  planning-page refresh gotchas (#514).
- Dependencies: bumped `@anthropic-ai/sdk`, `@sveltejs/kit`, `svelte`,
  `svelte-check`, `vitest`, `marked`, and `isomorphic-dompurify` (#483, #484,
  #485, #486, #487, #521, #522, #523, #524, #525).

## [0.1.3] — 2026-06-08 · Offline support

### Added
- **Mobile "Today" view** (#442). A phone-first, single-day in-trip surface at
  `/trips/<slug>/today`, derived at request time from `plan.yaml` +
  `candidates.yaml` (no AI, no cache). Shows the day's stops with hours/address
  and Navigate/Call/Site actions, a tips & to-dos disclosure, tonight's lodging,
  and a collapsed field guide & gotchas panel. Day selection via `?day=N` or
  auto-resolved to today's date (`resolveCurrentDay()`). Reached from a
  "Today / in-trip view" toolbar link and a `⋯`-menu entry; shows an empty state
  (never a 404) when a trip has no plan yet.
- **Offline Today-view bundle** (#443). A **Save for offline** action (Today
  header + `⋯` menu) downloads a single self-contained HTML file of the trip's
  Today view — all days, an in-file day switcher, `geo:`/`tel:`/Maps/Booking
  links, and a "synced as of" banner — that works with zero connectivity to the
  home server. Because the deploy serves plain HTTP on a LAN address (no secure
  context for a service worker), a downloadable bundle is the offline path; the
  PWA route is deferred and TLS-gated (#475). The bundle inlines all CSS and has
  **zero external subresources** (CI-enforced).
- **In-trip capture** (#444). On a planning trip's Today view, mark each stop
  **visited/skipped** (one-tap toggles) and jot a per-stop **note** plus a
  per-day **note**, written live to the home server (online-only). Stored on
  `candidates.yaml` / `plan.yaml` alongside the existing per-stop fields and
  preserved across re-research. At Mark-as-completed it both **grounds the retro
  prompt** and is preserved **verbatim** under a new `## In-trip notes` section in
  `notes.md`, so the retro starts from what you actually recorded rather than a
  blank page. The offline write-queue is deferred (#476).

### Internal
- Bundled a **Galena, IL** sample planning trip with a full day-by-day plan so
  `npm run seed-sample` yields a Today/brochure-viewable trip (#471).
- Documented a **manual Playwright-MCP QA flow** + a "Manual QA pass" spec
  convention in `docs/manual-qa.md` (#473), and added the first committed jsdom
  regression test, for the offline day-switcher (#481).

### Deferred
- The broader offline/PWA arc is captured for later: a TLS-gated PWA /
  service-worker (#475), an offline write-queue for capture (#476), and
  offline-completing the bundle with brochure + map-tile/photo caching (#477).

## [0.1.2] — 2026-06-03 · In-trip companion

### Added
- **Per-stop metadata** (#403). Every stop candidate can now carry `hours`,
  `address`, `website`, and `phone`. Address is captured for free as a
  byproduct of the existing geocode-candidates job (Nominatim reverse
  lookup). Hours, website, and phone are filled by a new `enrich-candidates`
  follow-on job that runs automatically after geocoding, or on demand via
  the new **Refresh metadata** button in the Candidates section header.
  Re-fetching all metadata triggers ~1 `chat()` call per stop with web
  search — small but non-zero token cost.
- Metadata renders as a chip row on candidate cards (Candidates section)
  and as an expanded info stack on stops promoted into a day (Plan section,
  the in-trip companion view). The print brochure now renders all four
  fields when present.
- **Trip export formats** (#405). Two new outputs surface in the trip detail
  page's `⋯` menu beyond the print brochure:
  - **📅 Download .ics** — one calendar event per day when the plan has
    dated days, anchored to each day's date. Falls back to a single
    trip-level event when only `target_date` is set. Hidden when neither
    applies.
  - **🗺 Day N in Maps ↗** — one Google Maps deep link per day with
    promoted stops, routing through the day's stops in order. Opens in a
    new tab (or the Maps app on iOS/Android). Disposable, in-trip useful.
- **Per-stop prep** (#406). Auto-generated read-only tips and checkable
  pre-trip to-dos for each promoted stop, surfaced on Plan day-cards, a
  trip-prep roll-up (`X of Y done`), and the printable brochure (static
  ☐/☑). Generated by a new `stop-prep` Ambient Background job that runs
  after enrichment, grounded in trip context. **Refresh prep** fills gaps;
  **Re-generate all** clears every check-off and re-preps every visible
  stop. The two new optional stop fields (`tips`, `todos`) round-trip
  through `candidates.yaml` and are preserved forward by id across
  re-research.
- **Per-turn AI telemetry** (#436). Each tool-loop iteration in all three
  `chat()` adapters (Anthropic, OpenAI, OpenRouter) now emits a `turn`
  activity event and logs a grep-friendly line
  (`[ai] deepen turn 3: 14823ms · 12450 in / 187 out · tool=web_search`),
  making it possible to see where a long deepen run spends its time. Pure
  observability — no change to tool-loop behavior. (The broader wall-clock
  budget for empty-response retries tracked in #436 is deferred.)

### Fixed
- **Configuration save errors surface server detail** (#437). The
  configuration page's save, key-removal, and service-removal paths now prefer
  a recognized `ERROR_REGISTRY` code, then the server's error string, before
  falling back to the generic "save failed" sentence — so a loopback-gate 403
  (new `forbidden_remote_write` code) or a provider-key validation failure is
  no longer masked behind a generic message.
- **ICS exports fold long lines** (#441). Calendar (`.ics`) content lines
  longer than 75 octets are now folded per RFC 5545 §3.1 (CRLF + leading
  space), so days with long titles, notes, or locations import correctly into
  strict calendar parsers instead of being rejected or truncated.

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

[Unreleased]: https://github.com/WrongerSandwich/traverse-trip-planner/compare/v0.1.4...HEAD
[0.1.4]: https://github.com/WrongerSandwich/traverse-trip-planner/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/WrongerSandwich/traverse-trip-planner/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/WrongerSandwich/traverse-trip-planner/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/WrongerSandwich/traverse-trip-planner/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/WrongerSandwich/traverse-trip-planner/releases/tag/v0.1.0

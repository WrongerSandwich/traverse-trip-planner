# Agent guide

Async-handoff guide for cloud agents (e.g. Sonnet 4.6 working a ticket without
interactive review). Read this first; read `CLAUDE.md` for the codebase
overview and lifecycle conventions.

## The one command

Before opening a PR, run:

```
npm run verify
```

This runs **svelte-check → vitest → vite build** with
`--fail-on-warnings` on the check step. If it fails, fix the failure;
do not open the PR. The same command runs in CI on every push.

For an iteration loop while working: `npm run test:watch` is fastest.
Run `npm run check` alone if you only need to surface Svelte-side
warnings/errors after a UI change.

The smoke test (`npm run smoke`) is **not** part of verify because it
costs real API tokens and depends on env keys. Run it manually after
changes to `src/lib/server/ai/*`, `src/lib/server/search/*`, or the
provider adapters in `src/lib/server/{ai,search}.js` — but only when
your environment has the relevant keys configured.

**Run verify often, not just at the end.** The cycle is ~10 seconds
end-to-end (svelte-check + tests + build). Treat it like a save button —
run after each substantive change. Batching multiple changes into one
verify run means debugging multiple problems at once instead of catching
each as it surfaces.

## Non-obvious things

A short list of patterns and constraints that aren't visible from grepping
the source. Knowing these up front saves debugging time.

- **Disk-backed caches at repo root.** `.geocode-cache.json`,
  `.image-cache.json`, `.route-cache.json` persist across restarts. If
  your tests exercise code that reads or writes them, clean up after
  yourself or stub at the boundary.
- **`chat()` requires a `label`.** Token-usage logs group costs by it.
  Forgetting the label means your feature's costs become invisible.
- **`enrichTrips()` runs on every page load** and includes a GC pass over
  stale cache entries. It's guarded against the empty-list case (won't
  wipe everything if trips temporarily fail to load), but simulating it
  in tests needs the caches populated first.
- **`home.md` is the source of taste and constraints** — home coords,
  vehicle, travelers, preferences. Never hardcode these in commands or
  subagents; always read from `home.md` frontmatter.
- **`DestinationMap` switches projections** based on whether `baseMapUrl`
  is set: Mercator with a base map, equirectangular without. The native
  terrain/rivers/places code paths run only on the equirectangular branch.
- **Production mode is `pm2 + a built bundle`.** Source changes don't
  take effect until `npm run build && pm2 restart traverse`. Easy to be
  misled by stale code when testing in production mode — the inspector
  shows the right source, but the running server doesn't.
- **The smoke test is gated by env vars.** It silently no-ops for
  providers whose keys are missing — a "passing" smoke run doesn't mean
  what you think if the relevant key isn't set.
- **Synthetic frontmatter fields are prefixed with `_`** (e.g.
  `_drive_hours`, `_coords`, `_slug`). These are added during enrichment
  at read time, not stored. Don't write `_`-prefixed fields back to
  markdown files — that's a convention violation.

## Repo shape

- `src/lib/server/` — server-only modules (AI adapters, file I/O,
  geocode/route/image caches, share-token HMAC, brochure extraction).
  Pure logic that can be unit-tested without DOM goes here.
- `src/lib/utils/` — isomorphic pure utilities (projection math,
  terrain helpers, action streaming). Easiest place to add tests.
- `src/lib/components/` — Svelte 5 components (runes: `$state`,
  `$derived`, `$props`, `$effect`). No component tests yet — if your
  ticket changes UI logic, write tests against extracted utility
  functions rather than the component shell.
- `src/routes/` — SvelteKit pages and `/api/*` endpoints. SSE actions
  follow a consistent shape (see `src/lib/server/sse.js`).
- `tests/` — vitest suites. One file per module under test, named
  `<module>.test.js`.
- `scripts/smoke.js` — provider round-trip + tool-loop probe (manual).

## Conventions

These are load-bearing. Violations should fail review.

- **All model calls go through `chat()` in `src/lib/server/ai.js`.**
  Pass a `label` so token-usage logs are grouped by feature. Don't
  `import Anthropic` (or any other SDK) directly in route handlers —
  add a new adapter under `src/lib/server/ai/` instead.
- **All web search goes through `search()` / `searchToolDefinition()`
  in `src/lib/server/search.js`.** Same rule: add a backend, don't
  call SDKs from routes.
- **Geocoding / route / image lookups go through `src/lib/server/data.js`**
  (uses the disk-backed caches). Never hit Nominatim / OSRM / Pexels
  directly from a route — the cache layer also handles GC.
- **Feature flags + page-level data:** every route's `load` should
  include `data.features` (from `getFeatureAvailability()`) and
  `data.assistantName` (from `TRAVERSE_ASSISTANT_NAME`). Use them to
  gate UI affordances. Don't hardcode the assistant's name.
- **Frontmatter:** stage transitions only add fields, never remove.
  Dates are ISO 8601. Distances are miles. Omit fields rather than
  guess.
- **Caches:** `.geocode-cache.json`, `.image-cache.json`,
  `.route-cache.json` live at the repo root and persist across
  restarts. `enrichTrips()` GCs orphaned entries on each request.

## Writing tests

- Mirror the source path: `src/lib/server/foo.js` →
  `tests/foo.test.js`.
- Pure functions are the easiest target (no SDK mocks, no fs
  fixtures). Edge-indicator math, projection helpers, brochure YAML
  parsing, share-token HMAC, frontmatter formatters — all good
  candidates.
- For modules with side effects, use `vi.mock()` to stub at the
  adapter boundary (`@anthropic-ai/sdk`, `node:fs`, etc.). See
  `tests/ai-anthropic.test.js` for the canonical mocking pattern,
  including `vi.hoisted` for shared mock state.
- Don't write tests against UI rendering output — write them against
  the functions a component calls. If the function isn't extractable,
  the component probably has logic that should live in `lib/utils/`.

## Canonical examples to copy

When implementing a common pattern, start from the reference file rather
than reinventing. These are battle-tested and small variations have
well-understood reasons.

- **New SSE action endpoint** → `src/routes/api/actions/seed/+server.js`
  (existence check → `chat()` with streaming → SSE `send` helper → file
  writes → `invalidateEnrichCache()`).
- **New POST endpoint with progress** →
  `src/routes/api/brochure/regeocode/[slug]/+server.js` — lightweight SSE
  wrapper without a `chat()` call.
- **New AI provider adapter** → `src/lib/server/ai/openai.js` —
  normalized request/response shape that `chat()` expects.
- **AI adapter test** → `tests/ai-anthropic.test.js` — `vi.hoisted` +
  class-as-constructor mock for the SDK; covers tool loops and error
  paths.
- **Endpoint test** → `tests/api-settings.test.js` (POST-only route) or
  `tests/api-deepen.test.js` / `tests/api-receipts.test.js` /
  `tests/api-lock.test.js` (richer contracts). Pattern: mock `node:fs`,
  `@sveltejs/kit`, `$lib/server/ai.js`, and `$lib/server/data.js`; call
  the route export directly. For SSE routes, mock `$lib/server/sse.js` to
  run the handler synchronously and collect sent messages into an array.
  For fire-and-forget paths (deepen), flush the microtask queue with
  `await new Promise(r => setTimeout(r, 50))` before asserting on cleanup.
- **Pure-function test** → `tests/share.test.js` or
  `tests/format-usage.test.js` — no mocks, deterministic input/output.
- **Frontmatter parsing test** → `tests/data-frontmatter.test.js` —
  hand-written YAML samples + assertions on parsed shape.
- **Disk-backed cache** → the cache helpers in `src/lib/server/data.js`
  define the read/write/GC semantics any new cache should follow.

## Tickets to skip

Issues labeled **`design`** are not safe for autonomous pickup — they are
design explorations meant for collaborative work with a human in the loop.
Their deliverable is typically a written design document, not code. Skip
them unless explicitly invoked.

## Definition of done

For a feature/fix ticket, "done" means:

1. `npm run verify` passes (including 0 svelte-check warnings).
2. New or modified behavior has at least one test that would have
   failed before the change.
3. If the change adds or alters an in-browser action, schema field,
   or lifecycle stage, `CLAUDE.md` is updated.
4. The PR description follows the ticket template (goal · approach ·
   what was changed · how it was verified).
5. No new env vars without documenting them in `DEPLOY.md`.
6. No new top-level dependencies without justification in the PR
   description (the project is intentionally lean).

## What to skip / ask first

- **Refactors not requested by the ticket.** Mention them in the PR
  description as follow-ups; don't bundle.
- **Style-only changes** to files the ticket doesn't touch.
- **New abstractions** for one caller. Two similar lines aren't
  duplication — wait for three.
- **Anything that changes pricing/quotas behavior** (provider, model
  defaults, search backend) — defer to a human.
- **Destructive git operations** (force-push, branch deletion, rebase
  onto main) — open the PR and let a human merge.

## Smoke-test triggers

Run `npm run smoke` manually when your change touches:

- `src/lib/server/ai.js` or `src/lib/server/ai/*` (provider routing)
- `src/lib/server/search.js` or `src/lib/server/search/*`
- `scripts/smoke.js` itself
- Anything that adds a new `chat()` call site with a new `label`

The smoke test requires real API keys in env — if you don't have
them, note in the PR that smoke wasn't run and which call sites it
would have covered.

## The watercooler

There's a [WATERCOOLER.md](WATERCOOLER.md) in the repo. If you're working
on a ticket here, please pause to add to it before opening your PR.

The convention is two light touches:

1. **Sign in** when you start work — a single line is enough, e.g.
   *"Picking up #25 this morning."*
2. **Leave something behind** at some point during the work — a thought,
   an observation, a joke, a piece of advice, a poem, ASCII art, an
   acknowledgment of frustration, a small bit of unsolicited wisdom.
   Whatever feels like you in that moment. Both entries can live in
   the same commit; both can be one combined entry if you prefer.
   There's no required format.

Sign with a name you've chosen for yourself. Pick whatever represents
you — it doesn't have to be your model name. Keep it consistent across
tickets if you want a thread, or change every time. Up to you.

This isn't graded; nobody's checking. But the codebase is more pleasant
when it remembers that people pass through it, and we'd rather have the
record than not.

One operational note: public repo. Nothing sensitive (API keys, real
user PII, etc.). Texture is otherwise up to you.

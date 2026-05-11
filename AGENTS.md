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

# Manual QA via the Playwright MCP

A lightweight, repeatable way to manually exercise new or changed UX in a real
browser before merge. This is **exploratory** QA — it confirms "does it actually
work and look right" for runtime behavior that unit/endpoint tests can't reach
(e.g. a downloaded bundle's inline day-switcher). It is **not** a regression net;
for lasting coverage add a jsdom or e2e test as a separate step.

## When to run it

On any change that adds or alters user-facing UX: a new affordance, view,
interaction, or a generated artifact (export/print/offline bundle). Drive it from
the feature's **Manual QA pass** checklist (see the spec convention below).

## One-time setup

The Playwright MCP is registered at **user scope** so it's available from any
launch directory. It uses the bundled Chromium and writes artifacts outside the
repo:

```bash
claude mcp add playwright -s user -- \
  npx @playwright/mcp@latest --headless --browser chromium --output-dir /tmp/playwright-mcp
npx playwright install            # bundled Chromium, if not already present
```

MCP servers connect at session **startup** — after registering (or changing) it,
restart Claude so the tools load.

## The flow

1. **Seed data** so a planned trip exists to test against:
   ```bash
   npm run seed-sample          # materializes Galena (full plan) + others into data/
   ```
2. **Start a dev server on a non-default port.** Port `3456` is the developer's
   own running server — never use it. Pick another port and read the **actually
   bound** port from the output (Vite prints "Port N is in use, trying another
   one…" and may land elsewhere):
   ```bash
   npm run dev -- --port 3470    # then confirm the bound port from the log
   ```
3. **Set a phone viewport** (the app is phone-first): `browser_resize` to
   **390 × 844**.
4. **Drive the checklist** with `browser_navigate` / `browser_snapshot` /
   `browser_click`, capturing `browser_take_screenshot` for the visual record.
   Prefer the accessibility snapshot over screenshots for finding/asserting
   elements.
5. **Report** what was verified and surface any screenshot that's worth seeing.

### Testing a downloaded / exported artifact

The MCP browser blocks the `file://` protocol, so you can't open a saved file
directly. Serve it over plain HTTP from a throwaway server and navigate to that
URL (a self-contained artifact renders identically from any origin):

```bash
curl -sS http://localhost:3470/trips/<slug>/today/offline -o /tmp/bundle.html
( cd /tmp && python3 -m http.server 3471 ) &
# then browser_navigate to http://localhost:3471/bundle.html
```

A static server's own `/favicon.ico` 404 is expected noise — it is not emitted
by the artifact.

### Cleanup

Stop any dev/static servers you started (kill by port with `lsof -ti tcp:<port>`),
and remove temp files. MCP artifacts go to `/tmp/playwright-mcp` (and
`.playwright-mcp/` is gitignored as a backstop), so they won't pollute the tree.
Leave the developer's `:3456` server untouched.

## Gotcha: `svelte-check` reports "0 files" in a git worktree

When verifying changes from a `.claude/worktrees/*` worktree, the default
`npm run check` (and therefore `npm run verify`) can report
`COMPLETED 0 FILES 0 ERRORS 0 WARNINGS` and pass **vacuously** — svelte-check's
project-root discovery breaks in a linked worktree (where `.git` is a file), so
it checks nothing. This masks real Svelte warnings that CI (`--fail-on-warnings`)
will catch. (This bit PR #474: three `state_referenced_locally` warnings passed
locally but failed CI.)

To actually check files from a worktree:

```bash
npx svelte-kit sync
npx svelte-check --fail-on-warnings --tsconfig ./.svelte-kit/tsconfig.json
```

Confirm the run reports a real file count (e.g. `257 FILES`), not `0 FILES`. That
explicit invocation also prints spurious `@types/node` errors ("Cannot find name
'Buffer'/'http'") — an artifact of bypassing svelte-check's default node-types
setup, **not** real failures; focus on warnings/errors under `src/**`. The
authoritative result is CI's plain `npm run check` from a normal checkout.

## Spec convention: a "Manual QA pass" checklist

Every UX-bearing spec ends with a **Manual QA pass** section: the concrete
click-list a reviewer (or an async agent) executes — affordances to find,
interactions to exercise, edge cases, and the standalone/exported case. This
makes the manual pass deterministic instead of improvised, and lets anyone run
the same pass. See `docs/superpowers/specs/2026-06-07-offline-support-design.md`
for a worked example.

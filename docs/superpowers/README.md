# Superpowers — design history

This subtree is **history, not documentation**. The files here are how
features got designed, debated, and (mostly) shipped. They're useful when
you want to understand *why* something works the way it does — not as a
guide to *how* it currently works.

**Treat the code as the source of truth.** Implementations drift; specs
don't get retroactively rewritten when something changes. If a doc here
disagrees with what's in `src/`, the code wins.

For current-state guidance, start here instead:

- [`CLAUDE.md`](../../CLAUDE.md) — repo conventions, lifecycle, frontmatter
  schema, in-browser actions, conventions.
- [`AGENTS.md`](../../AGENTS.md) — async-agent handoff conventions, the
  non-obvious patterns and constraints worth knowing.
- [`docs/deploy.md`](../deploy.md), [`docs/product.md`](../product.md),
  [`docs/ai-workflow-ux.md`](../ai-workflow-ux.md) — operational and
  product-level documentation that *is* kept current.

## What lives here

- `plans/` — step-by-step implementation plans. Each one corresponds to a
  shipped (or in-flight) ticket and was used to drive the actual work.
  Once the work ships, the plan is frozen.
- `specs/` — design specs for active proposals, not yet merged or still
  in progress. Specs graduate to `specs/archive/` once their work ships.
- `specs/archive/` — design specs whose work has shipped (or been
  superseded). See its own README for the same source-of-truth caveat.

## Reading dates

The `YYYY-MM-DD-` prefix on filenames is the **authoring date** — when
the spec or plan was written, not when the work shipped. Use `git log` on
a file to find the PR(s) that landed (or didn't land) it.

## Adding new specs / plans

New designs go in `specs/`; new implementation plans go in `plans/`. Use
the same kebab-case + date-prefix naming. When a spec's work ships, move
it to `specs/archive/`. Plans don't get archived — they stay in `plans/`
forever as the historical record of how the work got done.

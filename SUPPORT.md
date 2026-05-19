# Getting help with Traverse

Traverse is maintained as a personal project that ships as open source. This page sets honest expectations for what help you can expect, and what's out of scope.

## Before opening an issue

1. **Check the docs.** Most setup confusion is covered in the [README](README.md), [DEPLOY.md](DEPLOY.md), and [CONTRIBUTING.md](CONTRIBUTING.md). The startup banner reports which providers/features are wired; the `/settings` page shows live config.
2. **Search existing issues.** The tracker is the source of truth for known limitations and in-flight work.
3. **For security concerns**, follow [SECURITY.md](SECURITY.md) — use private advisories, not public issues.

## What to expect

- **Best effort, no SLA.** Most issues get a first response within a couple of weeks. Self-hosting reports that need careful repro may take longer.
- **Bugs that affect the daily-use path** (the supported provider configs in DEPLOY.md, the documented Docker deployment, the canonical lifecycle) get priority.
- **Reports with clear repro steps + `.env` provider context** (no keys) get answered faster than vague ones. The PR template's "Approach / What changed / How verified" structure is also a good template for bug reports.

## What gets fixed

- Security issues — see SECURITY.md.
- Bugs in any supported provider configuration documented in DEPLOY.md.
- Setup friction (unclear docs, missing env var coverage, surprising defaults).
- Accessibility regressions on supported browsers.
- Things broken by your environment that an adapter or doc tweak can absorb.

## What's likely `wontfix`

The README's [Status section](README.md#status) names the design center: single-user, self-hosted, markdown-on-disk, LLM-as-assistant. Asks that compromise that center are generally out of scope. Specifically:

- **Hosted / multi-tenant features** — auth systems, admin dashboards, billing, organization accounts.
- **Removing the single-user assumption** — concurrent multi-author editing, presence, per-trip ACLs.
- **"Work without an LLM"** — the AI workflows are central; a key-less mode isn't planned.
- **Schema overhauls** — the markdown + `home.md` contract is load-bearing. Additive frontmatter fields are fine; renames or restructurings need a clear win.
- **"Make it work with $PROVIDER" without a PR** — the adapter seam under `src/lib/server/ai/` is documented (see [CONTRIBUTING.md](CONTRIBUTING.md#areas-that-welcome-contribution)). A PR adding an adapter is the path; bare requests get lower priority.
- **Features outside road-trip planning** — flights, package vacations, hotel booking integrations, etc.

The framing for borderline asks: *does this make Traverse better as a personal road-trip filing cabinet, or is it nudging the tool to be something else?*

## How issues are triaged

Issues get one or more of these labels:

- `bug` — code defect with a concrete repro
- `documentation` — doc bug or improvement
- `enhancement` — small in-scope improvement
- `question` — usage clarification
- `help wanted` — open to PR but not on the maintainer's queue
- `good first issue` — pickup-friendly for newcomers
- `design` — exploration that needs collaborative work with a human in the loop, not safe for autonomous implementation (see [AGENTS.md](AGENTS.md#tickets-to-skip))
- `wontfix` — out of design scope; closed with a brief rationale

Issues older than 90 days with no activity may be closed as stale. Reopen with new context if it still applies.

## Saying thanks vs. opening an issue

Bug reports and PR contributions are the most useful form of feedback. If you'd like to share that you use Traverse, a star on the repo helps the project surface; no issue needed for that.

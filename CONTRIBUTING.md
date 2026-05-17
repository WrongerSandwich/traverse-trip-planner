# Contributing to Traverse

Traverse is a personal road-trip filing cabinet that's also designed to be self-hosted by anyone who wants to manage their own trips through markdown + an LLM. Contributions are welcome. Please read our [Code of Conduct](CODE_OF_CONDUCT.md) before participating.

## Quick start for development

```bash
git clone <your-fork>
cd traverse
cp home.example.md home.md       # edit with your home city, vehicles, taste
cp .env.example .env             # add at minimum ANTHROPIC_API_KEY (or OPENAI_API_KEY) + PEXELS_API_KEY
npm install
npm run seed-sample              # optional: load the bundled demo dataset (see sample-data/)
npm run smoke                    # 1-token round-trip per provider — verifies your env
npm run dev                      # http://localhost:3456
```

Trip data (`ideas/`, `planning/`, `completed/`, `archived/`) is gitignored — those directories hold your own trips, not project source. Use `npm run seed-sample` if you want a populated UI to develop against.

Prefer Docker for a prod-style local run? `docker compose up -d --build` works the same way as on a server (see [DEPLOY.md](DEPLOY.md#option-b--docker)). The inner dev loop is still `npm run dev` — Vite HMR is not containerized.

## Before opening a PR

```bash
npm run verify    # svelte-check (--fail-on-warnings) + tests + build
```

CI runs the same command on every PR. It must pass before merge.

The verify pipeline is zero-tolerance on Svelte-side warnings (a11y, unused CSS, runes misuse). If your change adds a warning, fix it or suppress it explicitly with a rationale comment — don't ship noise that future readers can't distinguish from their own.

If you've changed AI/search abstraction code (`src/lib/server/{ai,search}/` or any `chat()` call site), also run `npm run smoke` against your env to confirm a real round-trip still works.

## Working from a GitHub issue

If you're picking up an existing issue — particularly as an async agent in a cloud session — read **[AGENTS.md](AGENTS.md)** first. It covers the verification command, repo shape, conventions, definition-of-done, and which tickets to skip.

Two conventions worth knowing up front:

- **Issue template.** New tickets use `.github/ISSUE_TEMPLATE/feature.yml` (YAML form) and have fields for goal, problem, deliverables, files likely touched, success criteria, and out-of-scope. If you're filing an issue, fleshing those out makes the ticket pickup-ready.
- **`design` label.** Issues tagged `design` are exploration tickets meant for collaborative work with a human in the loop — not safe for autonomous implementation. The deliverable is usually a written design doc and a set of follow-up tickets.

## Code conventions

See [CLAUDE.md](CLAUDE.md) for the full set, but the highlights:

- **All AI calls go through `chat()` in `src/lib/server/ai.js`.** Don't `import Anthropic` (or any other SDK) in route handlers — add a new adapter under `src/lib/server/ai/` instead. Pass a `label` for token-usage attribution.
- **All search goes through `search()` / `searchToolDefinition()` in `src/lib/server/search.js`.** Same pattern for backends.
- **No new test infrastructure for one-off changes.** Add tests when changing the abstraction layer (`src/lib/server/`); leaf UI tweaks don't need them.
- **Don't remove frontmatter fields** during trip-stage promotion; only add or refine.
- **Distance, vehicle, taste logic** lives in `home.md` — never hardcode user-specific values.

## Filing issues

- **Bugs:** open a GitHub issue with reproduction steps and your `.env` provider config (without the keys themselves — see SECURITY.md).
- **Feature ideas:** check the [open issues](https://github.com/WrongerSandwich/traverse/issues) first; many ideas are already captured there with implementation context. If yours isn't, open a discussion or issue and link it to where it'd land.

## Areas that welcome contribution

- Additional model adapters (Google Gemini, Mistral, local Ollama). The seam is in place — see `src/lib/server/ai/anthropic.js` and `openai.js` for the pattern.
- Additional search backends (Serper, Brave, Exa). Same seam in `src/lib/server/search/`.
- Anything on the [open issues](https://github.com/WrongerSandwich/traverse/issues) list — most have file pointers in the body.
- Open-source ergonomics: better error messages, clearer setup docs, missing-key UX.

## Things to discuss before building

- Schema changes (frontmatter, folder layout): coordinate first to avoid breaking other in-flight work.
- New AI features that materially change the cost profile (large multimodal calls, large context windows).
- Anything that adds runtime dependencies — keep the dep tree small for self-hosters.

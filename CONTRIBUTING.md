# Contributing to Traverse

Traverse is a personal road-trip filing cabinet that's also designed to be self-hosted by anyone who wants to manage their own trips through markdown + an LLM. Contributions are welcome.

## Quick start for development

```bash
git clone <your-fork>
cd traverse
cp home.example.md home.md       # edit with your home city, vehicles, taste
cp .env.example .env             # add at minimum ANTHROPIC_API_KEY (or OPENAI_API_KEY) + PEXELS_API_KEY
npm install
npm run smoke                    # 1-token round-trip per provider — verifies your env
npm run dev                      # http://localhost:3456
```

## Before opening a PR

```bash
npm test          # unit tests (~500ms, no API keys needed)
npm run build     # full SvelteKit build
```

CI runs both on every PR. Both must pass before merge.

If you've changed AI/search abstraction code (`src/lib/server/{ai,search}/`), also run `npm run smoke` against your env to confirm a real round-trip still works.

## Code conventions

See [CLAUDE.md](CLAUDE.md) for the full set, but the highlights:

- **All AI calls go through `chat()` in `src/lib/server/ai.js`.** Don't `import Anthropic` (or any other SDK) in route handlers — add a new adapter under `src/lib/server/ai/` instead. Pass a `label` for token-usage attribution.
- **All search goes through `search()` / `searchToolDefinition()` in `src/lib/server/search.js`.** Same pattern for backends.
- **No new test infrastructure for one-off changes.** Add tests when changing the abstraction layer (`src/lib/server/`); leaf UI tweaks don't need them.
- **Don't remove frontmatter fields** during trip-stage promotion; only add or refine.
- **Distance, vehicle, taste logic** lives in `home.md` — never hardcode user-specific values.

## Filing issues

- **Bugs:** open a GitHub issue with reproduction steps and your `.env` provider config (without the keys themselves — see SECURITY.md).
- **Feature ideas:** check [TODO.md](TODO.md) first; many ideas are already captured there with implementation context. If yours isn't, open a discussion or issue and link it to where it'd land.

## Areas that welcome contribution

- Additional model adapters (Google Gemini, Mistral, local Ollama). The seam is in place — see `src/lib/server/ai/anthropic.js` and `openai.js` for the pattern.
- Additional search backends (Serper, Brave, Exa). Same seam in `src/lib/server/search/`.
- Items in `TODO.md` — they're roughly prioritized and have file pointers.
- Open-source ergonomics: better error messages, clearer setup docs, missing-key UX.

## Things to discuss before building

- Schema changes (frontmatter, folder layout): coordinate first to avoid breaking other in-flight work.
- New AI features that materially change the cost profile (large multimodal calls, large context windows).
- Anything that adds runtime dependencies — keep the dep tree small for self-hosters.

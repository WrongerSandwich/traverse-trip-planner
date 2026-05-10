# Traverse — deferred follow-ups

Smaller pain points and ideas that surfaced during work but weren't worth blocking on. Each one has enough context to pick up without rediscovering it.

## Architecture

- **Service worker / offline support** would be valuable for a travel tool used in the field. Cache trip markdown + Pexels thumbnails + map tiles for offline read. Substantial effort.

## Provider abstraction follow-ups

- **Validate the OpenAI adapter against a real key.** The seam is wired and unit-tested for error paths, but no token has actually crossed `ai/openai.js` yet. Set `TRAVERSE_MODEL_DEFAULT_PROVIDER=openai`, `TRAVERSE_MODEL_DEFAULT=gpt-4o-mini`, `OPENAI_API_KEY=...` and run `npm run smoke`.
- **Validate the normalized-tool path with Tavily.** Anthropic + `anthropic-builtin` is already exercised on every Research → run, but the *normalized* tool translation (used by Tavily on either provider) has only been unit-tested. Sign up for a Tavily key (1k searches/month free), set `TRAVERSE_SEARCH_PROVIDER=tavily TAVILY_API_KEY=...`, and `npm run smoke` runs the tool-loop probe. Required before claiming OpenAI + Tavily works end-to-end.


## Future extension (technically near)

- **Multimodal: receipt photos → notes.md retros.** Both Anthropic and OpenAI support image content in `messages`. A "Add to retro" upload on the completed view could attach photos, run them through `chat()` with image blocks, and append a parsed line (date · merchant · amount · category) to the trip's `notes.md`. Requires extending the adapter `messages` shape to accept `{type: 'image', ...}` content blocks. — `src/lib/server/ai/`, `src/routes/trips/[slug]/+page.svelte`

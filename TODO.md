# Atlas — deferred follow-ups

Smaller pain points and ideas that surfaced during work but weren't worth blocking on. Each one has enough context to pick up without rediscovering it.

## UX — mobile

- **DetailPanel hero title wraps awkwardly on narrow screens.** The 1.45 rem `h2` overlaid on a 180px-tall hero can wrap to 3 lines for longer titles like "Atchison Missouri River Town", crowding the destination/mode chips. Consider a smaller mobile font size or a 2-line clamp with ellipsis. — `src/lib/components/DetailPanel.svelte`
- **Mobile map eats 45vh.** When browsing cards on mobile, almost half the viewport is map. Could be ~30vh by default with a "make bigger" pull tab, or auto-shrink on scroll. — `--map-h-mobile` in `src/app.css`
- **`✨` emoji on the "Ask Claude" FAB renders inconsistently** across platforms (Apple coloured, Android monochrome). Swap for an inline SVG icon. — `src/routes/trips/[slug]/+page.svelte`

## UX — general

- **Cost range format `~$700–1,050` may read as cryptic.** Consider switching to "$700 to $1,050" or just a single midpoint figure with a small range badge.
- **No keyboard arrow-key navigation between cards.** Cards are `role="button"`, but moving between them requires `Tab`. Adding ↑/↓ navigation would help keyboard users.

## Architecture

- **Service worker / offline support** would be valuable for a travel tool used in the field. Cache trip markdown + Pexels thumbnails + map tiles for offline read. Substantial effort.
- **Settle slash-command vs browser-action drift.** `.claude/commands/seed.md` + `deepen.md` and `src/routes/api/actions/{seed,deepen}` implement equivalent flows separately — different prompts, different parsing. Either delete the slash commands (browser is canonical) or have both read prompts from a shared location. Currently flagged as "drift consciously" in CLAUDE.md, which decays without enforcement. — `.claude/commands/`, `src/routes/api/actions/`

## Provider abstraction follow-ups

- **Validate the OpenAI adapter against a real key.** The seam is wired and unit-tested for error paths, but no token has actually crossed `ai/openai.js` yet. Set `ATLAS_MODEL_DEFAULT_PROVIDER=openai`, `ATLAS_MODEL_DEFAULT=gpt-4o-mini`, `OPENAI_API_KEY=...` and run `npm run smoke`.
- **Validate the normalized-tool path with Tavily.** Anthropic + `anthropic-builtin` is already exercised on every `/deepen`, but the *normalized* tool translation (used by Tavily on either provider) has only been unit-tested. Sign up for a Tavily key (1k searches/month free), set `ATLAS_SEARCH_PROVIDER=tavily TAVILY_API_KEY=...`, and `npm run smoke` runs the tool-loop probe. Required before claiming OpenAI + Tavily works end-to-end.


## Future extension (technically near)

- **Multimodal: receipt photos → notes.md retros.** Both Anthropic and OpenAI support image content in `messages`. A "Add to retro" upload on the completed view could attach photos, run them through `chat()` with image blocks, and append a parsed line (date · merchant · amount · category) to the trip's `notes.md`. Requires extending the adapter `messages` shape to accept `{type: 'image', ...}` content blocks. — `src/lib/server/ai/`, `src/routes/trips/[slug]/+page.svelte`
- **Public read-only share URLs.** A `/share/[token]` route renders a single trip without chrome (or with a "Atlas — view-only" frame), suitable for sending plans to non-Atlas-using travel companions. Token = HMAC of slug + a secret stored as `ATLAS_SHARE_SECRET`; persisted in trip frontmatter as `share_token: ...` so it survives across deployments. — new route, frontmatter schema extension

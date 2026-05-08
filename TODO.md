# Atlas — deferred follow-ups

Smaller pain points and ideas that surfaced during work but weren't worth blocking on. Each one has enough context to pick up without rediscovering it.

## UX — mobile

- **DetailPanel hero title wraps awkwardly on narrow screens.** The 1.45 rem `h2` overlaid on a 180px-tall hero can wrap to 3 lines for longer titles like "Atchison Missouri River Town", crowding the destination/mode chips. Consider a smaller mobile font size or a 2-line clamp with ellipsis. — `src/lib/components/DetailPanel.svelte`
- **Mobile map eats 45vh.** When browsing cards on mobile, almost half the viewport is map. Could be ~30vh by default with a "make bigger" pull tab, or auto-shrink on scroll. — `--map-h-mobile` in `src/app.css`
- **`✨` emoji on the "Ask Claude" FAB renders inconsistently** across platforms (Apple coloured, Android monochrome). Swap for an inline SVG icon. — `src/routes/trips/[slug]/+page.svelte`

## UX — general

- **Pexels images aren't responsive.** `loading="lazy"` is set, but the same `medium` URL is shipped to mobile and desktop (different physical sizes). Use `srcset` to send the smaller variant on phones. — `src/lib/components/TripCard.svelte`
- **Cost range format `~$700–1,050` may read as cryptic.** Consider switching to "$700 to $1,050" or just a single midpoint figure with a small range badge.
- **No keyboard arrow-key navigation between cards.** Cards are `role="button"`, but moving between them requires `Tab`. Adding ↑/↓ navigation would help keyboard users.
- **Stream lock-itinerary generation.** "🔒 Lock trip & generate itinerary" sits silent for 20–30s while the model works. Both adapters can be extended to support streaming; for lock specifically, pipe tokens through SSE so the user sees the itinerary materializing in real time. — `src/routes/api/lock/[slug]/+server.js`, both `src/lib/server/ai/*.js`
- **Cancel button for long-running /deepen.** Once started, deepen runs to completion (15–90s + tokens). For misclicks or runaway research, an abort button + `AbortController` on the fetch would help. SSE channel can stream the cancellation acknowledgement. — `src/routes/+page.svelte`, `src/routes/api/actions/deepen/[slug]/+server.js`
- **Surface token usage for lock + planning chat.** SSE actions (seed/add/deepen) now stream a `Used N in / N out · T turns` line, but lock and planning chat return plain JSON and have no equivalent. Either return `usage` in the JSON response and render it in a toast/status row, or migrate those endpoints to SSE. — `src/routes/api/lock/[slug]/+server.js`, `src/routes/api/trip/[slug]/chat/+server.js`, `src/routes/trips/[slug]/+page.svelte`

## Performance

- **Memoize `enrichTrips()` for ~30s.** Currently re-runs on every page load even when the result is identical (all caches hit). For a self-hosted personal tool it's <50ms — only worth doing if traffic ever scales.
- **Batch cache writes inside `enrichTrips()`.** `saveGeocodeCache()` / `saveImageCache()` fire after every successful fetch (35+ `writeFileSync` calls during cold start). Buffer in memory and write once at the end.

## Architecture

- **Service worker / offline support** would be valuable for a travel tool used in the field. Cache trip markdown + Pexels thumbnails + map tiles for offline read. Substantial effort.
- **Settle slash-command vs browser-action drift.** `.claude/commands/seed.md` + `deepen.md` and `src/routes/api/actions/{seed,deepen}` implement equivalent flows separately — different prompts, different parsing. Either delete the slash commands (browser is canonical) or have both read prompts from a shared location. Currently flagged as "drift consciously" in CLAUDE.md, which decays without enforcement. — `.claude/commands/`, `src/routes/api/actions/`

## Provider abstraction follow-ups

- **Validate the OpenAI adapter against a real key.** The seam is wired and unit-tested for error paths, but no token has actually crossed `ai/openai.js` yet. Set `ATLAS_MODEL_DEFAULT_PROVIDER=openai`, `ATLAS_MODEL_DEFAULT=gpt-4o-mini`, `OPENAI_API_KEY=...` and run `npm run smoke`.
- **Validate the normalized-tool path with Tavily.** Anthropic + `anthropic-builtin` is already exercised on every `/deepen`, but the *normalized* tool translation (used by Tavily on either provider) has only been unit-tested. Sign up for a Tavily key (1k searches/month free), set `ATLAS_SEARCH_PROVIDER=tavily TAVILY_API_KEY=...`, and `npm run smoke` runs the tool-loop probe. Required before claiming OpenAI + Tavily works end-to-end.

## Robustness

- **Sanitize provider error messages.** `ai/openai.js` includes the verbatim response body in thrown errors (`OpenAI API 400: ...`). For the hosted path that could leak system-prompt fragments to end users. Wrap raw errors in a normalized shape with a public-safe message and the raw payload only on a server-only field. — `src/lib/server/ai/openai.js`, `src/lib/server/ai/anthropic.js`
- **TTL on Pexels image cache.** `.image-cache.json` entries are written once and never expire — only a slug rename triggers recomputation. Pexels CDN URLs can rot silently. Add e.g. 30-day per-entry expiry with refresh on miss. — `src/lib/server/data.js`

## Future extension (technically near)

- **ICS calendar export for planned trips.** `target_date` is already in planning frontmatter. A `/api/cal.ics` endpoint that emits one VEVENT per planning-stage trip with a date would feed Google/Apple/Outlook calendars without further work. Per-trip `/api/cal/[slug].ics` is also small. — new route under `src/routes/api/cal/`
- **Multimodal: receipt photos → notes.md retros.** Both Anthropic and OpenAI support image content in `messages`. A "Add to retro" upload on the completed view could attach photos, run them through `chat()` with image blocks, and append a parsed line (date · merchant · amount · category) to the trip's `notes.md`. Requires extending the adapter `messages` shape to accept `{type: 'image', ...}` content blocks. — `src/lib/server/ai/`, `src/routes/trips/[slug]/+page.svelte`
- **Public read-only share URLs.** A `/share/[token]` route renders a single trip without chrome (or with a "Atlas — view-only" frame), suitable for sending plans to non-Atlas-using travel companions. Token = HMAC of slug + a secret stored as `ATLAS_SHARE_SECRET`; persisted in trip frontmatter as `share_token: ...` so it survives across deployments. — new route, frontmatter schema extension

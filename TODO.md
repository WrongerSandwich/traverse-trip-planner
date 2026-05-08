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

## Performance

- **Memoize `enrichTrips()` for ~30s.** Currently re-runs on every page load even when the result is identical (all caches hit). For a self-hosted personal tool it's <50ms — only worth doing if traffic ever scales.
- **Batch cache writes inside `enrichTrips()`.** `saveGeocodeCache()` / `saveImageCache()` fire after every successful fetch (35+ `writeFileSync` calls during cold start). Buffer in memory and write once at the end.

## Architecture

- **Service worker / offline support** would be valuable for a travel tool used in the field. Cache trip markdown + Pexels thumbnails + map tiles for offline read. Substantial effort.

## Provider abstraction follow-ups

- **Validate the OpenAI adapter against a real key.** The seam is wired and unit-tested for error paths, but no token has actually crossed `ai/openai.js` yet. Set `ATLAS_MODEL_DEFAULT_PROVIDER=openai`, `ATLAS_MODEL_DEFAULT=gpt-4o-mini`, `OPENAI_API_KEY=...` and run `npm run smoke`.
- **Validate the normalized-tool path with Tavily.** Anthropic + `anthropic-builtin` is already exercised on every `/deepen`, but the *normalized* tool translation (used by Tavily on either provider) has only been unit-tested. Sign up for a Tavily key (1k searches/month free), set `ATLAS_SEARCH_PROVIDER=tavily TAVILY_API_KEY=...`, and `npm run smoke` runs the tool-loop probe. Required before claiming OpenAI + Tavily works end-to-end.

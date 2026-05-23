# Trip-stage visual clarity

GitHub issue: [#191 — Improve visual clarity of different trip stages](https://github.com/WrongerSandwich/traverse/issues/191)

## Problem

The three lifecycle stages (`idea`, `planning`, `completed`) share dark, similar-luminance hues that are hard to tell apart in two places:

- **Map markers (`OverviewMap.svelte`)** — current colors are sky-600 `#3D5A6E`, forest-800 `#1F4332`, bark-600 `#5C4031`. All three sit at ~30% luminance; planning's forest green blends into OSM terrain tiles, and bark brown overlaps the OSM land-tile beige.
- **Card status badge (`TripCard.svelte`)** — uniform `rgba(31, 25, 14, 0.72)` backdrop for every stage. Only the text changes, so the reader has to literally read the word to know which stage a card is in.

The single source of truth for stage color is `src/lib/utils/colors.js`. `tripColor()` is consumed by `TripCard`, `MiniMap`, `OverviewMap`, `DetailPanel`, and the trip detail page.

## Solution (Option B from brainstorm)

Recolor for hue distinctness, then add a second visual channel on the card badge (color stripe) and on hovered map markers (outer color halo) so the stage signal is unmistakable without requiring the reader to parse the badge text.

### 1. Recolor `STATUS_COLOR`

`src/lib/utils/colors.js`:

```js
export const STATUS_COLOR = {
  idea:      '#5B7E92', // sky-400 — cool, sketchy, far-off possibility
  planning:  '#D87B3F', // sunset-600 — warm, active, in-flight
  completed: '#1F4332', // forest-800 — deep, rooted, settled
};
```

Hue spread: 210° / 25° / 150° — maximally distinct on a color wheel. Luminance spread: 50% / 56% / 19% — also distinct, so the mapping survives grayscale rendering and color-vision deficiency.

**Note on the route-line conflict.** Active-route lines are hardcoded to sunset-600 in `OverviewMap.svelte:233`. After recolor, hovering a planning trip means both the marker and the route line are sunset-orange. This reads as reinforcement ("this *is* the active route for the trip you're planning"), not conflict — marker and line are distinct shapes (filled circle vs 3px line). No code change to the route-line color.

### 2. Card badge: color stripe (`TripCard.svelte`)

Keep the dark translucent backdrop and cream text (preserves AA contrast at 0.58rem). Add a 3px stage-color left stripe driven by a CSS custom property:

```svelte
<span class="badge" style="--stage-color: {color}">{status}</span>
```

```css
.badge {
  /* existing styles preserved */
  border-left: 3px solid var(--stage-color);
  padding-left: 0.4rem;  /* down from 0.5rem to compensate for stripe width */
}
```

`color` is already in scope (`const color = $derived(tripColor(trip))` at line 12).

### 3. Map marker: outer color halo on hover (`OverviewMap.svelte`)

`makeIcon` already grows the hovered marker 12→20px and adds a 3px white halo. Add a 2px stage-color halo *outside* the white one, so the color reads even at distance:

```js
const shadow = hovered
  ? `0 0 0 3px rgba(255,255,255,0.85), 0 0 0 5px ${color}66, 0 2px 10px rgba(0,0,0,0.45)`
  : '0 1px 4px rgba(0,0,0,.4)';
```

`66` hex = 40% alpha — visible but not loud. Resting markers don't need it; the recolored fill alone is now clearly distinct against OSM.

## Files touched

| File | Change |
|---|---|
| `src/lib/utils/colors.js` | Update three hex values + tracking comment |
| `src/lib/components/TripCard.svelte` | Badge gets `--stage-color` CSS variable + `border-left` stripe |
| `src/lib/components/OverviewMap.svelte` | `makeIcon` hovered-state shadow string adds outer color ring |

Consumers that already use `tripColor()` (`MiniMap`, `DetailPanel`, `+page.svelte` detail) inherit the new colors automatically. No data migration, no token churn, no shared component refactor.

## Out of scope

- Adding icons or shape variation to markers (Option C) — not pursued; clarity from recolor + stripe is sufficient at current sizes.
- Recoloring the photo-overlay badge backdrop fill — text-on-dark is the established pattern across photo overlays; changing the fill risks contrast regressions on bright photos.
- Active-route line color — stays sunset-600 per `OverviewMap.svelte` §7 ("a single accent signaling 'this is the route under inspection'").

## Test plan

- Visual: load `/`, confirm three stage hues are distinct on cards (stripe) and on map markers. Hover a planning trip — sunset halo + sunset route line. Hover idea + completed — cool blue / deep green halos.
- `npm run verify` — svelte-check + tests + build green.
- No new automated tests required: existing tests assert behavior, not hex values; one grep confirms no test pins `#3D5A6E`/`#1F4332`/`#5C4031`.

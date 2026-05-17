# Trip-Stage Visual Clarity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the three lifecycle stages (idea, planning, completed) visually distinct on map markers and on card status badges.

**Architecture:** Single source of truth for stage color is `src/lib/utils/colors.js` — change three hex values and downstream consumers (`TripCard`, `OverviewMap`, `MiniMap`, `DetailPanel`, detail page) inherit the new palette. Add two secondary channels: a stage-color left stripe on the card badge, and an outer color halo on hovered map markers.

**Tech Stack:** SvelteKit 2 + Svelte 5 runes, Leaflet for the map, CSS custom properties for theming.

**Spec:** `docs/superpowers/specs/2026-05-17-trip-stage-visual-clarity-design.md`

---

## File map

| File | Responsibility | Change shape |
|---|---|---|
| `src/lib/utils/colors.js` | Source of truth for stage color | 3 hex values + comment |
| `src/lib/components/TripCard.svelte` | Card thumbnail + status badge | Pass `--stage-color` CSS var into badge; add `border-left` stripe |
| `src/lib/components/OverviewMap.svelte` | Home-page Leaflet map | Extend `makeIcon` hovered-state shadow to include outer color halo |

No tests touched: existing tests (`tests/`) do not assert hex literals (verified by grep in Task 0). The verification step is `npm run verify` (svelte-check + tests + build) plus a visual smoke check in the dev server.

---

### Task 0: Verify no test pins the existing hex values

**Files:**
- Inspect: `tests/`

- [ ] **Step 1: Grep for existing stage hexes in tests**

Run:
```bash
grep -rn -E "3D5A6E|1F4332|5C4031" tests/ src/
```

Expected: matches in `src/lib/utils/colors.js` only (the hexes being replaced) and possibly `src/lib/components/OverviewMap.svelte:115` (the home marker uses `#1F4332` inline — that is the *home* base color, not a stage color, and is intentionally **not** changed by this plan). No matches in `tests/`. If a test does pin a stage hex, stop and reconcile with the spec before continuing.

---

### Task 1: Recolor `STATUS_COLOR`

**Files:**
- Modify: `src/lib/utils/colors.js`

- [ ] **Step 1: Replace the three hex values and the tracking comment**

Replace the entire file contents with:

```js
// Map marker / accent color per lifecycle stage. Hexes track the brand
// palette in src/app.css — idea→sky-400, planning→sunset-600, completed→forest-800.
// Chosen for hue + luminance spread so stages remain distinct on OSM tiles
// and under color-vision deficiency. See
// docs/superpowers/specs/2026-05-17-trip-stage-visual-clarity-design.md.
export const STATUS_COLOR = {
  idea:      '#5B7E92', // sky-400 — cool, sketchy, far-off
  planning:  '#D87B3F', // sunset-600 — warm, active, in-flight
  completed: '#1F4332', // forest-800 — deep, rooted, settled
};

/** Returns the marker/accent color for a trip object. */
export function tripColor(trip) {
  return STATUS_COLOR[trip?.status || trip?._stage] || '#9A8A6F';
}
```

- [ ] **Step 2: Verify svelte-check still passes**

Run:
```bash
npm run check
```

Expected: 0 errors, 0 warnings (svelte-check is run with `--fail-on-warnings`).

- [ ] **Step 3: Commit**

```bash
git add src/lib/utils/colors.js
git commit -m "feat(colors): recolor STATUS_COLOR for hue distinctness (#191)"
```

---

### Task 2: Add stage-color stripe to the card badge

**Files:**
- Modify: `src/lib/components/TripCard.svelte`

- [ ] **Step 1: Pass the stage color into all three `<span class="badge">` instances**

The component renders three thumbnails (photo / map / placeholder), each with its own `<span class="badge">{status}</span>`. Update all three to include the inline `style` carrying the CSS custom property.

Replace each occurrence of:
```svelte
<span class="badge">{status}</span>
```
with:
```svelte
<span class="badge" style="--stage-color: {color}">{status}</span>
```

There are exactly three occurrences (at the lines for the photo thumb, the MiniMap thumb, and the placeholder thumb). The `color` variable is already in scope from `const color = $derived(tripColor(trip))` on line 12.

- [ ] **Step 2: Add the border-left stripe to the `.badge` rule**

In the `<style>` block, locate the existing `.badge { ... }` rule. Replace it with:

```css
  .badge {
    position: absolute;
    bottom: 0.6rem;
    left: 0.6rem;
    font-size: 0.58rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    padding: 0.18rem 0.5rem 0.18rem 0.4rem;
    border-radius: 2px;
    border-left: 3px solid var(--stage-color, var(--bone-100));
    background: rgba(31, 25, 14, 0.72);
    color: var(--bone-100);
    backdrop-filter: blur(4px);
  }
```

Changes vs. the existing rule:
- `padding` expanded to per-side so the left padding shrinks 0.5rem → 0.4rem to compensate for the 3px stripe (visual horizontal balance is preserved).
- New `border-left: 3px solid var(--stage-color, var(--bone-100));` — fallback to bone-100 in the unlikely event the CSS variable isn't set (e.g., during HMR).

- [ ] **Step 2: Run svelte-check**

Run:
```bash
npm run check
```

Expected: 0 errors, 0 warnings.

- [ ] **Step 3: Visual smoke check in dev**

Start the dev server (if not already running):
```bash
npm run dev -- --port 3456
```

Open `http://localhost:3456` and confirm:
- An `idea` card's badge has a cool blue (`#5B7E92`) left stripe.
- A `planning` card's badge has a warm orange (`#D87B3F`) left stripe.
- A `completed` card's badge has a deep green (`#1F4332`) left stripe.
- The badge text (`IDEA` / `PLANNING` / `COMPLETED`) remains crisp and readable; horizontal padding looks balanced.

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/TripCard.svelte
git commit -m "feat(card): stage-color left stripe on status badge (#191)"
```

---

### Task 3: Add outer color halo to hovered map markers

**Files:**
- Modify: `src/lib/components/OverviewMap.svelte`

- [ ] **Step 1: Extend the hovered-state shadow string in `makeIcon`**

Locate `makeIcon` at line 87. Replace the existing function with:

```js
  function makeIcon(color, hovered) {
    const size = hovered ? 20 : 12;
    const shadow = hovered
      ? `0 0 0 3px rgba(255,255,255,0.85), 0 0 0 5px ${color}66, 0 2px 10px rgba(0,0,0,0.45)`
      : '0 1px 4px rgba(0,0,0,.4)';
    return L.divIcon({
      className: '',
      html: `<div style="width:${size}px;height:${size}px;background:${color};border:2px solid #fff;border-radius:50%;box-shadow:${shadow};transition:width .15s,height .15s,box-shadow .15s"></div>`,
      iconSize: [size, size], iconAnchor: [size / 2, size / 2],
    });
  }
```

Change vs. existing: the hovered shadow gains a second layer `0 0 0 5px ${color}66` between the white halo and the drop shadow. `66` is hex for 40% alpha — visible but not loud. Resting markers are unchanged (the recolored fills alone are now distinct).

- [ ] **Step 2: Run svelte-check**

Run:
```bash
npm run check
```

Expected: 0 errors, 0 warnings.

- [ ] **Step 3: Visual smoke check on the map**

In the dev server (still on `:3456`), on the home page:
- Hover an idea trip → marker grows, gains a faint cool-blue outer halo around the white halo.
- Hover a planning trip → orange halo. The active route line (sunset-600) appears solid in the same hue — confirm marker and line read as distinct shapes (filled dot vs 3px line), not as a single blob.
- Hover a completed trip → deep-green halo.
- Resting (non-hovered) markers show only the white border + drop shadow as before.

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/OverviewMap.svelte
git commit -m "feat(map): outer stage-color halo on hovered marker (#191)"
```

---

### Task 4: Final verification

- [ ] **Step 1: Run the full verification suite**

Run:
```bash
npm run verify
```

Expected: svelte-check (`--fail-on-warnings`), tests, and build all green. This is the project's standard go/no-go gate (per CLAUDE.md).

- [ ] **Step 2: Visual cross-check on detail page and mini-map**

In the dev server:
- Click any trip card → detail page opens. The detail-map marker uses the new color (it consumes `tripColor()` already; no code change was needed here, this is a sanity check that the inheritance worked).
- On the home page, the small mini-map thumbnails (for trips without photos) — confirm the colored spokes/markers also pick up the new color.

- [ ] **Step 3: Push**

```bash
git push origin main
```

(Repo convention from CLAUDE.md: commit and push after a meaningful unit of work.)

---

## Self-review notes

- **Spec coverage:** Task 1 covers §1 (recolor), Task 2 covers §2 (badge stripe), Task 3 covers §3 (marker halo). Task 0 covers the spec's claim that no test pins hex values. Task 4 covers the spec's test plan.
- **Placeholders:** None — every code change is shown in full.
- **Type consistency:** `--stage-color` CSS variable name is reused consistently across Task 2 step 1 (set) and step 2 (consumed in `.badge`). The `color` JS variable name matches the existing scope (`$derived(tripColor(trip))`).
- **Out-of-scope guardrail:** The home-base marker at `OverviewMap.svelte:115` uses `#1F4332` *inline* (not via `STATUS_COLOR`) — Task 0 documents this so an executor doesn't accidentally "fix" it.

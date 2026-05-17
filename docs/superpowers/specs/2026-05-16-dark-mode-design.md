# Dark mode support

**Date:** 2026-05-16
**Status:** Approved
**Origin ticket:** [#157](https://github.com/WrongerSandwich/traverse/issues/157)

## Problem

The frontend renders in a single warm light theme — bone surfaces, forest text, sunset/sky/bark accents. Users browsing at night, or on systems set to dark mode, get a high-luminance UI that doesn't match the surrounding OS chrome. There's no escape hatch.

The codebase has a head start: `src/app.css` already defines a two-tier color system — a **raw palette** (`--forest-50…900`, `--bone-50…900`, `--sunset`, `--sky`, `--bark`, `--embers-600`) and a **semantic layer** (`--text-primary`, `--surface-page`, `--surface-invert`, …). Components consume both layers — most heavily the raw palette (50–90 references per file in the home and trip-detail routes).

That mixed-layer reality shapes the design: a pure semantic-token override would only repaint a fraction of the UI. Dark mode has to redefine the **raw palette** as well, in a way that preserves each shade's relative role.

## Goals

1. Provide a working dark theme across home, trip-detail, settings, and modals.
2. Honor the user's OS preference by default; let them override per-device.
3. Keep brochures and the print pipeline strictly light — those are the canonical print target.
4. Avoid a flash-of-wrong-theme on initial paint.
5. Land in one PR without a preceding semantic-token refactor.

## Non-goals

- Migrating remaining raw-palette consumers to semantic tokens. Out of scope; tracked separately if ever needed.
- Dark map tiles. Leaflet/Stadia tile layers stay light in v1. Pin colors and overlays haven't been re-vetted against dark basemaps.
- `prefers-contrast` / high-contrast support.
- Per-trip or per-route theme overrides beyond the brochure light-lock.
- A server-persisted preference. Theme is a per-device concern; localStorage is sufficient.

## Approach

**Add a `[data-theme="dark"]` override block to `app.css` that redefines both raw and semantic tokens, plus a small client-side controller that resolves `system | light | dark` and applies `data-theme` on `<html>`.**

### Token architecture

A new `[data-theme="dark"]` block immediately follows `:root` in `src/app.css`. It redefines:

- **Raw palette.** Each family stays semantically itself — forest is still forest, bone is still bone — but the luminance ramp is rebuilt for a dark surface. The `-50/-100` end (the "lights") gets dark, low-saturation values; the `-800/-900` end (the "darks") gets brighter, slightly desaturated values. Code that reads `var(--forest-800)` for a primary button still expresses "deep forest," just inverted in luminance. Code that reads `var(--bone-50)` for a page background still expresses "default surface."
- **Semantic tokens.** `--surface-page` → near-black warm neutral. `--surface-raised`, `--surface-sunken` step accordingly. `--text-primary` → warm off-white. `--surface-invert` flips: it was the dark contrast in light mode; it becomes the light contrast in dark mode.
- **Stage pills.** Keep the same hue mapping (sky/forest/bark) but pulled from the rebuilt palette so contrast remains readable.
- **`--embers-600`** (danger). Stays close to its current value; high-saturation reds work in both modes.

The palette is designed so each shade keeps its **relative role**, not its absolute color. Most component CSS keeps working unchanged.

Concrete dark-mode palette values are decided during implementation and refined during the visual audit; the spec doesn't pin hex values to avoid pre-litigating contrast.

### Theme state

Three states: `system` (default), `light`, `dark`. Stored in `localStorage` under key `traverse-theme`. Applied as `data-theme="light"` or `data-theme="dark"` on `<html>`.

- `system` → resolve at runtime against `matchMedia('(prefers-color-scheme: dark)')`. A change listener flips the attribute when the OS preference changes mid-session.
- `light` / `dark` → applied directly; OS listener is detached.

### Application flow

1. **Bootstrap (`src/app.html`).** A synchronous inline `<script>` in `<head>` reads `localStorage.getItem('traverse-theme')`, resolves `system` against `matchMedia`, sets `document.documentElement.dataset.theme`, and updates `<meta name="theme-color">` to match. Synchronous and pre-paint to avoid FOUC.
2. **Runtime utility (`src/lib/theme.js`).** Exports:
   - `getStoredTheme()` → `'system' | 'light' | 'dark'` (default `'system'`)
   - `getResolvedTheme()` → `'light' | 'dark'` (the effective applied value)
   - `setTheme(value)` → writes localStorage, applies `data-theme`, updates meta, (re)attaches the OS listener if needed
   - `subscribeToResolvedTheme(fn)` → for components that want to react (used at v1 only by the radio group)
3. **Layout (`src/routes/+layout.svelte`).** Imports the utility on mount, registers the OS listener once. Tears down on destroy.

### Toggle UI

In `src/routes/settings/+page.svelte`, add an "Appearance" section above "Feature health":

```
Appearance
─────────────────────────
Theme:  ◉ Match system   ○ Light   ○ Dark
```

Radio group. Change applies instantly via `setTheme` — no save button, no API call. Reflects the current stored value on load.

### Brochure light-lock

Brochures are the canonical print target. They stay light in every theme.

- `src/routes/trips/[slug]/brochure/+page.svelte` and `src/routes/share/[token]/brochure/+page.svelte` set `data-theme="light"` on their top-level container (Svelte template attribute, not a runtime side effect).
- CSS custom-property inheritance means the entire subtree resolves against `:root` (light) values. Print CSS unaffected.
- The setting toggle, when set to "Dark," does not affect brochure rendering.

### Component fixes

The audit identifies a small set of hardcoded literals to address:

| File | Current | Fix |
|---|---|---|
| `src/lib/components/MiniMap.svelte` | `#fff` marker border, `#e8e4de`/`#ddd8d0` map placeholders | New token `--map-tile-bg` (light + dark values); marker border → `var(--surface-page)` |
| `src/routes/+page.svelte` | `rgba(20,20,20,…)` scrim over map area; gradient-to-`--surface-raised` | Verify visually; promote scrim to a new `--scrim-strong` token if it reads broken in dark |
| `src/app.html` | `<meta name="theme-color" content="#1F4332">` | Set dynamically by bootstrap script to forest-800 in light, a deep near-black forest in dark |

Hardcoded `rgba(0,0,0,…)` *shadows* are left as-is — deep shadows under raised surfaces still read correctly in dark mode (the eye reads them as deeper darkness). Image overlays (e.g., `TripCard` scrim over photos, modal backdrops) are also left as-is — they sit over their own backgrounds, not the theme surface.

The rule for future code, captured in CLAUDE.md as a one-line note: any hardcoded `rgba/hsl/#` outside of (a) shadows or (b) overlays-over-photos should be tokenized.

### Maps (deferred)

Leaflet/Stadia tile layers stay light in v1. A follow-up could swap to a dark tile style (e.g., Stadia's `alidade_smooth_dark`) when `data-theme="dark"`, but that requires re-checking pin contrast and may need a separate Stadia configuration. Out of scope here.

## Affected surface

- **Styles:** `src/app.css` (add `[data-theme="dark"]` block, new `--map-tile-bg` token).
- **Bootstrap:** `src/app.html` (inline theme-init script; theme-color meta becomes runtime-set).
- **New file:** `src/lib/theme.js` (utility).
- **Layout:** `src/routes/+layout.svelte` (register OS listener).
- **Settings:** `src/routes/settings/+page.svelte` (Appearance section).
- **Brochure:** `src/routes/trips/[slug]/brochure/+page.svelte`, `src/routes/share/[token]/brochure/+page.svelte` (force `data-theme="light"`).
- **MiniMap:** `src/lib/components/MiniMap.svelte` (tokenize hardcoded colors).
- **Possibly:** `src/routes/+page.svelte` (scrim token, only if audit shows breakage).
- **Tests:** `tests/theme.test.js` (new) covers `getStoredTheme`/`setTheme`/`getResolvedTheme`.
- **Docs:** `CLAUDE.md` gets a one-line conventions note about hardcoded color literals.

## Testing

- **`tests/theme.test.js`** — unit-test the `theme.js` utility. Cover: default value when nothing stored, set-and-read round-trip, `system` resolution against a mocked `matchMedia`, attribute application on `document.documentElement`, meta theme-color update. Use `happy-dom` (already in test setup).
- **Manual visual pass.** Walk home → idea card → research-stream banner → trip detail (planning) → trip detail (completed, with `notes.md`) → brochure → settings, in both light and dark. Capture screenshots for the PR. Re-verify after any token tweaks.
- **`npm run verify`** must pass (svelte-check `--fail-on-warnings`, tests, build).

## Risks and open questions

- **Dark palette legibility.** Forest is a low-luminance hue to start with — the dark-mode `--forest-100` (intended as a "light accent") risks crushing against `--surface-page`. The visual audit catches this; if a shade isn't pulling its weight, we adjust hex during implementation, not in the spec.
- **Inline script CSP.** The bootstrap script is inline. If a stricter Content-Security-Policy is added later, it'll need a nonce. Not blocking today (no CSP set).
- **`prefers-color-scheme` on SSR.** SvelteKit SSR can't know the user's OS preference; the first HTML payload always renders without a `data-theme` attribute. The bootstrap script sets it before paint, so users in `system` mode never see a flash of light theme. Users with an explicit `light` or `dark` choice also get the right theme pre-paint. Acceptable.
- **Storybook / screenshot tooling.** None set up today. If added later, it should iterate over both themes.

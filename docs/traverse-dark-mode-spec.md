# Traverse — Dark Mode Specification

A companion to [`design-spec.md`](design-spec.md), the source-of-truth design system. Read it first; this file extends the same palette into a dark theme.

This document defines a complete dark mode for Traverse. It is not a lightness inversion of the light theme — it is a deliberately re-mapped set of values built on the same brand palette.

---

## 0. Why an off-the-cuff dark mode fails

If a quick dark-mode pass "isn't quite working," it is almost always one or more of these. Read this section first — it explains the reasoning behind every value below.

1. **Inverting lightness instead of re-mapping.** Flipping `#FCFAF5` to `#050505` and `#112619` to `#EEDDCC` produces muddy, wrong colors. Dark mode needs fresh values chosen for a dark context, not arithmetic negatives of the light ones.

2. **Pure black backgrounds.** `#000` is harsh, makes light text smear (halation), and kills the brand's warmth. Dark mode uses a deep warm forest-charcoal, never black.

3. **Pure white text.** `#FFF` on dark vibrates. Body text should be a warm pale ink, slightly toned.

4. **Forgetting that elevation flips.** In light mode, recessed surfaces are darker. In dark mode, *raised* surfaces are *lighter* — elevation is communicated by lightness, not shadow. A card must be lighter than the page, not darker.

5. **Reusing mid-tone colors that vanish.** `forest-800` (the light-mode primary button) is nearly invisible on a dark forest background. State colors like `embers-600` and `sky-600` are too dark to read on a dark surface. Each needs a lighter substitute.

6. **Invisible borders.** Light-mode borders are warm tan on cream. On a dark surface they disappear. Dark mode borders are low-alpha warm-white overlays.

7. **No treatment for illustration.** The paper-map view is a centerpiece. Left untouched, a cream `bone-100` map glares inside a dark UI. It needs its own dark re-skin.

8. **Hardcoded palette classes in components.** If components use `bg-bone-50` and `text-forest-900` directly, every one needs a `dark:` override and the result drifts out of sync. **The fix — and the single most important recommendation in this document — is to drive all mode-dependent color through semantic tokens (CSS custom properties), so components never reference a raw palette color for surface, text, or border.** See section 6.

---

## 1. Concept — "Dusk"

Light mode is the field guide open on a table in daylight: cream paper, forest-green ink, a sunset-orange accent.

Dark mode is the same field guide read at last light. The paper has gone to deep forest shadow, the ink has gone pale and warm, the borders are faint — but the sunset is still the sunset. The accent color does not change. Dusk is not a different brand; it is the same brand later in the day.

This framing drives every decision: warm darks (not black), warm pale ink (not white), and an unchanged sunset accent that now glows against the dark.

---

## 2. Principles

- **Re-map, don't invert.** Every value below is chosen for the dark context.
- **Warm darks.** Surfaces are deep desaturated forest, never neutral black.
- **Warm pale ink.** Primary text is a toned off-white; secondary/tertiary drift to faded sage.
- **Elevation = lightness.** Page is darkest. Cards are lighter. Modals/overlays lighter still. No shadows.
- **The accent holds; states lift.** Sunset-600 is unchanged. Semantic state colors shift to lighter stops so they read on dark.
- **Borders are light, faint, and translucent.** Low-alpha warm-white, so they work on any surface.

---

## 3. Tokens

All values are new dark-mode values. The light-mode column is shown for reference only — those values come from the main spec and do not change.

### Surfaces

Deep warm forest-charcoal. Each step up the elevation ladder is ~4–5% lighter.

| Token | Dark value | Light value (ref) | Use |
| --- | --- | --- | --- |
| `surface-sunken` | `#0E1813` | `bone-200` | Recessed wells, inset inputs — deeper than the page |
| `surface-page` | `#14201A` | `bone-50` | App background, deepest standard surface |
| `surface-raised` | `#1E2C24` | `bone-100` | Cards, list items, the map canvas, the header |
| `surface-overlay` | `#29382F` | `#FCFAF5` | Modals, popovers, dropdowns, the AI assistant card |
| `surface-invert` | `#F6F1E5` | `forest-800` | Light surface inside a dark UI (inverts with mode) |

`surface-overlay` is new relative to the main spec — add it to the light theme as well (`#FCFAF5`, separated from the page by a border).

### Text

Warm pale ink. Primary is a toned off-white; secondary and tertiary fade toward sage, echoing the green ink of light mode.

| Token | Dark value | Light value (ref) | Notes |
| --- | --- | --- | --- |
| `text-primary` | `#F1ECDF` | `forest-900` | Warm off-white. Not pure white. |
| `text-secondary` | `#B4C2B3` | `forest-600` | Faded sage — labels, meta, secondary copy |
| `text-tertiary` | `#7C8A7B` | `bone-600` | Muted sage-gray — hints, disabled, captions |
| `text-inverse` | `#15211B` | `bone-50` | Dark text for use on light elements (e.g. the primary button) |

### Borders

Light mode borders are warm tan solids. Dark mode borders are low-alpha warm-white overlays so they read correctly on any surface. Solid hex equivalents are given for implementers who prefer them.

| Token | Dark (alpha) | Dark (solid alt) | Light value (ref) |
| --- | --- | --- | --- |
| `border-subtle` | `rgba(241,236,223,0.10)` | `#2A3830` | `#DCD2BC` |
| `border-default` | `rgba(241,236,223,0.16)` | `#374A3F` | `#C9B695` |
| `border-strong` | `rgba(241,236,223,0.30)` | `#4D6155` | `#9A8A6F` |

These three border tokens are also new relative to the main spec (which used ad hoc `bone-400/50`). Formalize them in both themes.

### State colors

Mid-dark state colors from the main spec vanish on dark surfaces. Dark mode uses lighter stops for foreground (text/icon) and dark tints for filled banners.

| Token | Dark foreground | Dark surface tint | Light foreground (ref) |
| --- | --- | --- | --- |
| `state-success` | `#95B8A2` (forest-200) | `#1B3327` | `forest-600` |
| `state-danger` | `#D9694F` (embers-400) | `#3A1C16` | `embers-600` |
| `state-info` | `#95ABBA` (sky-200) | `#1E2E39` | `sky-600` |
| `state-warning` | `#E0884F` (sunset-400) | `#3A2A18` | `sunset-400` |

Pattern: use the foreground value for state text and icons; use the surface-tint value as a banner/badge background with the foreground value as its text.

### Accent

The sunset accent **does not change** — this is the core of the "Dusk" concept.

| Token | Dark value | Light value (ref) | Use |
| --- | --- | --- | --- |
| `accent` | `#D87B3F` (sunset-600) | `#D87B3F` | Route lines, fills, focus rings, the logo sun |
| `accent-text` | `#E0884F` (sunset-400) | `#8D4C24` (sunset-800) | Accent-colored text and links — lighter stop on dark for legibility |

`sunset-600` on the dark surfaces hits ~7:1 contrast — fine for UI, large text, and lines. For small accent text use `accent-text` (`sunset-400`).

### Extended Embers ramp

The main spec defined only `embers-600`. Dark mode needs lighter and darker stops. Add the full ramp to the palette:

| Stop | Hex |
| --- | --- |
| 50 | `#FBEAE7` |
| 200 | `#ECA897` |
| 400 | `#D9694F` |
| 600 | `#A82F1F` |
| 800 | `#6E1F13` |

---

## 4. CSS custom properties

Wire both themes through the same semantic variable names. Components reference the variables; switching `.dark` on `<html>` swaps every value at once.

```css
:root {
  /* --- Surfaces --- */
  --surface-page:    #FCFAF5;
  --surface-raised:  #F6F1E5;
  --surface-sunken:  #EBE0C9;
  --surface-overlay: #FCFAF5;
  --surface-invert:  #1F4332;

  /* --- Text --- */
  --text-primary:   #112619;
  --text-secondary: #2D5840;
  --text-tertiary:  #9A8A6F;
  --text-inverse:   #FCFAF5;

  /* --- Borders --- */
  --border-subtle:  #DCD2BC;
  --border-default: #C9B695;
  --border-strong:  #9A8A6F;

  /* --- State (foreground) --- */
  --state-success: #2D5840;
  --state-danger:  #A82F1F;
  --state-info:    #3D5A6E;
  --state-warning: #E0884F;

  /* --- State (surface tints) --- */
  --state-success-surface: #E6EFE9;
  --state-danger-surface:  #FBEAE7;
  --state-info-surface:    #E8EEF2;
  --state-warning-surface: #FCEEE2;

  /* --- Accent --- */
  --accent:      #D87B3F;
  --accent-text: #8D4C24;

  /* --- Focus --- */
  --focus-ring: #D87B3F;
}

.dark {
  /* --- Surfaces --- */
  --surface-page:    #14201A;
  --surface-raised:  #1E2C24;
  --surface-sunken:  #0E1813;
  --surface-overlay: #29382F;
  --surface-invert:  #F6F1E5;

  /* --- Text --- */
  --text-primary:   #F1ECDF;
  --text-secondary: #B4C2B3;
  --text-tertiary:  #7C8A7B;
  --text-inverse:   #15211B;

  /* --- Borders --- */
  --border-subtle:  rgba(241, 236, 223, 0.10);
  --border-default: rgba(241, 236, 223, 0.16);
  --border-strong:  rgba(241, 236, 223, 0.30);

  /* --- State (foreground) --- */
  --state-success: #95B8A2;
  --state-danger:  #D9694F;
  --state-info:    #95ABBA;
  --state-warning: #E0884F;

  /* --- State (surface tints) --- */
  --state-success-surface: #1B3327;
  --state-danger-surface:  #3A1C16;
  --state-info-surface:    #1E2E39;
  --state-warning-surface: #3A2A18;

  /* --- Accent --- */
  --accent:      #D87B3F;
  --accent-text: #E0884F;

  /* --- Focus --- */
  --focus-ring: #E0884F;
}

body {
  background: var(--surface-page);
  color: var(--text-primary);
}
```

---

## 5. Tailwind config

Two changes to the config from the main spec.

**1. Enable class-based dark mode:**

```js
module.exports = {
  darkMode: 'class',
  // ...
};
```

**2. Map semantic tokens into the theme so components use them as utilities.** The raw brand palette (`forest`, `bone`, `sunset`, `sky`, `bark`, `embers`) stays exactly as in the main spec — it does not change between modes. Add these semantic groups alongside it:

```js
theme: {
  extend: {
    colors: {
      // ... existing fixed brand palette: forest, bone, sunset, sky, bark, embers ...

      // Semantic tokens — driven by CSS vars, auto-adapt to light/dark
      surface: {
        page:    'var(--surface-page)',
        raised:  'var(--surface-raised)',
        sunken:  'var(--surface-sunken)',
        overlay: 'var(--surface-overlay)',
        invert:  'var(--surface-invert)',
      },
      ink: {            // text colors — named 'ink' so utilities read `text-ink-primary`
        primary:   'var(--text-primary)',
        secondary: 'var(--text-secondary)',
        tertiary:  'var(--text-tertiary)',
        inverse:   'var(--text-inverse)',
      },
      edge: {           // borders
        subtle:  'var(--border-subtle)',
        default: 'var(--border-default)',
        strong:  'var(--border-strong)',
      },
      state: {
        success: 'var(--state-success)',
        danger:  'var(--state-danger)',
        info:    'var(--state-info)',
        warning: 'var(--state-warning)',
      },
    },
  },
},
```

With this in place, components use `bg-surface-raised`, `text-ink-primary`, `border-edge-subtle`, `text-state-danger` — and dark mode works with **no `dark:` variants at all** for ordinary surface/text/border styling. The only places that need a `dark:` variant are components that genuinely change *treatment* between modes (the primary button — see below).

This is the migration the existing implementation needs: replace direct palette classes (`bg-bone-50`, `text-forest-900`, `border-bone-400/50`) with semantic ones (`bg-surface-page`, `text-ink-primary`, `border-edge-subtle`). The fixed brand palette stays only for things that are mode-invariant by definition — the logo sun, the route line, brand illustrations.

---

## 6. Component adjustments

Most components need no change once they use semantic tokens. The exceptions:

### Logo

No new variant needed. Use the existing `inverse` variant on dark surfaces (cream mark), `primary` on light surfaces. In dark mode nearly everything is `inverse`. The logo's sunset sun is unchanged in both modes.

### Header

The header stays `forest-800` in **both** modes — the green nav bar is a constant brand element. In dark mode the page behind it is darker (`surface-page`), so add a `border-bottom` of `border-default` to keep the header edge crisp. Continue using `<Logo variant="inverse" />`.

### Buttons — the one real treatment change

The light-mode primary button (`bg-forest-800`) nearly disappears on a dark forest page. In dark mode the primary button inverts to a light fill with dark text — the highest-affordance treatment on a dark UI.

```tsx
// Primary — note the dark: override (a genuine treatment change)
<button className="
  bg-forest-800 text-bone-200 hover:bg-forest-900
  dark:bg-bone-100 dark:text-forest-900 dark:hover:bg-bone-200
  px-[18px] py-[10px] rounded-[4px] text-[13px] font-medium tracking-[0.02em] transition-colors
">
  Begin route
</button>
```

Secondary and tertiary buttons need no `dark:` variant if they use semantic tokens:

```tsx
// Secondary — transparent, semantic border + text
<button className="bg-transparent text-ink-secondary border-[0.5px] border-edge-default
  px-[18px] py-[10px] rounded-[4px] text-[13px] font-medium hover:bg-surface-raised transition-colors">
  Tell me more
</button>

// Tertiary — muted, no border
<button className="bg-transparent text-ink-tertiary hover:text-ink-primary
  px-3 py-2 text-[13px] transition-colors">
  Dismiss
</button>
```

Do **not** make the primary button sunset orange. Sunset is reserved for the route line and accents; promoting it to the primary button would have the accent doing two jobs in the same view.

### List item card

No change beyond semantic tokens. The numbered circle stays `forest-800` (it reads on both `surface-raised` values); its text stays `bone-200`. The terminal/destination circle stays `sunset-600`.

```tsx
<div className="grid grid-cols-[36px_1fr_auto] gap-[14px] items-center px-4 py-3
  bg-surface-raised rounded-lg border-[0.5px] border-edge-subtle">
  <div className="w-8 h-8 rounded-full bg-forest-800 text-bone-200 flex items-center justify-center font-mono text-[13px] font-medium">
    1
  </div>
  <div>
    <div className="font-serif text-base font-medium text-ink-primary leading-tight">Leavenworth</div>
    <div className="text-xs text-ink-tertiary mt-0.5">9:00 AM · start of route</div>
  </div>
  <div className="font-mono text-[11px] text-ink-tertiary tracking-[0.08em]">0 mi</div>
</div>
```

### AI assistant card ("Field guide says…")

In light mode this card uses `surface-sunken` (a darker cream — it reads as inset). "Inset" does not translate to dark mode; a darker-than-page card would recede when it should feel present. In dark mode the card uses `surface-overlay` (lighter than the page — it reads as elevated).

Drive this off `surface-overlay` in both modes? No — light mode wants the inset look. This is the one component with a mode-dependent surface. Use a `dark:` variant:

```tsx
<div className="bg-surface-sunken dark:bg-surface-overlay rounded-xl px-[22px] py-5">
  <div className="flex items-center gap-[10px] mb-3">
    <Logo variant="primary" className="dark:hidden" size={22} />
    <Logo variant="inverse" className="hidden dark:block" size={22} />
    <div className="font-serif text-[15px] italic font-medium text-ink-primary">
      Field guide says…
    </div>
  </div>
  <p className="text-[14px] text-ink-secondary leading-relaxed">
    {/* AI-generated body copy */}
  </p>
  {/* action buttons */}
</div>
```

### Paper-map illustration

The map gets a full dark re-skin. Background uses `surface-raised` (consistent with light mode, where the map sits on `bone-100`). Every other element shifts:

| Map element | Light value | Dark value |
| --- | --- | --- |
| Canvas background | `bone-100` `#F6F1E5` | `surface-raised` `#1E2C24` |
| Topographic contour lines | `forest-200`, 35–55% opacity | `forest-200` `#95B8A2`, 18–24% opacity |
| River | `sky-200`-ish, ~55% opacity | `sky-400` `#5B7E92`, ~50% opacity |
| Route line | `sunset-600` `#D87B3F` | `sunset-600` `#D87B3F` (unchanged) |
| Stop pin fill | `forest-800` | `bone-100` `#F6F1E5` |
| Stop pin ring + inner dot | `bone-50` | `surface-page` `#14201A` |
| Destination pin | `sunset-600` + white X | `sunset-600` + `surface-page` X (unchanged fill) |
| Compass, scale bar, labels | `bark-600` | `text-secondary` `#B4C2B3` |
| Title plate text | `bark-600` / `bone-600` | `text-secondary` / `text-tertiary` |

The route line and destination pin do not change — the orange holds against the dark canvas and glows, exactly as intended by the "Dusk" concept.

If you move to a real interactive map later (MapLibre/Mapbox), build a parallel dark style sheet: deep forest-charcoal base, muted `forest-400` land, `sky-800` water, `sunset-600` route.

### Inputs and form fields

- Background: `surface-sunken` (recessed well — slightly darker than the page)
- Border: `border-default`, going to `border-strong` on hover
- Text: `text-primary`; placeholder: `text-tertiary`
- Focus: 2px `--focus-ring` outline with 2px offset

### Focus rings

`--focus-ring` is `sunset-600` in light mode and `sunset-400` in dark mode (slightly lighter for visibility on the dark UI). Apply consistently: `outline: 2px solid var(--focus-ring); outline-offset: 2px;`.

### Detail polish

- **Photos / trip imagery:** apply `filter: brightness(0.92)` in dark mode so images don't glare against the dark UI.
- **Selection:** `::selection` background `rgba(216,123,63,0.25)` (sunset at low alpha), both modes.
- **Scrollbars:** thumb `border-strong`, track transparent.

---

## 7. Toggle implementation

Use class-based switching so users can override their OS preference.

For Next.js, `next-themes` is the cleanest path:

```bash
npm install next-themes
```

```tsx
// app/providers.tsx
'use client';
import { ThemeProvider } from 'next-themes';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"      // toggles the `.dark` class on <html>
      defaultTheme="system"  // follow OS by default
      enableSystem
    >
      {children}
    </ThemeProvider>
  );
}
```

Wrap the app in `<Providers>` and add `suppressHydrationWarning` to the `<html>` tag (next-themes sets the class before paint, which React would otherwise flag as a hydration mismatch).

For a non-Next.js setup, the equivalent is: read `localStorage` + `prefers-color-scheme` on load, toggle `document.documentElement.classList` , and write the choice back to `localStorage`. Set the class in a blocking inline script in `<head>` to avoid a flash of the wrong theme.

A theme toggle control belongs in the header next to the avatar, or in account settings. Three options (light / dark / system) are better than a binary switch.

---

## 8. Accessibility — dark mode contrast

All against `surface-page` `#14201A` unless noted.

| Pairing | Contrast | Verdict |
| --- | --- | --- |
| `text-primary` `#F1ECDF` | ~16:1 | AAA |
| `text-secondary` `#B4C2B3` | ~9:1 | AAA |
| `text-tertiary` `#7C8A7B` | ~4.6:1 | AA — large/non-essential text only |
| `accent` `#D87B3F` | ~7:1 | AA — UI, large text, lines |
| `accent-text` `#E0884F` | ~8.5:1 | AAA — safe for small accent text |
| `state-success` `#95B8A2` | ~8:1 | AAA |
| `state-info` `#95ABBA` | ~8.5:1 | AAA |
| `state-danger` `#D9694F` | ~6:1 | AA |
| `text-primary` on `surface-raised` `#1E2C24` | ~13:1 | AAA |

Practical rules:
- Never use `text-tertiary` for body-size reading text — it is for hints, captions, and disabled states only.
- For small accent-colored text use `accent-text` (`sunset-400`), not `accent` (`sunset-600`).
- The dark-mode primary button (`bone-100` on `forest-900` text) is ~14:1 — well clear.

---

## 9. Checklist

- [ ] Add `darkMode: 'class'` to the Tailwind config
- [ ] Add the `surface` / `ink` / `edge` / `state` semantic color groups to the Tailwind theme
- [ ] Add the `:root` and `.dark` custom-property blocks to global CSS
- [ ] Extend the Embers ramp to five stops (50–800)
- [ ] Migrate components off raw palette classes (`bg-bone-50`, `text-forest-900`) onto semantic ones (`bg-surface-page`, `text-ink-primary`)
- [ ] Add the `dark:` treatment change to the primary button
- [ ] Add the `dark:` surface swap to the AI assistant card
- [ ] Re-skin the paper-map illustration per the element table
- [ ] Add `border-bottom` to the header for dark mode
- [ ] Install and wire `next-themes`; add the blocking class so there is no flash
- [ ] Add a three-way (light / dark / system) toggle to the header
- [ ] Apply `brightness(0.92)` to images in dark mode
- [ ] Verify focus rings use `--focus-ring` everywhere

---

## Appendix: dark mode at a glance

**Surfaces:** `#0E1813` sunken · `#14201A` page · `#1E2C24` raised · `#29382F` overlay — deep warm forest, lighter as elevation rises.

**Ink:** `#F1ECDF` primary · `#B4C2B3` secondary · `#7C8A7B` tertiary — warm pale, fading to sage.

**Borders:** warm-white at 10 / 16 / 30% alpha.

**Accent:** `#D87B3F` — unchanged. The sunset is the sunset.

**The concept:** the same field guide, read at dusk.

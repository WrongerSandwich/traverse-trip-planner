# Traverse — Design Specification

The source-of-truth design system for **Traverse**. This spec defined the brand mark, the paper-map illustration system, and the visual language; the SvelteKit components in `src/lib/components/` reference it for layout and color rules (see `Logo.svelte` §2, `PaperMap.svelte` §7, and the companion [`traverse-dark-mode-spec.md`](traverse-dark-mode-spec.md)).

**Brand direction:** Park service — boutique outdoor catalog meets National Park Service signage. Forest greens, cream paper backgrounds, sunset orange accents, vintage paper-map aesthetic.

**Stack:** SvelteKit with CSS custom properties declared in `src/app.css`.

> **For AI agents:** a concise, machine-readable token summary (Google-Stitch
> `DESIGN.md` format) lives in [`DESIGN.md`](DESIGN.md) and tracks the implemented
> tokens in `src/app.css` — it's what the impeccable skill auto-loads. This file
> remains the comprehensive human reference (logo, iconography, voice). If the two
> ever disagree on a value, `src/app.css` is the source of truth and `DESIGN.md`
> reflects it. Note: the radius scale here (§5) predates the 2026-06 planning-page
> refresh, which moved the implemented `--radius-*` tokens to 8/12/16 (+ a 999px
> chip radius); see `DESIGN.md` for current values.

## Table of contents

1. [Foundations](#1-foundations)
2. [Logo](#2-logo)
3. [Color](#3-color)
4. [Typography](#4-typography)
5. [Spacing and radius](#5-spacing-and-radius)
6. [Iconography](#6-iconography)
7. [Components](#7-components)
8. [Voice and content](#8-voice-and-content)
9. [Implementation notes](#9-implementation-notes)

---

## 1. Foundations

### Visual direction

Mid-century parks-service language modernized: circular badges, mountain silhouettes, paper-map textures, classic civic typography. The look references both vintage NPS visitor-center publications and contemporary boutique outdoor catalogs (Patagonia, Topo Designs).

- Flat surfaces; no gradients, no drop shadows, no glassmorphism
- Cream-paper backgrounds rather than pure white
- Generous whitespace, type-led hierarchy
- Serif headlines, sans-serif body, mono for metadata

### Brand voice

The product's AI assistant is named **Field guide**. It speaks like a knowledgeable, unhurried naturalist:

| Field guide ✓ | Not field guide ✗ |
| --- | --- |
| "There's an old grain elevator in Atchison that catches the late afternoon light particularly well." | "🎉 We found an AMAZING photo spot!" |
| "About 12 minutes off your route — worth pulling over if you're not in a hurry." | "Add this must-see destination!" |
| "Wildflowers should be in bloom this week at the Missouri Bluffs overlook." | "Don't miss out on stunning views!" |
| "Want me to slot either of them in?" | "Click here to add to your trip!" |

Personality dial: reverent (not solemn), detailed (not pedantic), inviting (not promotional), confident (not authoritative).

Capitalization: sentence case for all UI labels, headings, button text, and microcopy. Proper nouns keep their natural capitalization ("Glacial Hills Scenic Byway", "Atchison").

---

## 2. Logo

### Primary mark

The mark is a circular badge framing an **open road in one-point perspective** — the road runs from the viewer's feet up to a vanishing point on the horizon, where a low sun sits. It reframes the brand around the act of driving rather than the outdoors, while keeping the badge format, the warm sun, and the horizon line.

Construction:
- Double-ring badge — outer r=36 stroke 1.5, inner r=33 stroke 0.5 hairline
- The road is a shape clipped to the inner circle. It flares from a 2.5-unit-wide edge at the horizon down past the badge's bottom, so it reads as a first-person view *down* the road, not a distant shape floating in the badge
- Three centerline dashes, cut as a mask (real transparent holes), diminishing in size and spacing toward the horizon — this is the cue that sells the perspective
- A sun disc above the horizon line, sitting at the vanishing point
- The road and rings take the mark color; the sun is the fixed accent

**Canonical SVG** — uses `currentColor` for the mark and a mask for the dashes, so it works on any background with no per-variant color swaps:

```svg
<svg viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Traverse">
  <defs>
    <clipPath id="tr-road"><circle cx="40" cy="40" r="33"/></clipPath>
    <mask id="tr-dashes">
      <rect x="0" y="0" width="80" height="80" fill="#fff"/>
      <path d="M 33.75 69 L 46.25 69 L 44.4 61 L 35.6 61 Z" fill="#000"/>
      <path d="M 36.55 57 L 43.45 57 L 42.35 52.5 L 37.65 52.5 Z" fill="#000"/>
      <path d="M 38.5 49 L 41.5 49 L 41 46.8 L 39 46.8 Z" fill="#000"/>
    </mask>
  </defs>
  <circle cx="40" cy="40" r="36" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <circle cx="40" cy="40" r="33" fill="none" stroke="currentColor" stroke-width="0.5"/>
  <circle cx="40" cy="35.5" r="7" fill="#D87B3F"/>
  <line x1="16" y1="44" x2="64" y2="44" stroke="currentColor" stroke-width="1"/>
  <path d="M 38.75 44 L 41.25 44 L 72 82 L 8 82 Z" fill="currentColor" clip-path="url(#tr-road)" mask="url(#tr-dashes)"/>
</svg>
```

**Geometry reference** (for any future tweaks):
- Road body, pre-clip: `M 38.75 44 L 41.25 44 L 72 82 L 8 82 Z` — a wide trapezoid clipped to the inner circle (r=33). The 2.5-unit top edge sits on the horizon; the wide bottom is cropped by the badge
- Centerline dashes (the mask cut-outs), foreground to horizon: `M 33.75 69 L 46.25 69 L 44.4 61 L 35.6 61 Z` then `M 36.55 57 L 43.45 57 L 42.35 52.5 L 37.65 52.5 Z` then `M 38.5 49 L 41.5 49 L 41 46.8 L 39 46.8 Z`
- Sun: circle at (40, 35.5) radius 7, above the horizon
- Horizon line: y=44, from x=16 to x=64
- Outer ring r=36 stroke 1.5; inner ring r=33 stroke 0.5

The mask makes the dashes true transparent holes — whatever surface the mark sits on shows through them. Never fill the dashes with a solid color; that breaks the moment the background does not match.

### React component

A single parameterized component handles all four colorways and auto-switches to a simplified mark below 24px. It uses `useId()` so the clip and mask IDs are unique per instance — this is required, because duplicate IDs across multiple instances on a page will cross-reference and corrupt the render.

```tsx
import { useId } from 'react';

type LogoVariant = 'primary' | 'inverse' | 'mono-dark' | 'mono-light';

interface LogoProps {
  variant?: LogoVariant;
  size?: number;
  className?: string;
  'aria-label'?: string;
}

const VARIANT_COLORS: Record<LogoVariant, { mark: string; sun: string }> = {
  primary:      { mark: '#1F4332', sun: '#D87B3F' },  // forest mark — for light surfaces
  inverse:      { mark: '#EBE0C9', sun: '#D87B3F' },  // bone mark — for dark / forest surfaces
  'mono-dark':  { mark: '#1F4332', sun: '#1F4332' },  // single-color dark — one-color print
  'mono-light': { mark: '#EBE0C9', sun: '#EBE0C9' },  // single-color light — one-color print
};

export const Logo = ({
  variant = 'primary',
  size = 40,
  className,
  'aria-label': ariaLabel = 'Traverse',
}: LogoProps) => {
  const c = VARIANT_COLORS[variant];
  const uid = useId().replace(/:/g, '');
  const svgProps = {
    viewBox: '0 0 80 80',
    width: size,
    height: size,
    xmlns: 'http://www.w3.org/2000/svg',
    role: 'img' as const,
    'aria-label': ariaLabel,
    className,
  };

  // Below 24px: simplified mark. Keeps the full composition — badge ring,
  // road, sun, horizon and all three dashes — and drops only the inner
  // hairline ring, which cannot resolve at this size. Strokes are bumped so
  // the mark stays legible while still reading as the full logo.
  if (size < 24) {
    const clip = `trfc-${uid}`;
    const mask = `trfm-${uid}`;
    return (
      <svg {...svgProps}>
        <defs>
          <clipPath id={clip}><circle cx="40" cy="40" r="33" /></clipPath>
          <mask id={mask}>
            <rect x="0" y="0" width="80" height="80" fill="#fff" />
            <path d="M 33.75 69 L 46.25 69 L 44.4 61 L 35.6 61 Z" fill="#000" />
            <path d="M 36.55 57 L 43.45 57 L 42.35 52.5 L 37.65 52.5 Z" fill="#000" />
            <path d="M 38.5 49 L 41.5 49 L 41 46.8 L 39 46.8 Z" fill="#000" />
          </mask>
        </defs>
        <circle cx="40" cy="40" r="36" fill="none" stroke={c.mark} strokeWidth="2" vectorEffect="non-scaling-stroke" />
        <circle cx="40" cy="35.5" r="7" fill={c.sun} />
        <line x1="16" y1="44" x2="64" y2="44" stroke={c.mark} strokeWidth="1.3" vectorEffect="non-scaling-stroke" />
        <path d="M 38.75 44 L 41.25 44 L 72 82 L 8 82 Z" fill={c.mark}
              clipPath={`url(#${clip})`} mask={`url(#${mask})`} />
      </svg>
    );
  }

  const roadClip = `trr-${uid}`;
  const dashMask = `trd-${uid}`;
  return (
    <svg {...svgProps}>
      <defs>
        <clipPath id={roadClip}><circle cx="40" cy="40" r="33" /></clipPath>
        <mask id={dashMask}>
          <rect x="0" y="0" width="80" height="80" fill="#fff" />
          <path d="M 33.75 69 L 46.25 69 L 44.4 61 L 35.6 61 Z" fill="#000" />
          <path d="M 36.55 57 L 43.45 57 L 42.35 52.5 L 37.65 52.5 Z" fill="#000" />
          <path d="M 38.5 49 L 41.5 49 L 41 46.8 L 39 46.8 Z" fill="#000" />
        </mask>
      </defs>
      <circle cx="40" cy="40" r="36" fill="none" stroke={c.mark} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      <circle cx="40" cy="40" r="33" fill="none" stroke={c.mark} strokeWidth="0.5" vectorEffect="non-scaling-stroke" />
      <circle cx="40" cy="35.5" r="7" fill={c.sun} />
      <line x1="16" y1="44" x2="64" y2="44" stroke={c.mark} strokeWidth="1" vectorEffect="non-scaling-stroke" />
      <path d="M 38.75 44 L 41.25 44 L 72 82 L 8 82 Z" fill={c.mark}
            clipPath={`url(#${roadClip})`} mask={`url(#${dashMask})`} />
    </svg>
  );
};
```

The four colorways:
- **primary** — forest mark, orange sun. For light surfaces; the default.
- **inverse** — bone mark, orange sun. For the forest header, the hero, and any dark surface.
- **mono-dark** / **mono-light** — single-color (the sun matches the mark). For one-color printing, embossing, or a single-ink favicon.

In dark mode the logo needs no new values — it simply uses `inverse` on dark surfaces. The app header and hero are forest in both light and dark mode, so the header logo is always `inverse`. On a theme-dependent surface, pick the variant from the theme: `variant={theme === 'dark' ? 'inverse' : 'primary'}`.

### Lockup variations

**Horizontal lockup** — most common, in app headers and inline references:

```tsx
<div className="flex items-center gap-[10px]">
  <Logo variant="primary" size={36} />
  <span className="font-serif text-2xl font-medium leading-none text-forest-800 tracking-[0.005em]">
    Traverse
  </span>
</div>
```

**Stacked lockup** — for square contexts and splash screens:

```tsx
<div className="flex flex-col items-center gap-1.5">
  <Logo variant="primary" size={38} />
  <span className="font-serif text-lg font-medium leading-none text-forest-800">
    Traverse
  </span>
</div>
```

**Mark only** — social profile pictures, decorative use, and (simplified) favicons.

**Hero / brand-moment lockup** — for splash, about, and marketing pages. Orange hairlines flank the wordmark, tagline below:

```tsx
<div className="bg-forest-800 px-10 py-14 text-center">
  <Logo variant="inverse" size={100} className="mx-auto mb-5" />
  <div className="flex items-center justify-center gap-[18px]">
    <div className="h-px w-[70px] bg-sunset-600" />
    <div className="font-serif text-[56px] font-medium leading-none tracking-[0.01em] text-bone-200">
      Traverse
    </div>
    <div className="h-px w-[70px] bg-sunset-600" />
  </div>
  <div className="mt-4 font-mono text-[11px] tracking-[0.28em] text-sunset-600">
    Field guide · open road
  </div>
</div>
```

### Favicon and small sizes

Below 24px the `Logo` component auto-renders the simplified mark — the full badge with only the inner hairline ring dropped (it cannot resolve at this size).

For the browser favicon and app icons, use the self-contained tile below. It is a forest rounded-square with the badge mark placed on it — the same composition as the full mark (badge ring, road, sun, horizon, all three dashes), with stroke weights bumped so they survive at 16px. It is deliberately a faithful descendant of the full logo rather than a clean abstraction: it looks busy at 16px, but it reads unmistakably as the same mark, and it sharpens up at 32px and above.

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <defs><clipPath id="tr-tile"><rect width="64" height="64" rx="14"/></clipPath></defs>
  <g clip-path="url(#tr-tile)">
    <rect width="64" height="64" fill="#1F4332"/>
    <svg x="3" y="3" width="58" height="58" viewBox="0 0 80 80">
      <defs><clipPath id="tr-fav-road"><circle cx="40" cy="40" r="33"/></clipPath></defs>
      <circle cx="40" cy="40" r="35" fill="none" stroke="#EBE0C9" stroke-width="4.5"/>
      <circle cx="40" cy="35.5" r="7" fill="#D87B3F"/>
      <line x1="16" y1="44" x2="64" y2="44" stroke="#EBE0C9" stroke-width="3.5"/>
      <path d="M 38.75 44 L 41.25 44 L 72 82 L 8 82 Z" fill="#EBE0C9" clip-path="url(#tr-fav-road)"/>
      <path d="M 33.75 69 L 46.25 69 L 44.4 61 L 35.6 61 Z" fill="#1F4332"/>
      <path d="M 36.55 57 L 43.45 57 L 42.35 52.5 L 37.65 52.5 Z" fill="#1F4332"/>
      <path d="M 38.5 49 L 41.5 49 L 41 46.8 L 39 46.8 Z" fill="#1F4332"/>
    </svg>
  </g>
</svg>
```

The single bold badge ring replaces the full mark's double ring: at favicon sizes the two rings cannot resolve as separate strokes, so one clean ring is both clearer and more faithful to what is actually perceivable. The dashes are filled forest (the tile color) rather than masked, since the background here is known. Export PNGs at 16, 32, 180 (Apple touch icon), 192, and 512 from this tile. Set `<meta name="theme-color" content="#1F4332">`.

### Tagline

**Field guide · open road**

The mark and the tagline now say the same thing — the tagline reads as a literal caption for the logo. Use it only in brand-moment treatments (hero lockup, about page, email footer); it is a treatment, not a perpetual subtitle.

### Usage rules

**Clear space.** Maintain at least 1× mark radius of clear space on all sides of any lockup. For a 40px mark the radius is 20px, so the minimum clear space is 20px.

**Minimum size.** Use the full mark at 24px or larger. Below 24px the `Logo` component automatically swaps to the simplified mark — never force the full mark smaller.

**Don'ts:**
- Don't recolor the mark with non-brand colors, or change the sun from `sunset-600`
- Don't stretch or distort the aspect ratio
- Don't separate the mark and wordmark in lockups
- Don't rotate the mark, and never mirror it — the road runs *away* from the viewer; flipping it breaks the perspective
- Don't add effects (shadows, glows, fills beyond specification)
- Don't fill the centerline dashes with a solid color — they are transparent cut-outs
- Don't place the mark on busy or low-contrast backgrounds

---

## 3. Color

### Palette

Five brand families plus one semantic-only color (Embers, for danger states). Each family has 7 stops following a 50–900 scale. The brand-base stop for each family is marked with ★.

#### Forest — primary

| Stop | Hex | Use |
| --- | --- | --- |
| 50 | `#E6EFE9` | Very subtle backgrounds, hover tints |
| 100 | `#C8DCD0` | Light surfaces with green tint |
| 200 | `#95B8A2` | Decorative, subtle borders |
| 400 | `#4D8067` | Mid-tone, illustrative |
| 600 | `#2D5840` | Secondary text on light backgrounds, success state |
| **800 ★** | `#1F4332` | Primary brand color, dark surfaces, body headlines |
| 900 | `#112619` | Highest-contrast text, primary text |

#### Bone — surface/neutral

| Stop | Hex | Use |
| --- | --- | --- |
| 50 | `#FCFAF5` | Page background, primary surface |
| 100 | `#F6F1E5` | Raised surface, secondary background |
| **200 ★** | `#EBE0C9` | Sunken surface, AI assistant card, brand cream |
| 400 | `#C9B695` | Decorative, dividers |
| 600 | `#9A8A6F` | Tertiary text, hints |
| 800 | `#5F5341` | Dark warm gray |
| 900 | `#3D3527` | Deepest warm dark |

#### Sunset — accent

| Stop | Hex | Use |
| --- | --- | --- |
| 50 | `#FCEEE2` | Warm tint backgrounds |
| 100 | `#F7D2B0` | Light warm surface |
| 200 | `#F0B080` | Decorative |
| 400 | `#E0884F` | Mid orange, warning state |
| **600 ★** | `#D87B3F` | Brand accent, route lines, sun motif |
| 800 | `#8D4C24` | Deep orange, accessible orange text on cream |
| 900 | `#5C2F14` | Darkest orange-brown |

#### Sky — info/navy

| Stop | Hex | Use |
| --- | --- | --- |
| 50 | `#E8EEF2` | Cool backgrounds |
| 100 | `#C5D2DC` | Light blue-gray |
| 200 | `#95ABBA` | Decorative, river illustrations |
| 400 | `#5B7E92` | Mid blue-gray |
| **600 ★** | `#3D5A6E` | Info state, navy details |
| 800 | `#25394A` | Deep navy |
| 900 | `#16252F` | Darkest navy |

#### Bark — deep accent

| Stop | Hex | Use |
| --- | --- | --- |
| 50 | `#F4EDE7` | Warm light backgrounds |
| 100 | `#DCC9B8` | Tan surfaces |
| 200 | `#B7977C` | Decorative |
| 400 | `#876248` | Mid brown |
| **600 ★** | `#5C4031` | Deep brown details, labels on cream surfaces |
| 800 | `#3C2922` | Dark brown |
| 900 | `#211611` | Almost-black warm |

#### Embers — semantic-only (danger)

A single semantic color for error and destructive states. Not part of the brand palette for illustrative or decorative use.

| Stop | Hex | Use |
| --- | --- | --- |
| 600 | `#A82F1F` | Danger state, destructive confirmations, error text |

### Semantic mappings

These are the tokens components should reference, not the raw palette colors. This decoupling makes future re-themes possible without touching component code.

**Text:**
- `text-primary` → `forest-900` (#112619)
- `text-secondary` → `forest-600` (#2D5840)
- `text-tertiary` → `bone-600` (#9A8A6F)
- `text-inverse` → `bone-50` (#FCFAF5)

**Surface:**
- `surface-page` → `bone-50` (#FCFAF5)
- `surface-raised` → `bone-100` (#F6F1E5)
- `surface-sunken` → `bone-200` (#EBE0C9)
- `surface-invert` → `forest-800` (#1F4332)

**State:**
- `state-success` → `forest-600` (#2D5840)
- `state-danger` → `embers-600` (#A82F1F)
- `state-info` → `sky-600` (#3D5A6E)
- `state-warning` → `sunset-400` (#E0884F)

### CSS custom properties

Paste into a global stylesheet (e.g., `app/globals.css`):

```css
:root {
  /* Forest */
  --forest-50: #E6EFE9;
  --forest-100: #C8DCD0;
  --forest-200: #95B8A2;
  --forest-400: #4D8067;
  --forest-600: #2D5840;
  --forest-800: #1F4332;
  --forest-900: #112619;

  /* Bone */
  --bone-50: #FCFAF5;
  --bone-100: #F6F1E5;
  --bone-200: #EBE0C9;
  --bone-400: #C9B695;
  --bone-600: #9A8A6F;
  --bone-800: #5F5341;
  --bone-900: #3D3527;

  /* Sunset */
  --sunset-50: #FCEEE2;
  --sunset-100: #F7D2B0;
  --sunset-200: #F0B080;
  --sunset-400: #E0884F;
  --sunset-600: #D87B3F;
  --sunset-800: #8D4C24;
  --sunset-900: #5C2F14;

  /* Sky */
  --sky-50: #E8EEF2;
  --sky-100: #C5D2DC;
  --sky-200: #95ABBA;
  --sky-400: #5B7E92;
  --sky-600: #3D5A6E;
  --sky-800: #25394A;
  --sky-900: #16252F;

  /* Bark */
  --bark-50: #F4EDE7;
  --bark-100: #DCC9B8;
  --bark-200: #B7977C;
  --bark-400: #876248;
  --bark-600: #5C4031;
  --bark-800: #3C2922;
  --bark-900: #211611;

  /* Embers (danger only) */
  --embers-600: #A82F1F;

  /* Semantic — text */
  --text-primary: var(--forest-900);
  --text-secondary: var(--forest-600);
  --text-tertiary: var(--bone-600);
  --text-inverse: var(--bone-50);

  /* Semantic — surface */
  --surface-page: var(--bone-50);
  --surface-raised: var(--bone-100);
  --surface-sunken: var(--bone-200);
  --surface-invert: var(--forest-800);

  /* Semantic — state */
  --state-success: var(--forest-600);
  --state-danger: var(--embers-600);
  --state-info: var(--sky-600);
  --state-warning: var(--sunset-400);
}

body {
  background: var(--surface-page);
  color: var(--text-primary);
}
```

### Tailwind config

```js
// tailwind.config.js — Tailwind v3 syntax
module.exports = {
  content: ['./src/**/*.{ts,tsx,js,jsx}'],
  theme: {
    extend: {
      colors: {
        forest: {
          50: '#E6EFE9', 100: '#C8DCD0', 200: '#95B8A2',
          400: '#4D8067', 600: '#2D5840', 800: '#1F4332', 900: '#112619',
        },
        bone: {
          50: '#FCFAF5', 100: '#F6F1E5', 200: '#EBE0C9',
          400: '#C9B695', 600: '#9A8A6F', 800: '#5F5341', 900: '#3D3527',
        },
        sunset: {
          50: '#FCEEE2', 100: '#F7D2B0', 200: '#F0B080',
          400: '#E0884F', 600: '#D87B3F', 800: '#8D4C24', 900: '#5C2F14',
        },
        // Note: this overrides Tailwind's default sky palette
        sky: {
          50: '#E8EEF2', 100: '#C5D2DC', 200: '#95ABBA',
          400: '#5B7E92', 600: '#3D5A6E', 800: '#25394A', 900: '#16252F',
        },
        bark: {
          50: '#F4EDE7', 100: '#DCC9B8', 200: '#B7977C',
          400: '#876248', 600: '#5C4031', 800: '#3C2922', 900: '#211611',
        },
        embers: { 600: '#A82F1F' },
      },
      fontFamily: {
        serif: ['var(--font-serif)', 'ui-serif', 'Georgia', 'serif'],
        sans:  ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono:  ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
    },
  },
};
```

Tailwind's default `sky` palette is overridden by the brand's navy values. If you want both, rename the brand color (`navy: {...}`) and adjust component classes accordingly.

---

## 4. Typography

### Font stack

Three families. The original brand direction called for Sentinel + Söhne (both licensed). The free Google Fonts equivalents below match the spirit:

| Role | Recommended (free) | Original spec |
| --- | --- | --- |
| Serif (headlines) | **Fraunces** | Sentinel |
| Sans (body, UI) | **Inter** | Söhne |
| Mono (code, metadata) | **JetBrains Mono** | JetBrains Mono |

Fraunces is a humanist serif with character — slightly more contemporary than the original NPS-style slab serif but matches the boutique-outdoor side of the brand well. For a more parks-traditional slab look, swap to **Roboto Slab** or **Bitter**.

### Font loading

With Next.js `next/font` (recommended):

```tsx
// app/layout.tsx
import { Fraunces, Inter, JetBrains_Mono } from 'next/font/google';

const fraunces = Fraunces({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-serif',
  display: 'swap',
});
const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-sans',
  display: 'swap',
});
const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono',
  display: 'swap',
});

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${fraunces.variable} ${inter.variable} ${jetbrains.variable}`}>
      <body className="font-sans">{children}</body>
    </html>
  );
}
```

With a plain `<link>` tag:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:wght@400;500&family=Inter:wght@400;500&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
```

### Type scale

Two weights only: **400** regular and **500** medium. Never use 600, 700, or bolder — they feel heavy against the brand's quiet civic register.

| Token | Size | Line height | Weight | Family | Use |
| --- | --- | --- | --- | --- | --- |
| `display` | 56px | 56px | 500 | serif | Hero pages, marketing moments |
| `h1` | 40px | 44px | 500 | serif | Trip titles, primary page headings |
| `h2` | 26px | 32px | 500 | serif | Section headings within a page |
| `h3` | 18px | 24px | 500 | sans | Card titles, small headers |
| `body` | 15px | 24px | 400 | sans | Default reading text |
| `small` | 13px | 20px | 400 | sans | Meta info, secondary text |
| `caption` | 11px | 16px | 500 | sans | Eyebrows, labels — apply `letter-spacing: 0.18em` |
| `mono` | 13px | 20px | 400 | mono | Code, paths, distances, metadata |

Serif headings at large sizes (`display`, `h1`) should carry slight positive letter-spacing (`0.005em`–`0.01em`) to compensate for tighter default tracking on display sizes.

### CSS utility classes

```css
.text-display { font-family: var(--font-serif); font-size: 56px; line-height: 56px; font-weight: 500; letter-spacing: 0.005em; }
.text-h1      { font-family: var(--font-serif); font-size: 40px; line-height: 44px; font-weight: 500; letter-spacing: 0.005em; }
.text-h2      { font-family: var(--font-serif); font-size: 26px; line-height: 32px; font-weight: 500; }
.text-h3      { font-family: var(--font-sans);  font-size: 18px; line-height: 24px; font-weight: 500; }
.text-body    { font-family: var(--font-sans);  font-size: 15px; line-height: 24px; font-weight: 400; }
.text-small   { font-family: var(--font-sans);  font-size: 13px; line-height: 20px; font-weight: 400; }
.text-caption { font-family: var(--font-sans);  font-size: 11px; line-height: 16px; font-weight: 500; letter-spacing: 0.18em; }
.text-mono    { font-family: var(--font-mono);  font-size: 13px; line-height: 20px; font-weight: 400; }
```

---

## 5. Spacing and radius

### Spacing scale

4px base unit. Use rem for vertical rhythm between major sections; px for component-internal gaps.

| Token | Value | Use |
| --- | --- | --- |
| `space-1` | 4px | Hairline internal gaps |
| `space-2` | 8px | Tight component gaps |
| `space-3` | 12px | Standard internal gaps |
| `space-4` | 16px | Default padding for small components |
| `space-6` | 24px | Standard card padding |
| `space-8` | 32px | Section padding |
| `space-12` | 48px | Major section separation |
| `space-16` | 64px | Hero / brand-moment padding |

Tailwind's default spacing scale matches this — use `p-4`, `gap-3`, `mb-6`, etc.

### Border radius

| Token | Value | Use |
| --- | --- | --- |
| `radius-sm` | 4px | Buttons, chips, tags |
| `radius-md` | 8px | Cards, inputs, list items |
| `radius-lg` | 12px | Major surfaces (hero cards, AI assistant card) |
| `radius-full` | 9999px | Avatars, numbered circles |

**Important:** never apply rounded corners to single-sided borders. Either use a full border with radius, or no border with radius. Single-sided borders (`border-left`, `border-top`) must use `border-radius: 0`.

---

## 6. Iconography

### Style spec

- ViewBox: `0 0 24 24`
- Stroke width: 1.5px
- Stroke linecap and linejoin: `round`
- Default stroke: `currentColor` (inherits from parent text color)
- Accent fill: `#D87B3F` (sunset-600) on a single highlight element per icon — hardcoded so it doesn't theme-shift
- Most paths use `fill="none"`; only small accent details are filled

### Base icon set

Eight icons covering the core road-trip vocabulary. All use `stroke="currentColor"` so they inherit color from their parent — set `color: var(--forest-800)` on the container.

```tsx
// components/icons.tsx
import { type SVGProps } from 'react';

const baseProps: SVGProps<SVGSVGElement> = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

export const Pin = (props: SVGProps<SVGSVGElement>) => (
  <svg {...baseProps} width={24} height={24} {...props}>
    <path d="M 12 21 C 12 21 5 13.5 5 9 C 5 5.1 8.1 2 12 2 C 15.9 2 19 5.1 19 9 C 19 13.5 12 21 12 21 Z" />
    <circle cx="12" cy="9" r="2.5" />
  </svg>
);

export const Route = (props: SVGProps<SVGSVGElement>) => (
  <svg {...baseProps} width={24} height={24} {...props}>
    <path d="M 7 4 C 7 8 17 8 17 12 C 17 16 7 16 7 20" />
    <circle cx="7" cy="4" r="1.5" fill="currentColor" />
    <circle cx="7" cy="20" r="1.5" fill="#D87B3F" stroke="#D87B3F" />
  </svg>
);

export const Peak = (props: SVGProps<SVGSVGElement>) => (
  <svg {...baseProps} width={24} height={24} {...props}>
    <path d="M 3 20 L 9 11 L 13 15 L 17 8 L 21 20 Z" />
    <circle cx="17" cy="5" r="1.6" fill="#D87B3F" stroke="#D87B3F" />
  </svg>
);

export const Sun = (props: SVGProps<SVGSVGElement>) => (
  <svg {...baseProps} width={24} height={24} {...props}>
    <circle cx="12" cy="12" r="3.5" />
    <path d="M 12 3 L 12 5 M 12 19 L 12 21 M 3 12 L 5 12 M 19 12 L 21 12 M 5.6 5.6 L 7 7 M 17 17 L 18.4 18.4 M 5.6 18.4 L 7 17 M 17 7 L 18.4 5.6" />
  </svg>
);

export const Signpost = (props: SVGProps<SVGSVGElement>) => (
  <svg {...baseProps} width={24} height={24} {...props}>
    <line x1="12" y1="3" x2="12" y2="21" />
    <path d="M 12 6 L 19 6 L 21 8 L 19 10 L 12 10" />
    <path d="M 12 13 L 5 13 L 3 15 L 5 17 L 12 17" />
  </svg>
);

export const Tent = (props: SVGProps<SVGSVGElement>) => (
  <svg {...baseProps} width={24} height={24} {...props}>
    <path d="M 3 20 L 12 5 L 21 20" />
    <line x1="12" y1="5" x2="12" y2="20" />
    <path d="M 3 20 L 21 20" />
    <path d="M 9 20 L 12 15 L 15 20" />
  </svg>
);

export const Camera = (props: SVGProps<SVGSVGElement>) => (
  <svg {...baseProps} width={24} height={24} {...props}>
    <rect x="3" y="7" width="18" height="13" rx="2" />
    <circle cx="12" cy="13.5" r="3.5" />
    <path d="M 8 7 L 9 5 L 15 5 L 16 7" />
  </svg>
);

export const Flag = (props: SVGProps<SVGSVGElement>) => (
  <svg {...baseProps} width={24} height={24} {...props}>
    <line x1="6" y1="3" x2="6" y2="21" />
    <path d="M 6 5 L 18 5 L 16 9 L 18 13 L 6 13" />
  </svg>
);
```

### Extending the icon set

For icons not in the base set, use [Tabler Icons](https://tabler-icons.io) outline variants. Override their stroke width to `1.5` to match the brand:

```tsx
import { IconCompass } from '@tabler/icons-react';

<IconCompass size={24} stroke={1.5} className="text-forest-800" />
```

Avoid Lucide's default icons without restyling — they ship at stroke width 2 by default and will read slightly heavier than the brand set.

---

## 7. Components

### Buttons

Three variants. All buttons use sans-serif, font-weight 500, sentence case, and 4px corner radius.

**Primary** — solid forest with bone text. Use for primary actions like "Begin route".

```tsx
<button className="bg-forest-800 text-bone-200 px-[18px] py-[10px] rounded-[4px] text-[13px] font-medium tracking-[0.02em] hover:bg-forest-900 transition-colors">
  Begin route
</button>
```

**Secondary** — transparent with bark outline. Use for non-primary actions.

```tsx
<button className="bg-transparent text-bark-600 border-[0.5px] border-bark-600 px-[18px] py-[10px] rounded-[4px] text-[13px] font-medium hover:bg-bone-100 transition-colors">
  Tell me more
</button>
```

**Tertiary** — no background, no border, muted text. Use for dismissals and low-emphasis actions.

```tsx
<button className="bg-transparent text-bone-600 px-3 py-2 text-[13px] hover:text-forest-800 transition-colors">
  Dismiss
</button>
```

**Compact button** — same variants, but smaller: `py-2 px-[14px] text-[12px]`. Used in dense contexts like the AI assistant card.

### Cards

**List item card** (used for stops, trips, search results):

```tsx
<div className="grid grid-cols-[36px_1fr_auto] gap-[14px] items-center px-4 py-3 bg-bone-50 rounded-lg border-[0.5px] border-bone-400/50">
  <div className="w-8 h-8 rounded-full bg-forest-800 text-bone-200 flex items-center justify-center font-mono text-[13px] font-medium">
    1
  </div>
  <div>
    <div className="font-serif text-base font-medium text-forest-800 leading-tight">
      Leavenworth
    </div>
    <div className="text-xs text-bark-600 mt-0.5">
      9:00 AM · start of route
    </div>
  </div>
  <div className="font-mono text-[11px] text-bone-600 tracking-[0.08em]">
    0 mi
  </div>
</div>
```

For terminal/destination items (the last stop), swap the numbered circle for a sunset-600 circle with an X mark:

```tsx
<div className="w-8 h-8 rounded-full bg-sunset-600 text-sunset-50 flex items-center justify-center text-sm font-medium">
  ✕
</div>
```

**Trip hero pattern** — caption eyebrow (mono, tracked), large serif title, meta row with `·` separators, primary action right-aligned:

```tsx
<div className="px-7 pt-6 pb-5 border-b-[0.5px] border-bone-400/50">
  <div className="flex items-start justify-between gap-4">
    <div className="flex-1">
      <div className="font-mono text-[11px] text-bone-600 tracking-[0.22em] mb-2">
        draft trip · saved 2 days ago
      </div>
      <h1 className="font-serif text-[32px] font-medium text-forest-800 leading-[1.05] tracking-[0.003em]">
        Glacial Hills Scenic Byway
      </h1>
      <div className="flex gap-3 mt-3 items-center flex-wrap font-mono text-xs text-bark-600">
        <span>Sat May 16</span>
        <span className="text-bone-400">·</span>
        <span>160 mi</span>
        <span className="text-bone-400">·</span>
        <span>~4 hr drive</span>
        <span className="text-bone-400">·</span>
        <span>2 days</span>
      </div>
    </div>
    <button className="bg-forest-800 text-bone-200 px-[18px] py-[10px] rounded-[4px] text-[13px] font-medium tracking-[0.02em] whitespace-nowrap">
      Begin route
    </button>
  </div>
</div>
```

**AI assistant card** ("Field guide says…") — bone-200 background, badge mark, italic serif label, body in bark-800, action button row:

```tsx
<div className="bg-bone-200 rounded-xl px-[22px] py-5">
  <div className="flex items-center gap-[10px] mb-3">
    <Logo variant="primary" size={22} />
    <div className="font-serif text-[15px] italic font-medium text-forest-800">
      Field guide says…
    </div>
  </div>
  <p className="text-[14px] text-bark-800 leading-relaxed">
    {/* AI-generated body copy in Field guide voice */}
  </p>
  <div className="flex gap-2 mt-4 flex-wrap items-center">
    {/* Action buttons — typically primary additions + secondary "Tell me more" + tertiary "Dismiss" */}
  </div>
</div>
```

### App header / navigation

Forest-800 background, cream wordmark, muted nav links (forest-200), active link in full bone-200. User avatar on far right as sunset-600 circle with cream initial.

```tsx
<header className="bg-forest-800 px-6 py-3.5 flex items-center justify-between">
  <div className="flex items-center gap-2.5">
    <Logo variant="inverse" size={28} />
    <span className="font-serif text-xl font-medium text-bone-200 tracking-[0.005em]">
      Traverse
    </span>
  </div>
  <nav className="flex items-center gap-[26px]">
    <a className="text-[13px] text-bone-200 font-medium" href="/trips">Trips</a>
    <a className="text-[13px] text-forest-200 hover:text-bone-200" href="/map">Map</a>
    <a className="text-[13px] text-forest-200 hover:text-bone-200" href="/discover">Discover</a>
    <div className="w-7 h-7 rounded-full bg-sunset-600 text-sunset-50 flex items-center justify-center text-xs font-medium">
      E
    </div>
  </nav>
</header>
```

### Paper-map illustration

The product's route view is an illustrative SVG, not a tile-based map. Aesthetic principles:

- **Background:** bone-100 paper feel
- **Contour lines:** thin forest-200 strokes (0.75px, opacity 35–55%) suggesting subtle topography
- **Rivers:** thick sky-300 strokes (~7px, opacity 55%) with italic serif label inline
- **Route:** 3px sunset-600 stroke with `stroke-linecap="round"`, smooth bezier through all stops
- **Stop pins:** filled forest-800 circles with bone-50 stroke ring (1.5px) and small inner bone-50 dot
- **Destination pin:** sunset-600 fill with white X mark instead of dot
- **Compass rose:** small circle (r=14) in upper-right, cream fill, half-orange/half-bark needle, italic serif "N" label above
- **Scale bar:** bottom-left, ~60px wide with tick marks, italic serif "10 miles" label
- **Title plate:** top-left, italic serif location name with mono "plate xiv"-style label tracked beneath

Reference path for a meandering 4-stop route across a 600×300 viewBox (Leavenworth → Atchison shape):

```svg
<path
  d="M 60 220 C 100 210 130 185 190 165 S 280 145 320 135 S 440 110 510 95"
  fill="none"
  stroke="#D87B3F"
  stroke-width="3"
  stroke-linecap="round"
/>
```

If you later want a real interactive map, use **MapLibre GL** or **Mapbox GL** with a custom style sheet: soft beige base, muted greens for land, sky-300 water, sunset-600 route lines. The paper-illustration aesthetic above sets the visual target.

---

## 8. Voice and content

### Tone qualities

- Reverent toward landscape, time, and place
- Specific and observational ("the light at a certain hour", "what's blooming this week")
- Unhurried — uses words like "worth," "consider," "if you're not in a rush"
- Avoids exclamation points, emoji, and hype language
- Second person ("your route", "your trip") without being chummy

### Copy examples

**Empty states**
- ✓ "No trips yet. Add a destination and we'll build the rest."
- ✗ "Get started by creating your first trip!"

**Loading**
- ✓ "Plotting the route…"
- ✓ "Looking up overlooks near you…"
- ✗ "Loading..."

**Errors**
- ✓ "Couldn't reach the routing service. Try again in a moment."
- ✗ "Oops! Something went wrong 😕"

**Confirmations**
- ✓ "Stop added. The route was rerouted around it."
- ✗ "✅ Success!"

**AI assistant suggestions**
- ✓ "There's a longer route through Weston if you have an extra hour."
- ✓ "Want me to slot either of them in?"
- ✗ "Would you like me to add this incredible suggestion?"

### Capitalization

- Sentence case for all UI labels, headings, button text, microcopy
- Proper nouns keep natural capitalization
- Avoid acronyms in UI labels where possible — spell out "minutes" rather than "min" except in mono metadata where the constraint is real

### Tagline reservation

"Field guide · open road" appears only in brand-moment treatments. Don't use it in standard app headers or as a perpetual subtitle.

---

## 9. Implementation notes

### Recommended stack

- Next.js (App Router) or Vite + React Router
- TypeScript
- Tailwind CSS v3 (v4 works with config migration)
- `next/font` for font loading
- shadcn/ui as a component baseline, themed with brand tokens
- For maps later: MapLibre GL (open-source) or Mapbox GL (paid)

### Mode strategy

The brand is designed for a single cream-paper light mode. A dark mode would require new semantic mappings (forest-800 as surface, bone-200 as text, etc.) — not specified here. Defer dark mode until light mode ships.

### Accessibility

| Pairing | Contrast | Verdict |
| --- | --- | --- |
| forest-900 on bone-50 | ~14:1 | AAA |
| forest-800 on bone-50 | ~10:1 | AAA |
| bone-200 on forest-800 | ~13:1 | AAA |
| bark-600 on bone-50 | ~7:1 | AAA |
| sunset-800 on bone-50 | ~5.5:1 | AA |
| sunset-600 on bone-50 | ~3.4:1 | UI only — large text, icons, decorative |
| bone-600 on bone-50 | ~3.2:1 | UI only — non-essential tertiary text |

**Practical implication:** never use sunset-600 or bone-600 for body-size reading text on cream. Use bark-600 or forest-800 instead. Reserve sunset-600 for accents, route lines, badges, and large UI elements like buttons.

### Asset checklist

- [ ] Logo SVG: `primary`, `inverse`, `mono-dark`, `mono-light`
- [ ] Favicon set: 16, 32, 192, 512 (use simplified mark at 16px)
- [ ] Apple touch icon: 180px
- [ ] OG image: 1200×630, hero lockup on forest-800
- [ ] Theme color meta tag: `<meta name="theme-color" content="#1F4332">`

### Project structure suggestion

```
src/
  app/
    layout.tsx          # Font loading, root metadata
    globals.css         # CSS custom properties (section 3)
  components/
    ui/
      Logo.tsx          # The Logo component (section 2)
      Button.tsx        # Primary/secondary/tertiary variants
      Card.tsx          # List item, hero, AI assistant patterns
    icons.tsx           # Icon set (section 6)
    map/
      PaperMap.tsx      # Illustrative SVG route view
      RoutePath.tsx     # Bezier route renderer
  styles/
    typography.css      # Type scale utility classes
tailwind.config.js      # Brand color extensions
```

### Out of scope

These are deliberately not specified — design as needed:

- Dark mode token mapping
- Print and export styles
- Email template typography (use sans for body, serif for headlines)
- Marketing site (separate from the product itself)
- Detailed motion/animation tokens (default to 150ms ease for hover/state transitions for now)

---

## Appendix: Quick-reference summary

**Five brand colors:** Forest (#1F4332), Bone (#EBE0C9), Sunset (#D87B3F), Sky (#3D5A6E), Bark (#5C4031). Plus Embers (#A82F1F) for danger.

**Three fonts:** Fraunces (serif), Inter (sans), JetBrains Mono (mono). Two weights: 400 and 500.

**Two visual moves that carry the brand:** the circular badge mark with mountain + sun, and the paper-map illustrative style.

**One voice:** Field guide — observational, unhurried, specific, reverent.

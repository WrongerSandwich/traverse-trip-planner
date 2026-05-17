# Logo specification — addendum

**Status:** Supersedes **Section 2 (Logo)** of `traverse-design-spec.md`.

This replaces the original mountain mark with the open-road mark. Have Claude Code overwrite Section 2 of the main spec with the content below, or keep this as a standalone addendum — the section is self-contained.

No other section of `traverse-design-spec.md` is affected. The companion `traverse-dark-mode-spec.md` also needs **no changes**: its logo guidance (the app header and hero are mode-independent forest; use the `inverse` variant on dark surfaces) remains correct for the new mark.

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

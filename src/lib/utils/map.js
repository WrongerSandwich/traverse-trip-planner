// Shared map primitives — extracted from TripDetailMap and CandidatesMap
// so the two surfaces (and any future map consumer) speak one visual
// language. Per the TripMap shape brief: one tile source, one set of
// icon factories that read CSS tokens at runtime (so Leaflet's
// scoped-CSS-escape-hatch DOM picks up theme changes), one place to tune
// the tile filter recipe.

/**
 * Standard OSM raster tile layer. Centralized so a future Stadia or
 * custom-tile migration is one edit instead of N.
 *
 * @param {*} L - Leaflet runtime
 * @returns {*} a configured L.tileLayer
 */
export function mapTileLayer(L) {
  return L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 });
}

// ── Token readers ──
//
// Leaflet renders divIcon HTML strings outside Svelte's scoped CSS reach,
// so token lookup happens at runtime via getComputedStyle against the
// documentElement. The fallbacks mirror the light-mode token values in
// app.css — they exist so SSR or pre-stylesheet-hydration calls don't
// produce empty strings, but in practice every browser path resolves the
// real var.

export function readToken(name, fallback = '') {
  if (typeof window === 'undefined') return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

export function readSurfacePage() { return readToken('--surface-page', '#FCFAF5'); }
export function readAccent()      { return readToken('--accent', '#D87B3F'); }
export function readBone600()     { return readToken('--bone-600', '#9A8A6F'); }
export function readForest800()   { return readToken('--forest-800', '#1F4332'); }

const CATEGORIES = ['historic','cultural','food','entertainment','outdoors','view','quirky','shopping','misc'];

/**
 * Resolve the brand-family color for every stop category in one pass.
 * Used once at map mount; the result is stable per theme so re-resolving
 * on each pin draw is wasteful.
 *
 * @returns {Record<string, string>}
 */
export function readCategoryColors() {
  const out = {};
  for (const c of CATEGORIES) out[c] = readToken(`--cat-${c}`, '#5F5341');
  return out;
}

// ── Icon factories ──
//
// All pins use the same circular base — sized + colored differently per
// role. The optional ring carries the in-plan accent (CandidatesMap
// pattern); the optional label carries the numbered stop (brochure
// pattern, currently unused on these surfaces but kept for the merged
// component's mode coverage).

/**
 * Build a circular divIcon. Reads --surface-page for the border so the
 * pin's ring tracks the page surface in dark mode automatically.
 *
 * @param {*} L
 * @param {{
 *   size?: number,
 *   color: string,
 *   label?: string|number|null,
 *   ringColor?: string|null,
 *   ringWidth?: number,
 *   cursor?: string
 * }} opts
 * @returns {*} an L.divIcon
 */
export function makeCircleIcon(L, opts) {
  const size = opts.size ?? 14;
  const color = opts.color;
  const surface = readSurfacePage();
  const ringSelector = opts.ringColor
    ? `box-shadow: 0 0 0 ${opts.ringWidth ?? 2.5}px ${opts.ringColor}, 0 1px 4px rgba(0,0,0,.3);`
    : `box-shadow: 0 1px 4px rgba(0,0,0,.3);`;
  const labelMarkup = opts.label != null
    ? `<span style="
        position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
        font-family: var(--font-sans, 'Inter', sans-serif);
        font-size:${Math.max(10, Math.round(size * 0.5))}px;
        font-weight:700;color:${surface};line-height:1;">${opts.label}</span>`
    : '';
  return L.divIcon({
    className: '',
    html: `<div class="tm-pin tm-pin--circle" style="
      position:relative;
      width:${size}px;height:${size}px;background:${color};
      border:2px solid ${surface};border-radius:50%;
      ${ringSelector}
      transition: transform 0.18s cubic-bezier(.22,1,.36,1);
      transform-origin: center;
      ${opts.cursor ? `cursor:${opts.cursor};` : ''}">${labelMarkup}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

/**
 * Build a square divIcon — the lodging-pin shape from CandidatesMap.
 * Differentiates lodging from stops by form, not color.
 *
 * @param {*} L
 * @param {{ size?: number, color: string, ringColor?: string|null, ringWidth?: number, cursor?: string }} opts
 * @returns {*}
 */
export function makeSquareIcon(L, opts) {
  const size = opts.size ?? 14;
  const surface = readSurfacePage();
  const ringSelector = opts.ringColor
    ? `box-shadow: 0 0 0 ${opts.ringWidth ?? 2.5}px ${opts.ringColor}, 0 1px 4px rgba(0,0,0,.3);`
    : `box-shadow: 0 1px 4px rgba(0,0,0,.3);`;
  return L.divIcon({
    className: '',
    html: `<div class="tm-pin tm-pin--square" style="
      width:${size}px;height:${size}px;background:${opts.color};
      border:2px solid ${surface};border-radius:3px;
      ${ringSelector}
      transition: transform 0.18s cubic-bezier(.22,1,.36,1);
      transform-origin: center;
      ${opts.cursor ? `cursor:${opts.cursor};` : ''}"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

/**
 * Make a small neutral home marker. Used by overview mode where home is
 * a quiet spatial anchor, not a primary affordance.
 *
 * @param {*} L
 * @returns {*}
 */
export function makeHomeIcon(L) {
  const surface = readSurfacePage();
  const color = readBone600();
  return L.divIcon({
    className: '',
    html: `<div class="tm-pin tm-pin--home" style="
      width:8px;height:8px;background:${color};
      border:2px solid ${surface};border-radius:50%;
      box-shadow: 0 1px 3px rgba(0,0,0,.3);
      opacity: 0.85;"></div>`,
    iconSize: [8, 8],
    iconAnchor: [4, 4],
  });
}

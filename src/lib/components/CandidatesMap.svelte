<script>
  // Section-scoped map for the CandidatesSection. Pins every candidate
  // (stops + lodging) on a single canvas, colored by category for stops
  // and a distinct shape for lodging. In-plan candidates get an accent
  // ring so the user can see at a glance which parts of the wide net
  // they've already pulled into the Plan.
  //
  // Two-way hover sync with the candidate card list above:
  //   - External `hoveredId` prop pulses the matching pin (card → map)
  //   - Pin mouseenter/leave calls `onHover(id | null)` (map → card)
  //   - Pin click calls `onClick(id)` so the parent can scroll the card
  //     into view + flash it
  //
  // Visual choices follow the candidates-section shape brief:
  //   - Stops: round pins colored by `--cat-{category}` (read from
  //     :root via getComputedStyle since Leaflet divIcons render outside
  //     Svelte's scoped CSS reach)
  //   - Lodging: square pins in --bone-600 (neutral) — they're
  //     differentiated by form, not color
  //   - In-plan: 2.5px accent-colored ring around the pin
  //   - Hovered: ~30% scale-up + soft drop shadow
  //
  // OSM tiles with a CSS filter that harmonizes them with the bone/forest
  // palette. Stadia migration is parked as a follow-up (would need a tile
  // proxy or Stadia domain-whitelist config).

  import { onMount, untrack } from 'svelte';

  let {
    stops = [],
    lodging = [],
    home = null,
    destination = null,
    promotedIds = new Set(),
    hoveredId = null,
    onHover = () => {},
    onClick = () => {},
    visibleCategories = null,
  } = $props();

  let mapEl;
  let mapInstance = $state(null);
  // Pin handles keyed by candidate id so we can address them from
  // external hover state without re-iterating the markers list.
  /** @type {Map<string, { marker: any, baseHtml: string, isStop: boolean }>} */
  let pinsById = new Map();
  let LRef = $state(null);

  // Resolved category colors are computed once from CSS custom properties
  // on the documentElement. The brand palette is stable per theme, so
  // recomputing on every render is wasteful.
  function readCategoryColors() {
    const css = getComputedStyle(document.documentElement);
    const cats = ['historic','cultural','food','entertainment','outdoors','view','quirky','shopping','misc'];
    const out = {};
    for (const c of cats) out[c] = css.getPropertyValue(`--cat-${c}`).trim() || '#5F5341';
    return out;
  }
  function readAccent() {
    return getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#D87B3F';
  }
  function readBone600() {
    return getComputedStyle(document.documentElement).getPropertyValue('--bone-600').trim() || '#9A8A6F';
  }

  onMount(() => {
    let cancelled = false;

    (async () => {
      const L = (await import('leaflet')).default;
      if (cancelled || !mapEl) return;
      LRef = L;

      const initialCenter = destination || home || [39.8283, -98.5795];
      const map = L.map(mapEl, {
        center: initialCenter,
        zoom: 9,
        zoomControl: true,
        scrollWheelZoom: false,
        attributionControl: false,
      });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
      mapInstance = map;

      drawPins(L, map);
      fitToCandidates(L, map);
    })();

    return () => {
      cancelled = true;
      mapInstance?.remove();
      mapInstance = null;
      pinsById = new Map();
    };
  });

  // Redraw pins when the candidate set or its in-plan/visibility state
  // changes. `untrack(mapInstance)` avoids re-entering this effect when
  // we set mapInstance during the initial mount.
  $effect(() => {
    const map = mapInstance;
    const L = LRef;
    if (!map || !L) return;
    // Touch the reactive inputs so Svelte re-runs the effect.
    stops; lodging; promotedIds; visibleCategories;
    untrack(() => {
      clearPins();
      drawPins(L, map);
    });
  });

  // External hover (from a card mouseenter) → pulse the matching pin.
  $effect(() => {
    const id = hoveredId;
    untrack(() => {
      for (const [pinId, entry] of pinsById) {
        const el = entry.marker.getElement?.();
        if (!el) continue;
        if (pinId === id) el.classList.add('candidate-pin--hovered');
        else el.classList.remove('candidate-pin--hovered');
      }
    });
  });

  function clearPins() {
    for (const { marker } of pinsById.values()) marker.remove();
    pinsById = new Map();
  }

  function drawPins(L, map) {
    const catColors = readCategoryColors();
    const accent = readAccent();
    const bone600 = readBone600();

    // Visible filter: null = all categories, Set = only those.
    const passesFilter = (category) => {
      if (!visibleCategories) return true;
      return visibleCategories.has(category);
    };

    // Stops — round pin, category-colored.
    for (const s of stops) {
      if (s.hidden) continue;
      if (!coordsOf(s)) continue;
      if (!passesFilter(s.category)) continue;
      const color = catColors[s.category] || catColors.misc;
      const promoted = promotedIds.has(s.id);
      const { html, baseHtml } = stopPinHtml(color, accent, promoted);
      const icon = L.divIcon({
        className: '',
        html,
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      });
      const marker = L.marker(coordsOf(s), { icon, title: s.name, keyboard: true });
      attachInteractions(marker, s.id);
      marker.addTo(map);
      pinsById.set(s.id, { marker, baseHtml, isStop: true });
    }

    // Lodging — square pin, neutral bone, differentiated by SHAPE not color.
    // (Lodging doesn't have a category; the cards diverge structurally.)
    for (const l of lodging) {
      if (l.hidden) continue;
      if (!coordsOf(l)) continue;
      const promoted = promotedIds.has(l.id);
      const { html, baseHtml } = lodgingPinHtml(bone600, accent, promoted);
      const icon = L.divIcon({
        className: '',
        html,
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      });
      const marker = L.marker(coordsOf(l), { icon, title: l.name, keyboard: true });
      attachInteractions(marker, l.id);
      marker.addTo(map);
      pinsById.set(l.id, { marker, baseHtml, isStop: false });
    }

    // Home + destination anchors are render-only; no hover/click sync.
    if (Array.isArray(destination) && destination.length === 2) {
      L.marker(destination, {
        icon: L.divIcon({
          className: '',
          html: `<div style="
            width:10px;height:10px;background:${getComputedStyle(document.documentElement).getPropertyValue('--forest-800').trim()};
            border:2px solid var(--surface-page, #FCFAF5);border-radius:50%;
            box-shadow:0 1px 3px rgba(0,0,0,.35);"></div>`,
          iconSize: [10, 10],
          iconAnchor: [5, 5],
        }),
        title: 'Destination',
        keyboard: false,
      }).addTo(map);
    }
    if (Array.isArray(home) && home.length === 2) {
      L.marker(home, {
        icon: L.divIcon({
          className: '',
          html: `<div style="
            width:8px;height:8px;background:${bone600};
            border:2px solid var(--surface-page, #FCFAF5);border-radius:50%;
            opacity:0.75;"></div>`,
          iconSize: [8, 8],
          iconAnchor: [4, 4],
        }),
        title: 'Home',
        keyboard: false,
      }).addTo(map);
    }
  }

  function attachInteractions(marker, id) {
    marker.on('mouseover', () => onHover(id));
    marker.on('mouseout', () => onHover(null));
    marker.on('click', () => onClick(id));
    marker.on('keypress', (e) => {
      if (e.originalEvent?.key === 'Enter' || e.originalEvent?.key === ' ') onClick(id);
    });
  }

  function stopPinHtml(color, accent, promoted) {
    const ring = promoted
      ? `box-shadow:0 0 0 2.5px ${accent}, 0 1px 4px rgba(0,0,0,.35);`
      : `box-shadow:0 1px 4px rgba(0,0,0,.35);`;
    const baseHtml = `<div class="candidate-pin candidate-pin--stop" style="
      width:14px;height:14px;background:${color};
      border:2px solid var(--surface-page, #FCFAF5);border-radius:50%;
      ${ring}
      transition: transform 0.18s cubic-bezier(.22,1,.36,1);
      transform-origin: center;
      cursor:pointer;"></div>`;
    return { html: baseHtml, baseHtml };
  }

  function lodgingPinHtml(color, accent, promoted) {
    const ring = promoted
      ? `box-shadow:0 0 0 2.5px ${accent}, 0 1px 4px rgba(0,0,0,.35);`
      : `box-shadow:0 1px 4px rgba(0,0,0,.35);`;
    const baseHtml = `<div class="candidate-pin candidate-pin--lodging" style="
      width:14px;height:14px;background:${color};
      border:2px solid var(--surface-page, #FCFAF5);border-radius:3px;
      ${ring}
      transition: transform 0.18s cubic-bezier(.22,1,.36,1);
      transform-origin: center;
      cursor:pointer;"></div>`;
    return { html: baseHtml, baseHtml };
  }

  function coordsOf(c) {
    const lat = Number(c?.coords?.lat);
    const lng = Number(c?.coords?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return [lat, lng];
  }

  function fitToCandidates(L, map) {
    const points = [];
    for (const s of stops) { const p = coordsOf(s); if (p) points.push(p); }
    for (const l of lodging) { const p = coordsOf(l); if (p) points.push(p); }
    if (Array.isArray(destination) && destination.length === 2) points.push(destination);
    if (Array.isArray(home) && home.length === 2) points.push(home);
    if (points.length < 2) return;
    const bounds = L.latLngBounds(points);
    map.fitBounds(bounds, { padding: [24, 24], maxZoom: 12, animate: false });
  }
</script>

<div bind:this={mapEl} class="candidates-map" aria-label="Candidate locations map"></div>

<style>
  .candidates-map {
    width: 100%;
    height: 100%;
    background: var(--map-tile-bg);
    border-radius: 4px;
    overflow: hidden;
  }
  .candidates-map :global(.leaflet-container) {
    background: var(--map-tile-bg);
    font-family: var(--font-sans);
  }
  /* OSM tiles harmonized toward the bone/forest palette without losing
     legibility. Subtle desaturation + warm-shift; the map should feel
     like a hand-toned atlas, not a stock raster. */
  .candidates-map :global(.leaflet-tile-pane) {
    filter: saturate(0.82) hue-rotate(-6deg) brightness(0.98) sepia(0.05);
  }
  /* Pulse-on-hover for externally-controlled hover state from cards.
     Pure transform so the animation is GPU-friendly; class added/removed
     by the $effect that watches the `hoveredId` prop. */
  .candidates-map :global(.candidate-pin--hovered) {
    transform: scale(1.35);
    z-index: 1000;
  }
</style>

<script>
  // Unified map for the trip-detail page and the Candidates section.
  // Replaces TripDetailMap + CandidatesMap per the TripMap shape brief.
  //
  // The two former components drifted into different visual languages
  // (different tile filters, marker grammars, interactivity treatments,
  // aria conventions). Merging closes that gap and propagates the best
  // of each: CandidatesMap's interactivity + token-aware colors + accent
  // rings, TripDetailMap's lifecycle-aware `tripColor` and dashed-spoke
  // fallback.
  //
  // The `mode` prop drives what's pinned and what's interactive:
  //   - 'overview':  destination (popup w/ drive meta) + home + route or spoke
  //   - 'candidates': stops + lodging pins with bidirectional hover sync
  //
  // Brochure mode is explicitly out of scope this pass (brochure has its
  // own PaperMap / DestinationMap path); revisit if/when those migrate.

  import { onMount, untrack } from 'svelte';
  import {
    mapTileLayer,
    makeCircleIcon,
    makeSquareIcon,
    makeHomeIcon,
    readAccent,
    readBone600,
    readForest800,
    readCategoryColors,
  } from '$lib/utils/map.js';

  let {
    mode = 'overview',
    // ── overview-mode props ──
    trip = null,
    color = null,           // tripColor (stage-aware); falls back to forest-800
    driveLabel = null,      // pre-formatted "8 hr" string (parent owns formatting)
    homeDistanceMi = null,
    // ── waypoints-missing hint (overview mode, planning stage only) ──
    showWaypointHint = false,  // true when trip is planning-stage with no usable waypoints
    onResearch = null,         // () => void — fires the research action
    onEditOverview = null,     // () => void — opens the overview section edit
    // ── candidates-mode props ──
    stops = [],
    lodging = [],
    destination = null,     // [lat, lng] anchor (candidates mode); overview uses trip._coords
    home = null,
    promotedIds = new Set(),
    hoveredId = null,
    onHover = () => {},
    onClick = () => {},
    visibleCategories = null,
  } = $props();

  let mapEl;
  let mapInstance = $state(null);
  let LRef = $state(null);
  /** @type {Map<string, { marker: any }>} */
  let pinsById = new Map();

  // ── Computed anchors used by both modes ──────────────────────────────
  const destCoords = $derived.by(() => {
    if (mode === 'overview') return Array.isArray(trip?._coords) ? trip._coords : null;
    return Array.isArray(destination) ? destination : null;
  });
  const homeCoords = $derived(Array.isArray(home) ? home : null);

  // ── Mount ────────────────────────────────────────────────────────────
  onMount(() => {
    let cancelled = false;

    (async () => {
      const L = (await import('leaflet')).default;
      if (cancelled || !mapEl) return;
      LRef = L;

      const initialCenter = destCoords || homeCoords || [39.8283, -98.5795];
      const map = L.map(mapEl, {
        center: initialCenter,
        zoom: 9,
        zoomControl: true,
        scrollWheelZoom: false,
        // OSM's ODbL effectively requires attribution; surface it at
        // half-opacity in the corner rather than stripping it entirely.
        attributionControl: true,
      });
      mapTileLayer(L).addTo(map);
      mapInstance = map;

      if (mode === 'overview') {
        await drawOverview(L, map);
      } else if (mode === 'candidates') {
        drawCandidatesPins(L, map);
        fitToCandidates(L, map);
      }
    })();

    return () => {
      cancelled = true;
      mapInstance?.remove();
      mapInstance = null;
      pinsById = new Map();
    };
  });

  // ── Candidates mode: redraw when reactive inputs change ──────────────
  $effect(() => {
    if (mode !== 'candidates') return;
    const map = mapInstance;
    const L = LRef;
    if (!map || !L) return;
    // Touch the reactive inputs so Svelte re-runs the effect.
    stops; lodging; promotedIds; visibleCategories;
    untrack(() => {
      clearPins();
      drawCandidatesPins(L, map);
    });
  });

  // ── Candidates mode: external hover (card → pin) ─────────────────────
  $effect(() => {
    if (mode !== 'candidates') return;
    const id = hoveredId;
    untrack(() => {
      for (const [pinId, entry] of pinsById) {
        const el = entry.marker.getElement?.();
        if (!el) continue;
        if (pinId === id) el.classList.add('tm-pin--hovered');
        else el.classList.remove('tm-pin--hovered');
      }
    });
  });

  function clearPins() {
    for (const { marker } of pinsById.values()) marker.remove();
    pinsById = new Map();
  }

  function coordsOf(c) {
    const lat = Number(c?.coords?.lat);
    const lng = Number(c?.coords?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return [lat, lng];
  }

  // ── Overview mode ────────────────────────────────────────────────────
  // Destination is the brand-defining marker — lifecycle-tinted via
  // tripColor, sized larger than candidates pins, carries a popup with
  // drive metadata. Home is a quiet bone-toned dot. Route polyline
  // is fetched lazily through /api/route/[slug]; falls back to a dashed
  // home→destination spoke when no real route geometry is available.
  async function drawOverview(L, map) {
    if (!destCoords) return;
    const tripColor = color || readForest800();

    // Destination — clickable popup with drive meta.
    const destMarker = L.marker(destCoords, {
      icon: makeCircleIcon(L, { size: 14, color: tripColor, cursor: 'pointer' }),
      title: trip?.title || '',
      keyboard: true,
    });
    const popupHtml = buildOverviewPopup();
    if (popupHtml) {
      destMarker.bindPopup(popupHtml, {
        closeButton: true,
        autoPan: true,
        className: 'tm-popup',
      });
    }
    destMarker.addTo(map);

    // Home — small bone dot, non-interactive.
    let homeMarker = null;
    if (homeCoords) {
      homeMarker = L.marker(homeCoords, {
        icon: makeHomeIcon(L),
        title: 'Home',
        keyboard: false,
      }).addTo(map);
    }

    // Route geometry — lazy fetch through /api/route/<slug>.
    let routeCoords = null;
    if (trip?._has_route && trip?._slug) {
      try {
        const res = await fetch(`/api/route/${encodeURIComponent(trip._slug)}`);
        if (res.ok) {
          const body = await res.json();
          if (Array.isArray(body?.coords) && body.coords.length > 1) {
            routeCoords = body.coords;
          }
        }
      } catch {/* network blip — fall through to the dashed spoke */}
    }

    if (routeCoords) {
      L.polyline(routeCoords, {
        color: tripColor,
        weight: 5,
        opacity: 0.95,
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(map);
    } else if (homeCoords) {
      // No real route geometry: signal the connection with a dashed
      // straight line. Tooltip names it explicitly so the user doesn't
      // mistake the spoke for the actual driving route.
      const spoke = L.polyline([homeCoords, destCoords], {
        color: tripColor,
        weight: 2,
        opacity: 0.5,
        dashArray: '4 6',
      }).addTo(map);
      spoke.bindTooltip('Route not yet researched', {
        direction: 'top',
        offset: [0, -4],
        opacity: 0.95,
      });
    }

    // Fit bounds — include destination + home + the route's terminals.
    const points = [destCoords];
    if (homeCoords) points.push(homeCoords);
    if (routeCoords) points.push(routeCoords[0], routeCoords[routeCoords.length - 1]);
    if (points.length > 1) {
      map.fitBounds(L.latLngBounds(points), { padding: [24, 24], maxZoom: 12, animate: false });
    }
  }

  function buildOverviewPopup() {
    if (!trip) return null;
    const title = trip.title ? `<strong class="tm-popup-title">${escapeHtml(trip.title)}</strong>` : '';
    const lines = [];
    if (driveLabel) lines.push(`<span class="tm-popup-line">${escapeHtml(driveLabel)} drive</span>`);
    if (homeDistanceMi != null) lines.push(`<span class="tm-popup-line">${escapeHtml(String(homeDistanceMi))} mi from home</span>`);
    const body = lines.length ? `<div class="tm-popup-body">${lines.join('<br>')}</div>` : '';
    if (!title && !body) return null;
    return `<div class="tm-popup-inner">${title}${body}</div>`;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ── Candidates mode ──────────────────────────────────────────────────
  // Pins per visible candidate, colored by category for stops, neutral
  // bone-tone for lodging (differentiated by shape, not color, mirroring
  // the StopCard/LodgingCard divergence). In-plan candidates get an
  // accent ring. Bidirectional hover sync with the card list.
  function drawCandidatesPins(L, map) {
    const catColors = readCategoryColors();
    const accent = readAccent();
    const bone600 = readBone600();

    const passesFilter = (category) => {
      if (!visibleCategories) return true;
      return visibleCategories.has(category);
    };

    // Stops
    for (const s of stops) {
      if (s.hidden) continue;
      const at = coordsOf(s);
      if (!at) continue;
      if (!passesFilter(s.category)) continue;
      const color = catColors[s.category] || catColors.misc;
      const promoted = promotedIds.has(s.id);
      const icon = makeCircleIcon(L, {
        size: 14,
        color,
        ringColor: promoted ? accent : null,
        cursor: 'pointer',
      });
      const marker = L.marker(at, { icon, title: s.name, keyboard: true });
      attachCandidateInteractions(marker, s.id);
      marker.addTo(map);
      pinsById.set(s.id, { marker });
    }

    // Lodging
    for (const l of lodging) {
      if (l.hidden) continue;
      const at = coordsOf(l);
      if (!at) continue;
      const promoted = promotedIds.has(l.id);
      const icon = makeSquareIcon(L, {
        size: 14,
        color: bone600,
        ringColor: promoted ? accent : null,
        cursor: 'pointer',
      });
      const marker = L.marker(at, { icon, title: l.name, keyboard: true });
      attachCandidateInteractions(marker, l.id);
      marker.addTo(map);
      pinsById.set(l.id, { marker });
    }

    // Anchors — destination + home are quiet here (not the focus).
    if (Array.isArray(destination) && destination.length === 2) {
      L.marker(destination, {
        icon: makeCircleIcon(L, { size: 10, color: readForest800() }),
        title: 'Destination',
        keyboard: false,
      }).addTo(map);
    }
    if (homeCoords) {
      L.marker(homeCoords, {
        icon: makeHomeIcon(L),
        title: 'Home',
        keyboard: false,
      }).addTo(map);
    }
  }

  function attachCandidateInteractions(marker, id) {
    marker.on('mouseover', () => onHover(id));
    marker.on('mouseout', () => onHover(null));
    marker.on('click', () => onClick(id));
    marker.on('keypress', (e) => {
      if (e.originalEvent?.key === 'Enter' || e.originalEvent?.key === ' ') onClick(id);
    });
  }

  function fitToCandidates(L, map) {
    // Home is intentionally excluded — including it stretches the bounds
    // so far that the candidates themselves become unreadable. The home
    // marker is still drawn; it just falls outside the initial viewport.
    const points = [];
    for (const s of stops) { const p = coordsOf(s); if (p) points.push(p); }
    for (const l of lodging) { const p = coordsOf(l); if (p) points.push(p); }
    if (Array.isArray(destination) && destination.length === 2) points.push(destination);
    if (points.length < 2) return;
    map.fitBounds(L.latLngBounds(points), { padding: [24, 24], maxZoom: 12, animate: false });
  }

  // ── Accessibility ────────────────────────────────────────────────────
  const ariaLabel = $derived(
    mode === 'overview'
      ? `Trip map: ${trip?.title || trip?._slug || 'trip'}`
      : 'Candidate locations map'
  );
</script>

<div class="trip-map-wrap">
  <div
    bind:this={mapEl}
    class="trip-map"
    class:trip-map--overview={mode === 'overview'}
    class:trip-map--candidates={mode === 'candidates'}
    role="region"
    aria-label={ariaLabel}
  ></div>

  {#if showWaypointHint && mode === 'overview'}
    <div class="waypoint-hint" role="status" aria-live="polite">
      <p class="waypoint-hint-copy">No route line — this trip is missing waypoints.</p>
      <div class="waypoint-hint-actions">
        {#if onResearch}
          <button
            class="btn btn-secondary btn-compact waypoint-hint-btn"
            onclick={onResearch}
            type="button"
          >
            Run Research →
          </button>
        {/if}
        {#if onEditOverview}
          <button
            class="btn btn-tertiary btn-compact waypoint-hint-btn"
            onclick={onEditOverview}
            type="button"
          >
            Edit overview
          </button>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  /* Wrapper holds both the map canvas and the hint overlay in a stacking
     context so the overlay can sit over the map without disrupting the map's
     own z-index layers (Leaflet controls, popups, etc.).
     `isolation: isolate` is what actually establishes that stacking context —
     position:relative alone does not. Without it, Leaflet's internal panes and
     controls (z-index up to 1000) compete at the root level and paint OVER app
     chrome like the sticky header. Isolating here fixes it for every map
     consumer (overview, candidates, rail) at the source. */
  .trip-map-wrap {
    position: relative;
    isolation: isolate;
    width: 100%;
    height: 100%;
  }

  .trip-map {
    width: 100%;
    height: 100%;
    background: var(--map-tile-bg);
    border-radius: 4px;
    overflow: hidden;
  }
  .trip-map :global(.leaflet-container) {
    background: var(--map-tile-bg);
    font-family: var(--font-sans);
  }
  /* Single tile-filter recipe applied to both modes. Replaces the
     previous split — TripDetailMap inheriting a global rule from
     app.css while CandidatesMap defined its own. Tuning leans bone /
     forest for the trip-planner register. */
  .trip-map :global(.leaflet-tile-pane) {
    filter: saturate(0.82) hue-rotate(-6deg) brightness(0.98) sepia(0.05);
  }
  /* Hover state for pins driven externally by the parent (card → pin
     pulse in candidates mode). Pure transform so the animation is
     GPU-friendly. */
  .trip-map :global(.tm-pin--hovered) {
    transform: scale(1.35);
    z-index: 1000;
  }
  /* OSM attribution — half-opacity, bottom-right, no chrome */
  .trip-map :global(.leaflet-control-attribution) {
    background: color-mix(in oklab, var(--surface-page) 65%, transparent);
    color: var(--text-tertiary);
    font-size: 9px;
    padding: 0 4px;
    opacity: 0.6;
  }
  .trip-map :global(.leaflet-control-attribution a) {
    color: var(--text-secondary);
  }
  /* Destination-marker popup (overview mode). The default Leaflet popup
     chrome reads as a SaaS tooltip; restyle to match the trip-planner
     editorial register. */
  .trip-map :global(.tm-popup .leaflet-popup-content-wrapper) {
    background: var(--surface-page);
    color: var(--text-primary);
    border-radius: 5px;
    border: 1px solid var(--border-default);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  }
  .trip-map :global(.tm-popup .leaflet-popup-tip) {
    background: var(--surface-page);
    border: 1px solid var(--border-default);
  }
  .trip-map :global(.tm-popup-inner) {
    font-family: var(--font-sans);
    padding: 0.15rem 0.25rem;
    min-width: 9rem;
  }
  .trip-map :global(.tm-popup-title) {
    display: block;
    font-family: var(--font-serif);
    font-size: 0.96rem;
    font-weight: 500;
    color: var(--text-primary);
    margin-bottom: 0.25rem;
    line-height: 1.25;
  }
  .trip-map :global(.tm-popup-body) {
    font-size: 0.78rem;
    color: var(--text-secondary);
    line-height: 1.45;
  }
  .trip-map :global(.tm-popup-line) {
    color: var(--text-secondary);
  }

  /* ── Waypoints-missing empty-state hint ─────────────────────────────── */
  /* Subtle bottom overlay — informs without blocking map interaction.
     Uses a scrim (rgba) over photographic content per the CSS-literal
     exception in CLAUDE.md; all other values reference tokens. */
  .waypoint-hint {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: 500;
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    padding: 0.6rem 0.75rem 0.7rem;
    background: color-mix(in oklab, var(--surface-overlay) 88%, transparent);
    backdrop-filter: blur(3px);
    border-top: 1px solid var(--border-subtle);
    border-radius: 0 0 4px 4px;
    pointer-events: auto;
  }

  .waypoint-hint-copy {
    margin: 0;
    font-size: 0.75rem;
    line-height: 1.4;
    color: var(--text-secondary);
    font-family: var(--font-sans);
  }

  .waypoint-hint-actions {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .waypoint-hint-btn {
    /* Lift above Leaflet controls (z-index 400–1000) so the buttons are
       always clickable when the hint is visible. */
    position: relative;
    z-index: 1;
  }
</style>

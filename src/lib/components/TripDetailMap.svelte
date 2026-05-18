<script>
  // Route-aware single-trip map for the trip detail page (planning/completed
  // views, and any future surface that wants the same shape).
  //
  // Renders:
  //   - destination marker (always)
  //   - home marker if `home` coords are passed
  //   - the OSRM route line for trips where `_has_route === true`, fetched
  //     lazily via /api/route/<slug> (server caches via .route-cache.json)
  //   - a faint dashed spoke from home → destination when no route is
  //     available, so an idea-stage or just-promoted planning trip still has
  //     some spatial story
  //   - numbered stop pins from a brochure's `stops[]`, when supplied
  //
  // No popups, no click handlers, no panel triggers — the trip detail page
  // already wraps this. The map is a viewer here.

  import { onMount } from 'svelte';

  let {
    trip,
    home = null,
    stops = null,
    color = '#2D5840',
    interactive = true,
  } = $props();

  let mapEl;

  // Single-trip map, so we don't need a layer registry like OverviewMap. Just
  // the map instance plus a teardown handle for the route fetch.
  onMount(() => {
    if (!trip || !Array.isArray(trip._coords)) return;

    let map;
    let cancelled = false;

    (async () => {
      const L = (await import('leaflet')).default;
      if (cancelled) return;

      map = L.map(mapEl, {
        center: trip._coords,
        zoom: 9,
        zoomControl: interactive,
        dragging: interactive,
        touchZoom: interactive,
        scrollWheelZoom: false,
        doubleClickZoom: interactive,
        keyboard: interactive,
        attributionControl: false,
      });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);

      // ── Markers ───────────────────────────────────────────────────────
      const destMarker = L.marker(trip._coords, {
        icon: makeDestIcon(L, color),
        keyboard: false,
        title: trip.title || trip._slug,
      }).addTo(map);

      let homeMarker = null;
      if (Array.isArray(home) && home.length === 2) {
        homeMarker = L.marker(home, {
          icon: makeHomeIcon(L),
          keyboard: false,
          title: 'Home',
        }).addTo(map);
      }

      // ── Stops (brochure-generated, numbered) ──────────────────────────
      const stopMarkers = [];
      if (Array.isArray(stops)) {
        let n = 0;
        for (const s of stops) {
          const lat = Number(s?.lat);
          const lon = Number(s?.lon);
          if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
          n += 1;
          const m = L.marker([lat, lon], {
            icon: makeStopIcon(L, color, n),
            keyboard: false,
            title: s.name || `Stop ${n}`,
          }).addTo(map);
          stopMarkers.push(m);
        }
      }

      // ── Route geometry ────────────────────────────────────────────────
      // Lazy fetch — server caches via .route-cache.json so this is fast
      // after the first hit. Falls back to a faint dashed home → dest
      // spoke if no route is available (idea-stage or just-promoted trips).
      let routeLine = null;
      let spokeLine = null;
      let routeCoords = null;

      if (trip._has_route && trip._slug) {
        try {
          const res = await fetch(`/api/route/${encodeURIComponent(trip._slug)}`);
          if (!cancelled && res.ok) {
            const body = await res.json();
            if (Array.isArray(body?.coords) && body.coords.length > 1) {
              routeCoords = body.coords;
            }
          }
        } catch {/* network blip — fall through to the dashed spoke */}
      }

      if (cancelled) return;

      if (routeCoords) {
        routeLine = L.polyline(routeCoords, {
          color,
          weight: 4,
          opacity: 0.8,
          lineCap: 'round',
          lineJoin: 'round',
        }).addTo(map);
      } else if (homeMarker) {
        // No real route geometry: signal the connection with a dashed straight
        // line. Same pattern OverviewMap uses for trips without a fetched route.
        spokeLine = L.polyline([home, trip._coords], {
          color,
          weight: 2,
          opacity: 0.45,
          dashArray: '4 6',
        }).addTo(map);
      }

      // ── Fit bounds ────────────────────────────────────────────────────
      // Include everything that's visible. If only the destination is
      // plotted, leave the default zoom-9 framing in place.
      const points = [];
      points.push(trip._coords);
      if (homeMarker) points.push(home);
      for (const m of stopMarkers) points.push(m.getLatLng());
      if (routeCoords) {
        // First and last route points are enough — the destination + home are
        // already included.
        points.push(routeCoords[0], routeCoords[routeCoords.length - 1]);
      }

      if (points.length > 1) {
        const bounds = L.latLngBounds(points);
        map.fitBounds(bounds, { padding: [24, 24], maxZoom: 12, animate: false });
      }
    })();

    return () => {
      cancelled = true;
      map?.remove();
    };
  });

  // ── Icon builders ─────────────────────────────────────────────────────
  // Inline-styled divIcons match the pattern used by MiniMap and OverviewMap.
  // No external CSS dependencies; each marker is a self-contained DOM node.

  function makeDestIcon(L, c) {
    const size = 14;
    return L.divIcon({
      className: '',
      html: `<div style="
        width:${size}px;height:${size}px;background:${c};
        border:2px solid #fff;border-radius:50%;
        box-shadow:0 1px 4px rgba(0,0,0,.4);"></div>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    });
  }

  function makeHomeIcon(L) {
    const size = 10;
    // Muted bone-on-forest mark so home sits clearly below the destination
    // in visual weight without disappearing.
    return L.divIcon({
      className: '',
      html: `<div style="
        width:${size}px;height:${size}px;background:#9A8A6F;
        border:2px solid #fff;border-radius:50%;
        box-shadow:0 1px 3px rgba(0,0,0,.35);"></div>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    });
  }

  function makeStopIcon(L, c, n) {
    // Number-only pin in stage color. Category-aware coloring is intentionally
    // skipped here; the brochure page is where the legend lives.
    const size = 22;
    return L.divIcon({
      className: '',
      html: `<div style="
        width:${size}px;height:${size}px;background:${c};
        border:2px solid #fff;border-radius:50%;
        box-shadow:0 1px 4px rgba(0,0,0,.4);
        display:flex;align-items:center;justify-content:center;
        font-family:'Inter',sans-serif;font-size:11px;font-weight:700;color:#fff;
        line-height:1;">${n}</div>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    });
  }
</script>

<div bind:this={mapEl} class="trip-detail-map" class:interactive></div>

<style>
  .trip-detail-map {
    width: 100%;
    height: 100%;
    background: var(--map-tile-bg);
  }
  .trip-detail-map :global(.leaflet-container) {
    background: var(--map-tile-bg);
    font-family: var(--font-sans);
  }
</style>

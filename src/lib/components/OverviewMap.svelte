<script>
  import { onMount } from 'svelte';
  import { tripColor } from '$lib/utils/colors.js';

  let { trips = [], home = null, hoveredSlug = null, selectedSlug = null, onTripClick } = $props();

  const markerColor = tripColor;

  let mapEl;
  let L;
  let map;
  let spokesGroup;   // LayerGroup — remove()/addTo() hides/shows all spokes atomically
  let mapReady = $state(false);

  // Per-session route coords cache. Server ships only `_has_route: bool` to
  // avoid 40 KB-per-route SSR bloat; we fetch the actual geometry on hover.
  // slug → coords[] | null (= no route) | 'pending'
  let routeCoordsCache = $state({});

  // Marker click "pins" a trip — route stays drawn until the user clicks
  // empty map space or another marker. The popup's "Open details →" button
  // is what actually opens the side panel. This split lets touch users
  // explore routes without the panel covering the screen.
  let pinnedSlug = $state(null);

  function ensureRouteCoords(slug) {
    if (routeCoordsCache[slug] !== undefined) return;
    routeCoordsCache[slug] = 'pending';
    fetch(`/api/route/${encodeURIComponent(slug)}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { routeCoordsCache[slug] = data?.coords ?? null; })
      .catch(() => { routeCoordsCache[slug] = null; });
  }
  function getRouteCoords(slug) {
    const v = routeCoordsCache[slug];
    return Array.isArray(v) ? v : null;
  }

  const markers  = {}; // slug → { marker, trip, line }
  let driveBounds         = null;
  let routeLine           = null;
  let activeSpokeHighlight = null; // temporary spoke shown for drive trips without an OSRM route

  let returnArmed    = false;
  let returnArmTimer = null;
  let routeRevealTimer = null; // delayed registration so interrupted-animation moveend fires first

  function armReturn() {
    clearTimeout(returnArmTimer);
    returnArmed = false;
    returnArmTimer = setTimeout(() => { returnArmed = true; }, 50);
  }
  function disarm() {
    clearTimeout(returnArmTimer);
    returnArmTimer = null;
    returnArmed = false;
  }
  function cancelRouteReveal() {
    clearTimeout(routeRevealTimer);
    routeRevealTimer = null;
  }

  function scheduleRouteReveal(capturedLine, capturedSpoke) {
    routeRevealTimer = setTimeout(function waitForSettle() {
      routeRevealTimer = null;
      map.once('moveend', function onSettle() {
        if (routeLine === capturedLine && routeLine) {
          routeLine.setStyle({ opacity: 0.8 });
          if (capturedSpoke) capturedSpoke.setStyle({ opacity: 0 });
        }
      });
    }, 50);
  }
  function hideSpokes()    { spokesGroup?.remove(); }
  function restoreSpokes() {
    if (activeSpokeHighlight) { map.removeLayer(activeSpokeHighlight); activeSpokeHighlight = null; }
    if (spokesGroup && !map.hasLayer(spokesGroup)) spokesGroup.addTo(map);
    if (routeLine) routeLine.setStyle({ opacity: 0.8 });
    // Re-hide the active trip's spoke if it has a route (spokesGroup.addTo re-showed it)
    const activeSlug = hoveredSlug ?? pinnedSlug ?? selectedSlug;
    const active = activeSlug ? markers[activeSlug] : null;
    if (active?.line && active.trip._has_route && getRouteCoords(activeSlug)) {
      active.line.setStyle({ opacity: 0 });
    }
  }

  function makeIcon(color, hovered) {
    const size = hovered ? 20 : 12;
    const shadow = hovered
      ? '0 0 0 3px rgba(255,255,255,0.85), 0 2px 10px rgba(0,0,0,0.45)'
      : '0 1px 4px rgba(0,0,0,.4)';
    return L.divIcon({
      className: '',
      html: `<div style="width:${size}px;height:${size}px;background:${color};border:2px solid #fff;border-radius:50%;box-shadow:${shadow};transition:width .15s,height .15s,box-shadow .15s"></div>`,
      iconSize: [size, size], iconAnchor: [size / 2, size / 2],
    });
  }

  onMount(() => {
    let destroyed = false;
    (async () => {
      L = (await import('leaflet')).default;
      if (destroyed) return;

      map = L.map(mapEl, { zoomControl: true, scrollWheelZoom: false, attributionControl: false });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);

      spokesGroup = L.layerGroup().addTo(map);

      if (home?.coords) {
        const [lat, lon] = home.coords;
        L.marker([lat, lon], {
          icon: L.divIcon({
            className: '',
            html: `<div style="width:14px;height:14px;background:#1F4332;border:2.5px solid #FCFAF5;border-radius:50%;box-shadow:0 1px 5px rgba(0,0,0,.45)"></div>`,
            iconSize: [14, 14], iconAnchor: [7, 7],
          }),
          zIndexOffset: 1000,
        })
          .bindPopup(`<div class="map-popup"><strong>${home.city}</strong><small>Home base</small></div>`)
          .addTo(map);
      }

      map.on('moveend', () => {
        if (returnArmed) { returnArmed = false; restoreSpokes(); }
      });

      // Click on empty map area unpins (marker clicks don't bubble here).
      map.on('click', () => { pinnedSlug = null; map.closePopup(); });

      // Delegated handler for the "Open details →" button rendered inside popups.
      map.on('popupopen', e => {
        const btn = e.popup.getElement()?.querySelector('.map-popup-open');
        if (!btn) return;
        btn.onclick = ev => {
          ev.stopPropagation();
          const trip = markers[btn.dataset.slug]?.trip;
          if (trip) onTripClick?.(trip);
        };
      });

      mapReady = true;
    })();
    return () => { destroyed = true; map?.remove(); };
  });

  // Rebuild markers + spokes whenever trips change.
  $effect(() => {
    if (!mapReady || !L) return;
    const currentTrips = trips;

    disarm();
    cancelRouteReveal();
    if (routeLine)           { map.removeLayer(routeLine);           routeLine           = null; }
    if (activeSpokeHighlight){ map.removeLayer(activeSpokeHighlight); activeSpokeHighlight = null; }

    // Clear old markers and spokes
    Object.values(markers).forEach(({ marker }) => map.removeLayer(marker));
    Object.keys(markers).forEach(k => delete markers[k]);
    spokesGroup.clearLayers();

    const drivePoints = [];
    if (home?.coords) drivePoints.push(home.coords);

    currentTrips.forEach(trip => {
      if (!Array.isArray(trip._coords)) return;
      const [lat, lon] = trip._coords;
      const color = markerColor(trip);

      drivePoints.push([lat, lon]);

      // Spokes go into spokesGroup so they can be hidden/shown as one unit
      let line = null;
      if (home?.coords) {
        line = L.polyline([home.coords, [lat, lon]], {
          color, weight: 1.5, opacity: 0.35, dashArray: '5, 6',
        }).addTo(spokesGroup);
      }

      const marker = L.marker([lat, lon], { icon: makeIcon(color, false) })
        .bindPopup(L.popup({ closeButton: false }).setContent(
          `<div class="map-popup"><strong>${trip.title || trip._slug}</strong>` +
          `<small>${trip.destination || ''}</small>` +
          `<button class="map-popup-open" data-slug="${trip._slug}">Open details →</button></div>`
        ))
        .on('click', () => { pinnedSlug = trip._slug; })
        .addTo(map);

      markers[trip._slug] = { marker, trip, line };
    });

    if (drivePoints.length > 1) {
      driveBounds = L.latLngBounds(drivePoints);
      map.fitBounds(driveBounds, { padding: [48, 32], maxZoom: 8 });
    } else if (drivePoints.length === 1) {
      driveBounds = null;
      map.setView(drivePoints[0], 6);
    }
  });

  // Hover/select/pin: icons + map movement.
  // Priority: live hover > pinned-via-marker-click > parent-driven selection.
  let prevEffective = null;
  $effect(() => {
    if (!mapReady || !L) return;
    const hovered = hoveredSlug ?? pinnedSlug ?? selectedSlug;

    const prevEntry = prevEffective ? markers[prevEffective] : null;
    const currEntry = hovered       ? markers[hovered]       : null;
    const currHasDriveDest = Array.isArray(currEntry?.trip._coords) && home?.coords;
    const prevHasDriveDest = Array.isArray(prevEntry?.trip._coords);

    // Marker icons
    if (prevEntry) { prevEntry.marker.setIcon(makeIcon(markerColor(prevEntry.trip), false)); prevEntry.marker.setZIndexOffset(0); }
    if (currEntry) { currEntry.marker.setIcon(makeIcon(markerColor(currEntry.trip), true)); currEntry.marker.setZIndexOffset(500); currEntry.marker.openPopup(); }
    else           { map?.closePopup(); }

    // Route line (solid, from waypoints) — drawn at opacity 0 then faded in
    // after the zoom settles. Cancel any pending reveal from a previous hover.
    cancelRouteReveal();
    if (prevEntry?.line) prevEntry.line.setStyle({ opacity: 0.35 });
    if (routeLine) { map.removeLayer(routeLine); routeLine = null; }
    if (currEntry?.trip._has_route) {
      // Kick off the lazy fetch if we haven't seen this slug yet. When the
      // cache updates, this $effect re-runs and the coords will be available.
      if (routeCoordsCache[hovered] === undefined) ensureRouteCoords(hovered);
    }
    const currCoords = currEntry?.trip._has_route ? getRouteCoords(hovered) : null;
    if (currCoords && currCoords.length >= 2) {
      // Hide this trip's spoke so it doesn't show through the route line.
      if (currEntry.line) currEntry.line.setStyle({ opacity: 0 });
      // Active route is always sunset-600 per spec §7 — a single accent
      // signaling "this is the route under inspection", regardless of stage.
      routeLine = L.polyline(currCoords, {
        color: '#D87B3F',
        weight: 3,
        opacity: 0,
        lineCap: 'round',
        lineJoin: 'round',
        className: 'route-line',
      }).addTo(map);
      // Delay 50ms then listen for moveend. The delay lets any
      // interrupted-animation moveend fire first so we only catch B's zoom settling.
      scheduleRouteReveal(routeLine, currEntry?.line);
    }

    // Camera
    if (activeSpokeHighlight) { map.removeLayer(activeSpokeHighlight); activeSpokeHighlight = null; }

    if (currHasDriveDest) {
      // ── Drive trip: zoom in, hide all other spokes, show only this trip's line ──
      disarm();
      hideSpokes();

      // No route coords available right now (either trip has none, or its
      // route is still being fetched) — draw a temporary spoke as a stand-in.
      // Reveal it on moveend so it doesn't appear pre-move in the wrong viewport.
      if (!currCoords && home?.coords) {
        activeSpokeHighlight = L.polyline(
          [home.coords, currEntry.trip._coords],
          { color: markerColor(currEntry.trip), weight: 2, opacity: 0, dashArray: '5, 6', className: 'spoke-highlight' }
        ).addTo(map);
        map.once('moveend', () => {
          if (activeSpokeHighlight) activeSpokeHighlight.setStyle({ opacity: 0.55 });
        });
      }

      map.flyToBounds(
        L.latLngBounds([home.coords, currEntry.trip._coords]),
        { padding: [60, 60], maxZoom: 9, duration: 0.6, easeLinearity: 0.5 }
      );
      // Do NOT call armReturn here — the zoom's own moveend must not trigger restoreSpokes.
      // armReturn is called in the return condition below when hover ends.

    } else if (prevHasDriveDest && !currHasDriveDest) {
      // ── Drive trip hover ended: zoom back out ──
      if (driveBounds) {
        map.flyToBounds(driveBounds, { padding: [48, 32], maxZoom: 8, duration: 0.75, easeLinearity: 0.5 });
        armReturn();
      }

    } else {
      disarm();
      restoreSpokes();
    }

    prevEffective = hovered;
  });
</script>

<div bind:this={mapEl} class="map"></div>

<style>
  .map { width: 100%; height: 100%; background: var(--map-tile-bg); }
  .map :global(.leaflet-container) { height: 100%; }
  .map :global(.route-line)      { transition: stroke-opacity 0.4s ease; }
  .map :global(.spoke-highlight) { transition: stroke-opacity 0.4s ease; }
</style>

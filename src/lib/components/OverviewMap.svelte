<script>
  import { onMount } from 'svelte';

  let { trips = [], home = null, hoveredSlug = null, selectedSlug = null, onTripClick } = $props();

  const STATUS_COLOR = { idea: '#1e40af', exploring: '#c2570a', planned: '#166534', completed: '#6d28d9' };
  const FLY_COLOR = '#0d9488';
  const markerColor = t => t.fly_in === 'true' ? FLY_COLOR : (STATUS_COLOR[t.status || t._stage] || '#888');

  let mapEl;
  let L;
  let map;
  let spokesGroup;   // LayerGroup — remove()/addTo() hides/shows all spokes atomically
  let mapReady = $state(false);

  const markers  = {}; // slug → { marker, trip, line }
  let driveBounds         = null;
  let flightLine          = null;
  let routeLine           = null;
  let activeSpokeHighlight = null; // temporary spoke shown for drive trips without an OSRM route

  // flyInMode stays true from the moment a fly-in is hovered until the
  // return animation fully settles. This prevents any intermediate hover
  // (e.g. card → space → drive card) from restoring spokes mid-flight.
  let flyInMode      = false;
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
    flyInMode = false;
    if (activeSpokeHighlight) { map.removeLayer(activeSpokeHighlight); activeSpokeHighlight = null; }
    if (spokesGroup && !map.hasLayer(spokesGroup)) spokesGroup.addTo(map);
    if (routeLine) routeLine.setStyle({ opacity: 0.8 });
    // Re-hide the active trip's spoke if it has a route (spokesGroup.addTo re-showed it)
    const active = (hoveredSlug ?? selectedSlug) ? markers[hoveredSlug ?? selectedSlug] : null;
    if (active?.line && active.trip._route_coords?.length >= 2) {
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

  function greatCirclePoints([lat1d, lon1d], [lat2d, lon2d], n = 80) {
    const r = d => d * Math.PI / 180, deg = x => x * 180 / Math.PI;
    const [φ1, λ1, φ2, λ2] = [r(lat1d), r(lon1d), r(lat2d), r(lon2d)];
    const Δ = 2 * Math.asin(Math.sqrt(
      Math.sin((φ2-φ1)/2)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin((λ2-λ1)/2)**2
    ));
    if (Δ < 1e-10) return [[lat1d, lon1d]];
    return Array.from({ length: n + 1 }, (_, i) => {
      const f = i / n, A = Math.sin((1-f)*Δ)/Math.sin(Δ), B = Math.sin(f*Δ)/Math.sin(Δ);
      const x = A*Math.cos(φ1)*Math.cos(λ1) + B*Math.cos(φ2)*Math.cos(λ2);
      const y = A*Math.cos(φ1)*Math.sin(λ1) + B*Math.cos(φ2)*Math.sin(λ2);
      const z = A*Math.sin(φ1)               + B*Math.sin(φ2);
      return [deg(Math.atan2(z, Math.sqrt(x**2+y**2))), deg(Math.atan2(y, x))];
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
            html: `<div style="width:14px;height:14px;background:#2c2c2c;border:2.5px solid #fff;border-radius:50%;box-shadow:0 1px 5px rgba(0,0,0,.5)"></div>`,
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
    if (flightLine)          { map.removeLayer(flightLine);          flightLine          = null; }
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

      if (trip.fly_in !== 'true') drivePoints.push([lat, lon]);

      // Spokes go into spokesGroup so they can be hidden/shown as one unit
      let line = null;
      if (home?.coords) {
        line = L.polyline([home.coords, [lat, lon]], {
          color, weight: 1.5, opacity: 0.35, dashArray: '5, 6',
        }).addTo(spokesGroup);
      }

      const marker = L.marker([lat, lon], { icon: makeIcon(color, false) })
        .bindPopup(L.popup({ closeButton: false }).setContent(
          `<div class="map-popup"><strong>${trip.title || trip._slug}</strong><small>${trip.destination || ''}</small></div>`
        ))
        .on('click', () => onTripClick?.(trip))
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

  // Hover/select: icons + flight arc + map movement.
  // hoveredSlug takes priority; selectedSlug fills in when nothing is hovered.
  let prevEffective = null;
  $effect(() => {
    if (!mapReady || !L) return;
    const hovered = hoveredSlug ?? selectedSlug;

    const prevEntry = prevEffective ? markers[prevEffective] : null;
    const currEntry = hovered       ? markers[hovered]       : null;
    const prevWasFlyIn = prevEntry?.trip.fly_in === 'true';
    const currIsFlyIn  = currEntry?.trip.fly_in === 'true';
    const currHasDriveDest = !currIsFlyIn && Array.isArray(currEntry?.trip._coords) && home?.coords;
    const prevHasDriveDest = !prevWasFlyIn && Array.isArray(prevEntry?.trip._coords);

    // Marker icons
    if (prevEntry) { prevEntry.marker.setIcon(makeIcon(markerColor(prevEntry.trip), false)); prevEntry.marker.setZIndexOffset(0); }
    if (currEntry) { currEntry.marker.setIcon(makeIcon(markerColor(currEntry.trip), true)); currEntry.marker.setZIndexOffset(500); currEntry.marker.openPopup(); }
    else           { map?.closePopup(); }

    // Route line (solid, from waypoints) — drawn at opacity 0 then faded in
    // after the zoom settles. Cancel any pending reveal from a previous hover.
    cancelRouteReveal();
    if (prevEntry?.line && !flyInMode) prevEntry.line.setStyle({ opacity: 0.35 });
    if (routeLine) { map.removeLayer(routeLine); routeLine = null; }
    if (currEntry?.trip._route_coords?.length >= 2) {
      // Hide this trip's spoke so it doesn't show through the route line.
      if (currEntry.line && !flyInMode) currEntry.line.setStyle({ opacity: 0 });
      routeLine = L.polyline(currEntry.trip._route_coords, {
        color: markerColor(currEntry.trip),
        weight: 2.5,
        opacity: 0,
        className: 'route-line',
      }).addTo(map);
      if (currIsFlyIn) {
        // Fly-in: route revealed by restoreSpokes() on return, not here.
        setTimeout(() => {
          if (routeLine && !flyInMode) {
            routeLine.setStyle({ opacity: 0.8 });
            if (currEntry?.line) currEntry.line.setStyle({ opacity: 0 });
          }
        }, 80);
      } else {
        // Drive trip: delay 50ms then listen for moveend. The delay lets any
        // interrupted-animation moveend fire first so we only catch B's zoom settling.
        scheduleRouteReveal(routeLine, currEntry?.line);
      }
    }

    // Arc + camera
    if (flightLine) { map.removeLayer(flightLine); flightLine = null; }
    if (activeSpokeHighlight) { map.removeLayer(activeSpokeHighlight); activeSpokeHighlight = null; }

    if (currIsFlyIn && Array.isArray(currEntry.trip._coords) && home?.coords) {
      // ── Fly-in: arc + zoom out, hide all spokes ──
      flyInMode = true;
      disarm();
      hideSpokes();

      flightLine = L.polyline(greatCirclePoints(home.coords, currEntry.trip._coords), {
        color: '#22c55e', weight: 2.5, opacity: 0, className: 'flight-arc',
      }).addTo(map);
      setTimeout(() => { if (flightLine) flightLine.setStyle({ opacity: 0.9 }); }, 80);

      map.flyToBounds(
        L.latLngBounds([home.coords, currEntry.trip._coords]),
        { padding: [60, 60], maxZoom: 6, duration: 0.75, easeLinearity: 0.5 }
      );

    } else if ((prevWasFlyIn || flyInMode) && !currHasDriveDest) {
      // ── Leaving fly-in (or mid-flight) to nothing ──
      if (driveBounds) {
        map.flyToBounds(driveBounds, { padding: [48, 32], maxZoom: 8, duration: 0.75, easeLinearity: 0.5 });
        armReturn();
      }

    } else if (currHasDriveDest) {
      // ── Drive trip: zoom in, hide all other spokes, show only this trip's line ──
      disarm();
      if (flyInMode) restoreSpokes(); // restore if transitioning from fly-in
      hideSpokes();

      // No OSRM route: draw just this trip's spoke as a temporary overlay.
      // Reveal it on moveend so it doesn't appear pre-move in the wrong viewport.
      if (!currEntry.trip._route_coords?.length && home?.coords) {
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
  .map { width: 100%; height: 100%; background: #ddd8d0; }
  .map :global(.leaflet-container) { height: 100%; }
  .map :global(.flight-arc) { transition: stroke-opacity 0.45s ease; }
  .map :global(.route-line)      { transition: stroke-opacity 0.4s ease; }
  .map :global(.spoke-highlight) { transition: stroke-opacity 0.4s ease; }
</style>

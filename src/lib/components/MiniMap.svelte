<script>
  import { onMount } from 'svelte';

  let { coords, color = '#1F4332', zoom = 8, interactive = false } = $props();

  let mapEl;

  onMount(() => {
    if (!coords) return;
    let map;
    (async () => {
      const L = (await import('leaflet')).default;
      map = L.map(mapEl, {
        center: coords, zoom,
        zoomControl: interactive,
        dragging: interactive,
        touchZoom: interactive,
        scrollWheelZoom: false,
        doubleClickZoom: interactive,
        keyboard: interactive,
        attributionControl: false,
      });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
      L.marker(coords, {
        icon: L.divIcon({
          className: '',
          html: `<div style="width:${interactive ? 12 : 10}px;height:${interactive ? 12 : 10}px;background:${color};border:2px solid var(--surface-page);border-radius:50%;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>`,
          iconSize: [interactive ? 12 : 10, interactive ? 12 : 10],
          iconAnchor: [interactive ? 6 : 5, interactive ? 6 : 5],
        }),
      }).addTo(map);
    })();
    return () => map?.remove();
  });
</script>

<div bind:this={mapEl} class="mini-map" class:interactive></div>

<style>
  .mini-map { width: 100%; height: 100%; background: var(--map-tile-bg); }
  .mini-map :global(.leaflet-container) { background: var(--map-tile-bg); }
</style>

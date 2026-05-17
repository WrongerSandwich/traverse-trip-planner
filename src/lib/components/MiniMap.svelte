<script>
  import { onMount } from 'svelte';

  let { coords, color = '#1F4332', zoom = 8, interactive = false } = $props();

  // OSM tiles are light-mode-only; CartoDB Dark Matter is the free
  // dark counterpart with a similar minimal aesthetic. Both providers
  // require attribution per their terms; we omit attribution UI to
  // match the rest of the app and rely on standard goodwill use for a
  // personal project.
  const TILES_LIGHT = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
  const TILES_DARK  = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';

  let mapEl;

  onMount(() => {
    if (!coords) return;
    let map;
    let tileLayer;
    let observer;
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

      const applyTiles = () => {
        const dark = document.documentElement.dataset.theme === 'dark';
        if (tileLayer) map.removeLayer(tileLayer);
        tileLayer = L.tileLayer(dark ? TILES_DARK : TILES_LIGHT, { maxZoom: 19 }).addTo(map);
      };
      applyTiles();
      observer = new MutationObserver(applyTiles);
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

      L.marker(coords, {
        icon: L.divIcon({
          className: '',
          html: `<div style="width:${interactive ? 12 : 10}px;height:${interactive ? 12 : 10}px;background:${color};border:2px solid var(--surface-page);border-radius:50%;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>`,
          iconSize: [interactive ? 12 : 10, interactive ? 12 : 10],
          iconAnchor: [interactive ? 6 : 5, interactive ? 6 : 5],
        }),
      }).addTo(map);
    })();
    return () => {
      observer?.disconnect();
      map?.remove();
    };
  });
</script>

<div bind:this={mapEl} class="mini-map" class:interactive></div>

<style>
  .mini-map { width: 100%; height: 100%; background: var(--map-tile-bg); }
  .mini-map :global(.leaflet-container) { background: var(--map-tile-bg); }
</style>

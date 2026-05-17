<script>
  import { onMount } from 'svelte';
  import { page } from '$app/stores';

  let { coords, color = '#1F4332', zoom = 8, interactive = false } = $props();

  // Tile providers:
  // - Light: OpenStreetMap default
  // - Dark: Stadia alidade_smooth_dark when STADIA_API_KEY is configured
  //   (softer warm-gray with visible roads/labels), CartoDB Dark Matter
  //   otherwise (near-black, no API key needed). The URL template is
  //   built server-side in src/lib/server/stadia.js and passed through
  //   layout data as `darkTileUrl`.
  // Both providers require attribution; we omit attribution UI to match
  // the rest of the app.
  const TILES_LIGHT = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
  const FALLBACK_DARK = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';

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

      const darkUrl = $page.data.darkTileUrl || FALLBACK_DARK;
      const applyTiles = () => {
        const dark = document.documentElement.dataset.theme === 'dark';
        if (tileLayer) map.removeLayer(tileLayer);
        tileLayer = L.tileLayer(dark ? darkUrl : TILES_LIGHT, { maxZoom: 19 }).addTo(map);
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

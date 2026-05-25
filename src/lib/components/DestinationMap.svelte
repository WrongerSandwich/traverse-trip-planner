<script>
  // Destination-area paper map: a zoomed view of the cluster of stops the
  // trip visits, with numbered pins matching the Stops list in the brochure.
  // Distinct from PaperMap which shows the route from home — this is the
  // "lay of the land where I'm spending time" map, suitable for a brochure
  // centerpiece. Stops without coords are silently skipped from the map but
  // remain in the Stops list.
  //
  // Inputs:
  //   stops       — [{ name, coords: [lat, lon]?, must_see?, … }, …]
  //   destination — string for the title plate (italic Fraunces)
  //   plateLabel  — small mono caption ("plate ii", etc.)

  import { buildProjection, buildMercatorProjection } from '$lib/utils/projection.js';
  import { stateOutlinePaths, riverPaths, placesInBbox } from '$lib/utils/terrain.js';
  import { computeEdgeIndicators, isInViewport } from '$lib/utils/edge-indicators.js';

  let {
    stops = [],
    destination = '',
    plateLabel = 'plate ii',
    // When a Stadia tile mosaic is supplied, the component switches to a
    // Mercator projection matching the tile center+zoom so pin overlays
    // land precisely on landmarks. The server is responsible for the
    // tile-coverage math (src/lib/server/stadia.js); we just place each
    // tile at the {x, y, w, h} SVG position it computed.
    baseMapTiles = null,
    baseMapCenterLat = null,
    baseMapCenterLon = null,
    baseMapZoom = null,
  } = $props();

  const VB_W = 720;
  const VB_H = 480;
  const PAD = 0.12; // slightly more pad than PaperMap; stops sit nearer the edges otherwise

  const hasBaseMap = $derived(
    Array.isArray(baseMapTiles) && baseMapTiles.length > 0 && baseMapCenterLat != null && baseMapZoom != null,
  );

  const located = $derived(
    (stops || [])
      .map((s, i) => ({ ...s, n: i + 1 }))
      .filter(s => Array.isArray(s.coords) && s.coords.length === 2),
  );

  // Two projection paths:
  //  · With a Stadia base map: Mercator matching the tile center+zoom
  //    (pixel-perfect overlay alignment). Native terrain/rivers/places
  //    layers stay off because the base map already provides them with
  //    real density.
  //  · Without: equirectangular illustrative paper map with our own
  //    state outlines, rivers, and curated place labels on bone-100.
  //    Min-span floor expands tight clusters to ~150 mi for context.
  const proj = $derived(
    hasBaseMap
      ? buildMercatorProjection({
          centerLat: baseMapCenterLat,
          centerLon: baseMapCenterLon,
          zoom: baseMapZoom,
          viewBoxW: VB_W,
          viewBoxH: VB_H,
        })
      : located.length >= 1
        ? buildProjection({
            coords: located.map(s => s.coords),
            viewBoxW: VB_W,
            viewBoxH: VB_H,
            padding: PAD,
            minSpanDeg: 2.2,
          })
        : null,
  );

  // Native terrain layers — only used when there's no base map.
  const statePaths = $derived(!hasBaseMap && proj ? stateOutlinePaths(proj, { padDegrees: 1.0 }) : []);
  const rivers = $derived(!hasBaseMap && proj ? riverPaths(proj, { padDegrees: 0.5, maxZoom: 5 }) : []);
  const places = $derived(!hasBaseMap && proj ? placesInBbox(proj, { maxScalerank: 8 }) : []);

  const pixels = $derived(
    proj ? located.map(s => ({ ...s, xy: proj.project(...s.coords) })) : [],
  );

  // Split pins into those inside the visible map and those that fall outside
  // its viewBox at the current zoom. Off-map pins get rendered as small
  // numbered badges clamped to the viewport edge with a chevron pointing
  // toward where the stop actually is — same disambiguation pattern as
  // Google Maps' off-screen markers.

  // Render regulars first, then must-see, so the larger sunset-colored
  // anchors always paint on top when stops cluster within a city block.
  // Tradeoff: one or two regular pins under a must-see may end up
  // partially covered, but must-see stops are the ones a reader scans for
  // first when finding their way around the map.
  const inViewportPins = $derived(
    pixels.filter(p => isInViewport(p.xy, VB_W, VB_H)).sort((a, b) => Number(!!a.must_see) - Number(!!b.must_see)),
  );
  const edgeIndicators = $derived(computeEdgeIndicators(pixels, VB_W, VB_H));

  // Scale bar tuned for a tighter zoom — destination clusters are typically
  // measured in single-digit to tens of miles, not hundreds.
  const scaleBar = $derived.by(() => {
    if (!proj) return null;
    const milesPerUnit = 69 / proj.scale;
    const targetUnits = 80;
    const targetMiles = targetUnits * milesPerUnit;
    const niceValues = [0.5, 1, 2, 5, 10, 25, 50];
    let pick = niceValues[0];
    for (const v of niceValues) if (v <= targetMiles * 1.5) pick = v;
    return { miles: pick, units: pick / milesPerUnit };
  });
</script>

{#if proj && pixels.length}
  <svg
    class="destination-map"
    viewBox="0 0 {VB_W} {VB_H}"
    xmlns="http://www.w3.org/2000/svg"
    role="img"
    aria-label="Stops around {destination}"
  >
    {#if hasBaseMap}
      <!-- Stadia tile mosaic serves as the base layer. Each tile is a
           same-origin proxy URL; the browser composites them natively
           inside the SVG. Clip to the viewBox so partial-edge tiles
           don't bleed past the map frame. -->
      <defs>
        <clipPath id="dest-map-clip">
          <rect x="0" y="0" width={VB_W} height={VB_H} />
        </clipPath>
      </defs>
      <g clip-path="url(#dest-map-clip)">
        {#each baseMapTiles as tile}
          <image href={tile.url} x={tile.x} y={tile.y} width={tile.w} height={tile.h} preserveAspectRatio="none" />
        {/each}
      </g>
    {:else}
      <!-- Illustrative paper background -->
      <rect width={VB_W} height={VB_H} fill="var(--bone-100)" />
      <defs>
        <pattern id="dest-contour" patternUnits="userSpaceOnUse" width="42" height="42" patternTransform="rotate(35)">
          <line x1="0" y1="0" x2="0" y2="42" stroke="var(--forest-200)" stroke-width="0.5" opacity="0.3" />
        </pattern>
      </defs>
      <rect width={VB_W} height={VB_H} fill="url(#dest-contour)" />
    {/if}

    <!-- State outlines for context -->
    {#if statePaths.length}
      <g class="terrain">
        {#each statePaths as path}
          <path d={path} fill="none" stroke="var(--forest-400)" stroke-width="0.75" opacity="0.45" vector-effect="non-scaling-stroke" />
        {/each}
      </g>
    {/if}

    <!-- Major rivers -->
    {#if rivers.length}
      <g class="rivers">
        {#each rivers as r}
          <path d={r.path} fill="none" stroke="var(--sky-200)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.55" vector-effect="non-scaling-stroke" />
        {/each}
      </g>
    {/if}

    <!-- Populated places: small dots + italic serif labels -->
    {#if places.length}
      <g class="places">
        {#each places as p}
          <circle cx={p.xy[0]} cy={p.xy[1]} r={p.scalerank <= 4 ? 2.5 : 1.75} fill="var(--bark-600)" opacity="0.7" />
          {#if p.name}
            <text
              x={p.xy[0] + (p.scalerank <= 4 ? 5 : 4)}
              y={p.xy[1] + 3}
              font-family="var(--font-serif)"
              font-size={p.scalerank <= 4 ? 10 : 8.5}
              font-style="italic"
              fill="var(--bark-600)"
              opacity="0.85"
            >{p.name}</text>
          {/if}
        {/each}
      </g>
    {/if}

    <!-- Numbered stop pins (in-viewport). Class hooks let the mobile
         media query scale up `r` and the inner numeral so pins stay
         legible at ~360px screen width where the 720-unit viewBox
         halves on render. -->
    {#each inViewportPins as pin}
      <g transform="translate({pin.xy[0]} {pin.xy[1]})">
        {#if pin.must_see}
          <circle class="pin-circle pin-circle--must-see" r="12" fill="var(--sunset-600)" stroke="var(--bone-50)" stroke-width="1.5" />
          <text class="pin-num pin-num--must-see" y="3.5" text-anchor="middle" font-family="var(--font-mono)" font-size="10" font-weight="500" fill="var(--sunset-50)">
            {pin.n}
          </text>
        {:else}
          <circle class="pin-circle pin-circle--stop" r="10" fill="var(--forest-800)" stroke="var(--bone-50)" stroke-width="1.5" />
          <text class="pin-num pin-num--stop" y="3" text-anchor="middle" font-family="var(--font-mono)" font-size="9" font-weight="500" fill="var(--bone-200)">
            {pin.n}
          </text>
        {/if}
      </g>
    {/each}

    <!-- Compass rose, top-right -->
    <g transform="translate({VB_W - 38} 40)">
      <circle r="16" fill="var(--bone-100)" stroke="var(--bark-600)" stroke-width="0.75" />
      <path d="M 0 -12 L 4 0 L 0 12 L -4 0 Z" fill="var(--sunset-600)" opacity="0.95" />
      <path d="M 0 0 L 4 0 L 0 12 L -4 0 Z" fill="var(--bark-600)" />
      <text x="0" y="-20" text-anchor="middle" font-family="var(--font-serif)" font-size="11" font-style="italic" fill="var(--bark-600)">N</text>
    </g>

    <!-- Scale bar, bottom-left -->
    {#if scaleBar}
      <g transform="translate(28 {VB_H - 28})">
        <line x1="0" y1="0" x2={scaleBar.units} y2="0" stroke="var(--bark-600)" stroke-width="1.25" />
        <line x1="0" y1="-4" x2="0" y2="4" stroke="var(--bark-600)" stroke-width="1.25" />
        <line x1={scaleBar.units / 2} y1="-3" x2={scaleBar.units / 2} y2="3" stroke="var(--bark-600)" stroke-width="1.25" />
        <line x1={scaleBar.units} y1="-4" x2={scaleBar.units} y2="4" stroke="var(--bark-600)" stroke-width="1.25" />
        <text x={scaleBar.units / 2} y="-9" text-anchor="middle" font-family="var(--font-serif)" font-size="11" font-style="italic" fill="var(--bark-600)">
          {scaleBar.miles < 1 ? `${scaleBar.miles} mi` : `${scaleBar.miles} miles`}
        </text>
      </g>
    {/if}

    <!-- Title plate, bottom-right -->
    {#if destination}
      <g transform="translate({VB_W - 28} {VB_H - 28})">
        <text x="0" y="-12" text-anchor="end" font-family="var(--font-serif)" font-size="15" font-style="italic" fill="var(--forest-800)">
          {destination}
        </text>
        <text x="0" y="2" text-anchor="end" font-family="var(--font-mono)" font-size="9" fill="var(--bone-600)" letter-spacing="0.18em">
          {plateLabel}
        </text>
      </g>
    {/if}

    <!-- Edge indicators for off-viewport pins: rendered last so they paint
         over the compass / scale bar / title plate when they land near
         corners. Slightly smaller numbered badge clamped to the boundary,
         with a chevron pointing outward toward the actual off-map location. -->
    {#each edgeIndicators as pin}
      <g transform="translate({pin.edgeXY[0]} {pin.edgeXY[1]})">
        <g transform="rotate({pin.angleDeg})">
          <path
            d="M 17 0 L 11 -5 M 17 0 L 11 5"
            fill="none"
            stroke={pin.must_see ? 'var(--sunset-600)' : 'var(--forest-800)'}
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </g>
        {#if pin.must_see}
          <circle class="pin-circle pin-circle--edge-must-see" r="10" fill="var(--sunset-600)" stroke="var(--bone-50)" stroke-width="1.5" />
          <text class="pin-num pin-num--edge-must-see" y="3.5" text-anchor="middle" font-family="var(--font-mono)" font-size="9" font-weight="500" fill="var(--sunset-50)">
            {pin.n}
          </text>
        {:else}
          <circle class="pin-circle pin-circle--edge-stop" r="9" fill="var(--forest-800)" stroke="var(--bone-50)" stroke-width="1.5" />
          <text class="pin-num pin-num--edge-stop" y="3" text-anchor="middle" font-family="var(--font-mono)" font-size="9" font-weight="500" fill="var(--bone-200)">
            {pin.n}
          </text>
        {/if}
      </g>
    {/each}
  </svg>
{/if}

<style>
  .destination-map {
    width: 100%;
    height: auto;
    display: block;
    border: 0.5px solid var(--bark-200);
    border-radius: 4px;
  }

  /* On narrow viewports the 720x480 viewBox renders at ~0.5x scale, which
     drops the 9–10pt mono numerals to ~5px. Scale up `r` and inner font
     so pins remain readable on phone. `r` is a CSS property in modern
     browsers; falls back to the SVG attribute where unsupported. */
  @media (max-width: 640px) {
    .destination-map :global(.pin-circle--must-see) { r: 17; }
    .destination-map :global(.pin-circle--stop) { r: 15; }
    .destination-map :global(.pin-circle--edge-must-see) { r: 14; }
    .destination-map :global(.pin-circle--edge-stop) { r: 13; }
    .destination-map :global(.pin-num--must-see) { font-size: 14px; }
    .destination-map :global(.pin-num--stop) { font-size: 13px; }
    .destination-map :global(.pin-num--edge-must-see) { font-size: 12px; }
    .destination-map :global(.pin-num--edge-stop) { font-size: 12px; }
  }
</style>

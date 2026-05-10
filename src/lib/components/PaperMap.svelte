<script>
  // Inline-SVG paper-map illustration per traverse-design-spec.md §7.
  // Used in two roles in the brochure:
  //   1. Cover-inset: small route overview from home to destination
  //   2. (Destination map uses DestinationMap.svelte — different shape)
  //
  // Layers, bottom to top:
  //   bone-100 paper background
  //   forest-200 contour hatching (subtle topo feel)
  //   state outlines (hairline, real US geography)
  //   sunset-600 route polyline
  //   forest-800 waypoint pins + sunset-600 destination pin
  //   compass rose + scale bar + title plate decoration
  //
  // Inputs:
  //   route       — [[lat, lon], …] OSRM polyline (REQUIRED, >= 2 points)
  //   waypoints   — [{ label, coord: [lat, lon] }, …] in route order
  //   destination — string shown in italic on the title plate
  //   plateLabel  — small mono caption beneath the destination
  //   compact     — boolean; smaller viewBox, simpler decoration

  import { buildProjection, pathFromCoords } from '$lib/utils/projection.js';
  import { stateOutlinePaths, riverPaths, placesInBbox } from '$lib/utils/terrain.js';

  let {
    route = [],
    waypoints = [],
    destination = '',
    plateLabel = 'plate i',
    compact = false,
  } = $props();

  const VB_W = $derived(compact ? 480 : 720);
  const VB_H = $derived(compact ? 240 : 432);
  const PAD = 0.08;

  const allCoords = $derived([
    ...(route || []),
    ...(waypoints || []).map(w => w.coord),
  ]);
  const proj = $derived(buildProjection({ coords: allCoords, viewBoxW: VB_W, viewBoxH: VB_H, padding: PAD }));

  const routePath = $derived(proj ? pathFromCoords(route, proj.project) : '');
  const statePaths = $derived(proj ? stateOutlinePaths(proj) : []);
  // Rivers: cap zoom at 4 in compact mode so small streams don't clutter
  // the inset; full mode gets the full curated set.
  const rivers = $derived(proj ? riverPaths(proj, { maxZoom: compact ? 4 : 5 }) : []);
  // Places: regional-route scale wants major cities only (≤4 or 5).
  // Compact (cover-inset) skips labels entirely to avoid clutter.
  const places = $derived(proj && !compact ? placesInBbox(proj, { maxScalerank: 5 }) : []);

  const waypointPixels = $derived(
    proj
      ? (waypoints || []).map(w => ({ label: w.label, xy: proj.project(...w.coord) }))
      : [],
  );

  // Scale bar: pick a nice round mileage whose pixel length lands near ~80
  // viewBox units (or ~50 in compact mode).
  const scaleBar = $derived.by(() => {
    if (!proj) return null;
    const milesPerUnit = 69 / proj.scale;
    const targetUnits = compact ? 50 : 80;
    const targetMiles = targetUnits * milesPerUnit;
    const niceValues = [5, 10, 25, 50, 100, 200, 500];
    let pick = niceValues[0];
    for (const v of niceValues) if (v <= targetMiles * 1.5) pick = v;
    return { miles: pick, units: pick / milesPerUnit };
  });
</script>

{#if proj}
  <svg
    class="paper-map"
    viewBox="0 0 {VB_W} {VB_H}"
    xmlns="http://www.w3.org/2000/svg"
    role="img"
    aria-label="Route map for {destination}"
  >
    <!-- Paper background -->
    <rect width={VB_W} height={VB_H} fill="var(--bone-100)" />

    <!-- Contour hatching: faint diagonal lines suggesting topography -->
    <defs>
      <pattern id="contour" patternUnits="userSpaceOnUse" width="42" height="42" patternTransform="rotate(35)">
        <line x1="0" y1="0" x2="0" y2="42" stroke="var(--forest-200)" stroke-width="0.5" opacity="0.28" />
      </pattern>
    </defs>
    <rect width={VB_W} height={VB_H} fill="url(#contour)" />

    <!-- State outlines: thin forest-400 strokes for real terrain context -->
    {#if statePaths.length}
      <g class="terrain">
        {#each statePaths as path}
          <path d={path} fill="none" stroke="var(--forest-400)" stroke-width="0.75" opacity="0.45" vector-effect="non-scaling-stroke" />
        {/each}
      </g>
    {/if}

    <!-- Major rivers: sky-200 strokes thicker than state hairlines -->
    {#if rivers.length}
      <g class="rivers">
        {#each rivers as r}
          <path d={r.path} fill="none" stroke="var(--sky-200)" stroke-width={compact ? 2 : 2.5} stroke-linecap="round" stroke-linejoin="round" opacity="0.55" vector-effect="non-scaling-stroke" />
        {/each}
      </g>
    {/if}

    <!-- Major cities along the route (full mode only) -->
    {#if places.length}
      <g class="places">
        {#each places as p}
          <circle cx={p.xy[0]} cy={p.xy[1]} r="2.5" fill="var(--bark-600)" opacity="0.7" />
          {#if p.name}
            <text x={p.xy[0] + 5} y={p.xy[1] + 3} font-family="var(--font-serif)" font-size="10" font-style="italic" fill="var(--bark-600)" opacity="0.8">{p.name}</text>
          {/if}
        {/each}
      </g>
    {/if}

    <!-- Route polyline -->
    {#if routePath}
      <path
        d={routePath}
        fill="none"
        stroke="var(--sunset-600)"
        stroke-width={compact ? 2.5 : 3}
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    {/if}

    <!-- Waypoint pins -->
    {#each waypointPixels as wp, i}
      {@const isLast = i === waypointPixels.length - 1}
      <g transform="translate({wp.xy[0]} {wp.xy[1]})">
        {#if isLast}
          <circle r={compact ? 6 : 8} fill="var(--sunset-600)" stroke="var(--bone-50)" stroke-width="1.5" />
          <path d="M -3 -3 L 3 3 M 3 -3 L -3 3" stroke="var(--bone-50)" stroke-width="1.5" stroke-linecap="round" fill="none" />
        {:else}
          <circle r={compact ? 5 : 7} fill="var(--forest-800)" stroke="var(--bone-50)" stroke-width="1.5" />
          <circle r={compact ? 1.5 : 2} fill="var(--bone-50)" />
        {/if}
      </g>
    {/each}

    {#if !compact}
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
            {scaleBar.miles} miles
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
    {/if}
  </svg>
{/if}

<style>
  .paper-map {
    width: 100%;
    height: auto;
    display: block;
    border: 0.5px solid var(--bark-200);
    border-radius: 4px;
  }
</style>

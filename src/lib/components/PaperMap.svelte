<script>
  // Inline-SVG paper-map illustration per traverse-design-spec.md §7.
  // Renders an OSRM route polyline and waypoint pins over a bone-100 paper
  // background with subtle forest-200 contour hatching, a compass rose,
  // a scale bar, and a title plate. No tile fetching; no Leaflet.
  //
  // Inputs:
  //   route       — [[lat, lon], …] OSRM polyline (REQUIRED, >= 2 points)
  //   waypoints   — [{ label, coord: [lat, lon] }, …] in route order
  //   destination — string shown in italic on the title plate
  //   plateLabel  — small mono caption beneath the destination (default "plate i")

  let {
    route = [],
    waypoints = [],
    destination = '',
    plateLabel = 'plate i',
  } = $props();

  const VB_W = 720;
  const VB_H = 432; // 5:3, brochure-friendly
  const PAD = 0.08;

  // Equirectangular projection scaled to fit the viewBox. cos(lat) compensation
  // keeps east-west distances visually proportional to north-south.
  function buildProjection(coords) {
    if (!coords || coords.length < 2) return null;
    let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
    for (const [lat, lon] of coords) {
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
    }
    const centerLat = (minLat + maxLat) / 2;
    const cosLat = Math.cos(centerLat * Math.PI / 180);

    const lonRange = Math.max((maxLon - minLon) * cosLat, 0.0001);
    const latRange = Math.max(maxLat - minLat, 0.0001);

    const padX = VB_W * PAD;
    const padY = VB_H * PAD;
    const innerW = VB_W - 2 * padX;
    const innerH = VB_H - 2 * padY;

    const scale = Math.min(innerW / lonRange, innerH / latRange);
    const usedW = lonRange * scale;
    const usedH = latRange * scale;
    const offsetX = padX + (innerW - usedW) / 2;
    const offsetY = padY + (innerH - usedH) / 2;

    function project(lat, lon) {
      return [
        offsetX + (lon - minLon) * cosLat * scale,
        offsetY + (maxLat - lat) * scale, // SVG y-down → flip
      ];
    }

    return { project, scale, cosLat };
  }

  const allCoords = $derived([
    ...(route || []),
    ...(waypoints || []).map(w => w.coord),
  ]);
  const proj = $derived(buildProjection(allCoords));

  // Route path: M x y L x y L x y …
  const routePath = $derived(() => {
    if (!proj || !route?.length) return '';
    return route.map(([lat, lon], i) => {
      const [x, y] = proj.project(lat, lon);
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join(' ');
  });

  const waypointPixels = $derived(
    proj
      ? (waypoints || []).map(w => ({ label: w.label, xy: proj.project(...w.coord) }))
      : [],
  );

  // Scale bar: pick a nice round mileage whose pixel length lands near 80px.
  // 1 viewBox unit = (1/scale) degrees of cosLat-compensated angle = (1/scale) * 69 miles.
  const scaleBar = $derived.by(() => {
    if (!proj) return null;
    const milesPerUnit = 69 / proj.scale;
    const targetUnits = 80; // aim for ~80 viewBox units
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
      <pattern id="contour" patternUnits="userSpaceOnUse" width="36" height="36" patternTransform="rotate(35)">
        <line x1="0" y1="0" x2="0" y2="36" stroke="var(--forest-200)" stroke-width="0.5" opacity="0.35" />
      </pattern>
    </defs>
    <rect width={VB_W} height={VB_H} fill="url(#contour)" />

    <!-- Route polyline -->
    {#if routePath()}
      <path
        d={routePath()}
        fill="none"
        stroke="var(--sunset-600)"
        stroke-width="3"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    {/if}

    <!-- Waypoint pins -->
    {#each waypointPixels as wp, i}
      {@const isLast = i === waypointPixels.length - 1}
      <g transform="translate({wp.xy[0]} {wp.xy[1]})">
        {#if isLast}
          <!-- Destination: sunset disc + cream X -->
          <circle r="8" fill="var(--sunset-600)" stroke="var(--bone-50)" stroke-width="1.5" />
          <path d="M -3 -3 L 3 3 M 3 -3 L -3 3" stroke="var(--bone-50)" stroke-width="1.5" stroke-linecap="round" fill="none" />
        {:else}
          <!-- Numbered stop: forest disc + bone dot -->
          <circle r="7" fill="var(--forest-800)" stroke="var(--bone-50)" stroke-width="1.5" />
          <circle r="2" fill="var(--bone-50)" />
        {/if}
      </g>
    {/each}

    <!-- Compass rose, top-right -->
    <g transform="translate({VB_W - 38} 40)">
      <circle r="16" fill="var(--bone-100)" stroke="var(--bark-600)" stroke-width="0.75" />
      <!-- N-half needle (sunset), S-half needle (bark) -->
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

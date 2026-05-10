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

  import { buildProjection } from '$lib/utils/projection.js';
  import { stateOutlinePaths, riverPaths, placesInBbox } from '$lib/utils/terrain.js';

  let {
    stops = [],
    destination = '',
    plateLabel = 'plate ii',
  } = $props();

  const VB_W = 720;
  const VB_H = 480;
  const PAD = 0.12; // slightly more pad than PaperMap; stops sit nearer the edges otherwise

  const located = $derived(
    (stops || [])
      .map((s, i) => ({ ...s, n: i + 1 }))
      .filter(s => Array.isArray(s.coords) && s.coords.length === 2),
  );

  // Enforce a minimum bbox span (~150 miles / 2.2° lat) so even when the
  // stops cluster is small or pulled wide by a single outlier, the map
  // shows generous regional context — major cities around the destination,
  // the river network, and state borders. The cluster reads as a small
  // knot of pins in the middle; nearby population centers anchor the
  // reader's sense of place.
  const proj = $derived(
    located.length >= 1
      ? buildProjection({
          coords: located.map(s => s.coords),
          viewBoxW: VB_W,
          viewBoxH: VB_H,
          padding: PAD,
          minSpanDeg: 2.2,
        })
      : null,
  );

  const statePaths = $derived(proj ? stateOutlinePaths(proj, { padDegrees: 1.0 }) : []);
  const rivers = $derived(proj ? riverPaths(proj, { padDegrees: 0.5, maxZoom: 5 }) : []);
  // Places at this regional zoom: scalerank ≤ 8 surfaces small-to-mid cities
  // in the area without flooding the map. Smaller towns aren't in Natural
  // Earth's curated set at any scale; if surfacing every hamlet matters
  // later, ship a US Census Gazetteer-derived layer.
  const places = $derived(proj ? placesInBbox(proj, { maxScalerank: 8 }) : []);

  const pixels = $derived(
    proj ? located.map(s => ({ ...s, xy: proj.project(...s.coords) })) : [],
  );

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
    <!-- Paper background -->
    <rect width={VB_W} height={VB_H} fill="var(--bone-100)" />

    <!-- Contour hatching -->
    <defs>
      <pattern id="dest-contour" patternUnits="userSpaceOnUse" width="42" height="42" patternTransform="rotate(35)">
        <line x1="0" y1="0" x2="0" y2="42" stroke="var(--forest-200)" stroke-width="0.5" opacity="0.3" />
      </pattern>
    </defs>
    <rect width={VB_W} height={VB_H} fill="url(#dest-contour)" />

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

    <!-- Numbered stop pins -->
    {#each pixels as pin}
      <g transform="translate({pin.xy[0]} {pin.xy[1]})">
        {#if pin.must_see}
          <circle r="12" fill="var(--sunset-600)" stroke="var(--bone-50)" stroke-width="1.5" />
          <text y="3.5" text-anchor="middle" font-family="var(--font-mono)" font-size="10" font-weight="500" fill="var(--sunset-50)">
            {pin.n}
          </text>
        {:else}
          <circle r="10" fill="var(--forest-800)" stroke="var(--bone-50)" stroke-width="1.5" />
          <text y="3" text-anchor="middle" font-family="var(--font-mono)" font-size="9" font-weight="500" fill="var(--bone-200)">
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
</style>

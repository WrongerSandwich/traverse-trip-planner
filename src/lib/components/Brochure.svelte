<script>
  import { renderMarkdown } from '$lib/sanitize.js';
  import Logo from '$lib/components/Logo.svelte';
  import PaperMap from '$lib/components/PaperMap.svelte';
  import DestinationMap from '$lib/components/DestinationMap.svelte';

  let { data } = $props();

  const trip = $derived(data.trip);
  const files = $derived(data.files || {});
  const route = $derived(data.route);
  const waypointCoords = $derived(data.waypointCoords || []);
  const hasMap = $derived(Array.isArray(route) && route.length >= 2 && waypointCoords.length >= 2);

  // When derive-brochure produced a structured shape from plan + candidates,
  // render against it. Otherwise fall back to raw planning sections — trips
  // without a plan yet still get a usable preview.
  const brochure = $derived(data.brochureData ?? null);
  const isStructured = $derived(!!brochure);

  // Content selection: an itinerary.md is the canonical brochure content
  // when present. Otherwise fall back to the planning sections in lifecycle
  // order — preview-brochure mode for trips still being shaped.
  const hasItinerary = $derived(typeof files.itinerary === 'string' && files.itinerary.trim().length > 0);

  const SECTION_LABELS = {
    overview: 'Overview',
    route: 'Route',
    stops: 'Stops',
    logistics: 'Logistics',
  };
  const SECTION_ORDER = ['overview', 'route', 'stops', 'logistics'];

  const sections = $derived.by(() => {
    if (hasItinerary) {
      return [{ key: 'itinerary', label: 'Itinerary', body: files.itinerary }];
    }
    return SECTION_ORDER
      .filter(k => typeof files[k] === 'string' && files[k].trim().length > 0)
      .map(k => ({ key: k, label: SECTION_LABELS[k], body: files[k] }));
  });

  const renderMd = renderMarkdown;

  // Meta row: date · distance · drive time · duration. JetBrains Mono.
  // Earlier this row included "N stops" pulled from waypoints, but waypoints
  // are routing helpers (cities the road threads through), not destinations
  // the trip stops at — listing them as "stops" misrepresented the trip.
  function fmtDate(iso) {
    if (!iso) return null;
    const d = new Date(`${iso}T00:00:00`);
    if (isNaN(d.getTime())) return null;
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).toLowerCase();
  }
  function fmtDrive(hrs) {
    if (hrs == null) return null;
    return `~${hrs % 1 === 0 ? hrs : hrs.toFixed(1)} hr drive`;
  }
  function fmtDistance(mi) {
    if (mi == null) return null;
    return `${Number(mi).toLocaleString()} mi`;
  }
  function fmtDuration(days) {
    if (days == null) return null;
    const n = Number(days);
    if (!Number.isFinite(n) || n <= 0) return null;
    return `${n % 1 === 0 ? n : n.toFixed(1)} day${n === 1 ? '' : 's'}`;
  }

  const meta = $derived([
    fmtDate(trip?.target_date),
    fmtDistance(trip?.home_distance_mi),
    fmtDrive(trip?._drive_hours),
    fmtDuration(trip?.duration_days),
  ].filter(Boolean));

  // Compiled date for the attribution line — always today in en-US.
  const compiledLabel = $derived(new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' }));

  // Destination map: only meaningful when the structured render is active
  // and there are stops with geocoded coords. Pre-filtered here so the
  // section header can hide if there's nothing to draw.
  const stopsWithCoords = $derived(
    isStructured && Array.isArray(brochure?.stops)
      ? brochure.stops.filter(s => Array.isArray(s.coords) && s.coords.length === 2)
      : [],
  );
  const hasDestinationMap = $derived(stopsWithCoords.length >= 1);
</script>

<svelte:head>
  <title>{trip?.title || trip?._slug} · Field guide</title>
</svelte:head>

<div class="brochure">
  <!-- Screen-only margin toolbar — quiet mono affordances that let the
       page BE the artifact instead of advertising its printability. The
       sticky forest banner was reading as web-app chrome; this recedes. -->
  <nav class="brochure-toolbar no-print" aria-label="Brochure actions">
    {#if trip?._slug}
      <a class="toolbar-back" href={`/trips/${trip._slug}`}>← back to trip</a>
    {:else}
      <span></span>
    {/if}
    <button class="toolbar-print" onclick={() => window.print()} type="button" aria-label="Print or save as PDF">
      print
    </button>
  </nav>

  <!-- Page 1 — Cover -->
  <section class="cover">
    {#if trip?._image}
      <img
        class="cover-photo"
        src={trip._image.large2x || trip._image.large || trip._image.medium}
        srcset={[
          trip._image.medium && `${trip._image.medium} 350w`,
          trip._image.large && `${trip._image.large} 940w`,
          trip._image.large2x && `${trip._image.large2x} 1880w`,
        ].filter(Boolean).join(', ') || undefined}
        sizes="(max-width: 768px) 100vw, 820px"
        alt=""
      />
    {:else}
      <div class="cover-photo cover-photo--placeholder" aria-hidden="true"></div>
    {/if}

    <div class="cover-plate">
      <Logo variant="inverse" size={34} />
      <h1 class="cover-title">{trip?.title || trip?._slug}</h1>
      {#if meta.length > 0}
        <div class="cover-meta">
          {#each meta as item, i}
            {#if i > 0}<span class="cover-meta-sep" aria-hidden="true">·</span>{/if}
            <span>{item}</span>
          {/each}
        </div>
      {/if}
    </div>
  </section>

  <section class="cover-belt">
    <div class="belt-inner">
      <div class="belt-prose">
        {#if trip?.pitch}<p class="pitch">{trip.pitch}</p>{/if}
        <p class="attribution">
          Compiled by Field guide · {compiledLabel}
        </p>
      </div>

      {#if hasMap}
        <aside class="route-inset" aria-label="Route from home">
          <div class="route-inset-eyebrow">Route from home</div>
          <PaperMap
            {route}
            waypoints={waypointCoords}
            destination={trip?.destination || trip?.title || ''}
            plateLabel="plate i"
            compact
          />
        </aside>
      {/if}
    </div>
  </section>

  {#if isStructured}
    <!-- Structured render derived from plan + candidates.

         Itinerary is the spine: destination map at the top, then stops
         grouped by day with full descriptions. Earlier versions ran a
         names-only Itinerary section (BrochureDayBlocks) followed by a
         flat Stops list with descriptions — the reader had to cross-
         reference. Folding the two together kept the spatial gesture
         (numerals match pins) without telling the same story twice. -->

    {#if brochure.stops?.length}
      {@const pinByName = new Map(brochure.stops.map((s, i) => [s.name, i + 1]))}
      {@const daysWithStops = brochure.days?.filter((d) => d.stops?.length) ?? []}

      <section class="content-page" data-section="itinerary">
        <div class="eyebrow">
          Itinerary
          {#if hasDestinationMap}
            <span class="eyebrow-detail">· {stopsWithCoords.length} of {brochure.stops.length} pinned on map</span>
          {:else}
            <span class="eyebrow-detail">· all unmapped</span>
          {/if}
        </div>

        {#if hasDestinationMap}
          <DestinationMap
            stops={brochure.stops}
            destination={trip?.destination || trip?.title || ''}
            plateLabel="plate ii"
            baseMapUrl={data.destinationBaseMap?.url ?? null}
            baseMapCenterLat={data.destinationBaseMap?.centerLat ?? null}
            baseMapCenterLon={data.destinationBaseMap?.centerLon ?? null}
            baseMapZoom={data.destinationBaseMap?.zoom ?? null}
          />
          <ul class="map-legend" aria-label="Map legend">
            <li class="legend-item">
              <span class="legend-swatch legend-swatch--stop" aria-hidden="true"></span>
              <span>stop</span>
            </li>
            <li class="legend-item">
              <span class="legend-swatch legend-swatch--edge" aria-hidden="true">
                <svg viewBox="0 0 26 12" width="26" height="12">
                  <circle cx="7" cy="6" r="4.5" fill="var(--forest-800)" />
                  <path d="M 19 6 L 14 3 M 19 6 L 14 9" fill="none" stroke="var(--forest-800)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </span>
              <span>off-map direction</span>
            </li>
            <li class="legend-item">
              <span class="legend-swatch legend-swatch--unmapped" aria-hidden="true"></span>
              <span>unmapped (no pin geocoded)</span>
            </li>
          </ul>
        {:else}
          <!-- Dashed hairline reads as "expected content, not yet present"
               without shouting. Mirrors the `plate ii` label so the reader
               recognises this is where the map would live. -->
          <aside class="map-missing" aria-label="Destination map unavailable">
            <span class="map-missing-eyebrow">plate ii · unavailable</span>
            <p class="map-missing-body">Pin geocoding pending. The stops below are listed without map cross-reference.</p>
          </aside>
        {/if}

        {#if daysWithStops.length > 0}
          {#each daysWithStops as day}
            <article class="day-group">
              <header class="day-group-head">
                <span class="day-group-n">Day {day.n}</span>
                {#if day.date}<span class="day-group-date">{day.date}</span>{/if}
              </header>
              <ol class="stops-list">
                {#each day.stops as stop}
                  {@const hasCoords = Array.isArray(stop.coords) && stop.coords.length === 2}
                  {@const n = pinByName.get(stop.name) ?? null}
                  <li class="stop" class:stop--unpinned={!hasCoords}>
                    <span class="stop-n" class:stop-n--unpinned={!hasCoords} aria-hidden="true">{n ?? ''}</span>
                    <div class="stop-body">
                      <div class="stop-head">
                        <span class="stop-name">{stop.name}</span>
                        {#if stop.category}<span class="stop-cat" data-cat={stop.category}>{stop.category}</span>{/if}
                        {#if !hasCoords}<span class="stop-unpinned-tag">unmapped</span>{/if}
                      </div>
                      {#if stop.hours}<div class="stop-hours">{stop.hours}</div>{/if}
                      {#if stop.address}<div class="stop-addr">{stop.address}</div>{/if}
                      {#if stop.notes}<p class="stop-notes">{stop.notes}</p>{/if}
                    </div>
                  </li>
                {/each}
              </ol>
            </article>
          {/each}
        {:else}
          <!-- Stops exist in candidates but none are promoted to a day yet.
               Fall back to the flat list so the brochure still renders. -->
          <ol class="stops-list">
            {#each brochure.stops as stop, i}
              {@const hasCoords = Array.isArray(stop.coords) && stop.coords.length === 2}
              <li class="stop" class:stop--unpinned={!hasCoords}>
                <span class="stop-n" class:stop-n--unpinned={!hasCoords} aria-hidden="true">{i + 1}</span>
                <div class="stop-body">
                  <div class="stop-head">
                    <span class="stop-name">{stop.name}</span>
                    {#if stop.category}<span class="stop-cat" data-cat={stop.category}>{stop.category}</span>{/if}
                    {#if !hasCoords}<span class="stop-unpinned-tag">unmapped</span>{/if}
                  </div>
                  {#if stop.hours}<div class="stop-hours">{stop.hours}</div>{/if}
                  {#if stop.address}<div class="stop-addr">{stop.address}</div>{/if}
                  {#if stop.notes}<p class="stop-notes">{stop.notes}</p>{/if}
                </div>
              </li>
            {/each}
          </ol>
        {/if}
      </section>
    {/if}

    {#if brochure.lodging?.length}
      <section class="content-page" data-section="lodging">
        <div class="eyebrow">Lodging</div>
        <ul class="lodging-list">
          {#each brochure.lodging as lodge}
            <li class="lodge">
              <div class="lodge-head">
                <span class="lodge-name">{lodge.name}</span>
                {#if lodge.nights}<span class="lodge-nights">{lodge.nights} night{Math.abs(Number(lodge.nights) - 1) < 0.0001 ? '' : 's'}</span>{/if}
              </div>
              {#if lodge.address}<div class="lodge-addr">{lodge.address}</div>{/if}
              {#if lodge.confirmation}<div class="lodge-conf">Confirmation · {lodge.confirmation}</div>{/if}
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    {#if brochure.field_guide_notes?.length}
      <section class="content-page" data-section="notes">
        <div class="eyebrow">What to expect</div>
        <ul class="fg-notes">
          {#each brochure.field_guide_notes as note}
            <li>{note}</li>
          {/each}
        </ul>
      </section>
    {/if}

    {#if brochure.gotchas?.length}
      <section class="content-page" data-section="gotchas">
        <div class="eyebrow">Don't forget</div>
        <ul class="gotchas">
          {#each brochure.gotchas as gotcha}
            <li>{gotcha}</li>
          {/each}
        </ul>
      </section>
    {/if}

  {:else}
    <!-- Fallback: raw planning markdown for unprepared trips. No "Section ·"
         prefix — the markdown body already carries its own H2s, so a section
         label alone is sufficient. -->
    {#each sections as section}
      <section class="content-page" data-section={section.key}>
        <div class="eyebrow">{section.label}</div>
        <div class="markdown">{@html renderMd(section.body)}</div>
      </section>
    {/each}
  {/if}

  <!-- Back cover — brand moment + credits -->
  <footer class="back-cover">
    <Logo variant="mono-dark" size={28} />
    <div class="brand-line">
      <span class="brand-rule" aria-hidden="true"></span>
      <span class="brand-tag">Field guide · open road</span>
      <span class="brand-rule" aria-hidden="true"></span>
    </div>
    <div class="back-meta">
      <div>Compiled {compiledLabel} for {trip?.title || trip?._slug}</div>
      {#if trip?._image?.photographer}
        <div>
          Cover photograph by
          {#if trip._image.photographer_url}
            <a href={trip._image.photographer_url} target="_blank" rel="noopener">{trip._image.photographer}</a>
          {:else}
            {trip._image.photographer}
          {/if}
          via Pexels
        </div>
      {/if}
      {#if data.destinationBaseMap}
        <div>
          Destination map tiles by
          <a href="https://stadiamaps.com" target="_blank" rel="noopener">Stadia Maps</a> ·
          style by
          <a href="https://stamen.com" target="_blank" rel="noopener">Stamen Design</a> ·
          data ©
          <a href="https://openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>
        </div>
      {/if}
      <div class="back-mono">traverse · open source · self-hosted</div>
    </div>
  </footer>
</div>


<style>
  /* Token discipline: this component reaches past the semantic role tokens
     (--text-primary, --accent, --border-subtle) into the raw brand ramps
     (--forest-800, --bone-400, --sunset-600, --bark-600). That's
     intentional — the brochure is mode-locked to light via
     `data-theme="light"` on its wrapper, so semantic-token cascades that
     would flip in dark mode are inappropriate here. The whole artifact
     reads as a printed field guide, not a UI surface that adapts.

     Strip the document body to bone — no background colors from the parent.
     Uses a literal paper color (not the theme token) so the brochure always
     renders on cream regardless of the user's color-scheme preference; the
     wrapping <div data-theme="light"> only affects descendants, and body
     sits outside that scope. */
  :global(body) {
    background: #FCFAF5;
  }

  .brochure {
    max-width: 820px;
    margin: 0 auto;
    padding: 1.75rem 0 2.5rem;
    color: var(--text-primary);
    font-family: var(--font-sans);
  }

  /* Screen-only margin toolbar. Reads as a margin annotation, not as
     web-app chrome — mono, lowercase, low contrast. The page itself
     handles the "I am a printable artifact" gesture; this just offers
     the affordance. Hidden in print via .no-print. */
  .brochure-toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    padding: 0 24px;
    margin-bottom: 1.25rem;
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.12em;
    text-transform: lowercase;
    color: var(--bone-600);
  }
  .toolbar-back {
    text-decoration: none;
    color: var(--bone-600);
    padding: 4px 2px;
    transition: color 0.15s ease;
  }
  .toolbar-back:hover,
  .toolbar-back:focus-visible { color: var(--forest-800); }
  .toolbar-print {
    background: transparent;
    border: 0.5px solid var(--bone-400);
    border-radius: 3px;
    padding: 5px 11px;
    font: inherit;
    letter-spacing: inherit;
    text-transform: inherit;
    color: var(--bone-600);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
  }
  .toolbar-print:hover,
  .toolbar-print:focus-visible {
    background: var(--bone-100);
    color: var(--forest-800);
    border-color: var(--forest-800);
  }

  /* ── Cover spread ─────────────────────────────────────────────────── */

  .cover {
    position: relative;
    aspect-ratio: 4 / 3;
    background: var(--forest-800);
    overflow: hidden;
    border-radius: 4px;
  }
  .cover-photo {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .cover-photo--placeholder {
    background: linear-gradient(180deg, var(--forest-600), var(--forest-900));
  }
  .cover-plate {
    position: absolute;
    left: 0; right: 0; bottom: 0;
    background: var(--forest-800);
    color: var(--bone-200);
    padding: 22px 28px 26px;
    display: grid;
    grid-template-columns: auto 1fr;
    column-gap: 16px;
    row-gap: 8px;
    align-items: end;
  }
  .cover-plate :global(svg) { grid-row: 1 / span 2; align-self: end; }
  .cover-title {
    grid-column: 2;
    font-family: var(--font-serif);
    font-size: 38px;
    line-height: 1.05;
    font-weight: 500;
    letter-spacing: 0.005em;
    color: var(--bone-200);
    margin: 0;
    text-wrap: balance;
  }
  .cover-meta {
    grid-column: 2;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0 12px;
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--sunset-600);
    letter-spacing: 0.04em;
  }
  .cover-meta-sep {
    color: var(--bone-400);
  }

  /* ── Below-cover belt (pitch + attribution) ───────────────────────── */

  .cover-belt {
    margin-top: 1.25rem;
    padding: 0 24px;
  }
  .belt-inner {
    display: grid;
    grid-template-columns: 1fr minmax(0, 280px);
    gap: 28px;
    align-items: start;
  }
  .belt-prose { min-width: 0; }
  .route-inset {
    margin: 0;
  }
  .route-inset-eyebrow {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--bone-600);
    margin-bottom: 6px;
  }
  .pitch {
    font-family: var(--font-serif);
    font-size: 19px;
    line-height: 1.55;
    font-style: italic;
    color: var(--bark-800);
    margin: 0 0 1.5rem;
  }
  .attribution {
    font-family: var(--font-sans);
    font-size: 11px;
    line-height: 1.4;
    font-weight: 500;
    letter-spacing: 0.18em;
    text-transform: lowercase;
    color: var(--bone-600);
    margin: 0;
  }

  /* ── Mobile (narrow screens) ──────────────────────────────────────── */

  @media (max-width: 640px) {
    .brochure { padding: 1rem 0 2rem; }
    .cover { aspect-ratio: 3 / 4; border-radius: 0; }
    .cover-plate { padding: 18px 20px 22px; }
    .cover-title { font-size: 28px; }
    .cover-belt { padding: 0 20px; margin-top: 1.5rem; }
    .pitch { font-size: 17px; }

    /* Multi-column dense lists fall back to single column on phones. */
    .lodging-list, .gotchas { columns: 1; }
    /* Stops: tighten the hanging-numeral column so the body has room. */
    .stop { grid-template-columns: 40px 1fr; column-gap: 16px; padding: 14px 0; }
    .stop-n { font-size: 28px; }
    .stop-name { font-size: 18px; }
    /* Cover-belt collapses: pitch above, route inset below. */
    .belt-inner { grid-template-columns: 1fr; gap: 1.25rem; }
    .route-inset { max-width: 320px; }
  }

  /* Section eyebrow — small mono caption used above content sections. */
  .eyebrow {
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--bone-600);
    margin-bottom: 1rem;
  }
  /* Inline secondary text inside an eyebrow — drops the all-caps treatment
     so counts like "9 of 12 pinned on map" read naturally. */
  .eyebrow-detail {
    text-transform: none;
    letter-spacing: 0.04em;
    font-weight: 400;
    color: var(--bone-600);
  }

  /* Legend for the destination map: tiny swatches matching the four pin
     states (must-see / stop / off-map direction / unmapped). Sits between
     the map and the stops list. */
  .map-legend {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem 1.4rem;
    list-style: none;
    padding: 0.7rem 0 0;
    margin: 0;
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.16em;
    color: var(--bone-600);
  }
  .legend-item {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
  }
  .legend-swatch {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 12px;
    height: 12px;
    border-radius: 50%;
  }
  .legend-swatch--stop {
    background: var(--forest-800);
    border: 1px solid var(--bone-50);
  }
  .legend-swatch--unmapped {
    background: transparent;
    border: 1.5px solid var(--bone-400);
  }
  .legend-swatch--edge {
    width: 26px;
    height: 12px;
    border-radius: 0;
    background: none;
  }
  .legend-swatch--edge svg { display: block; }

  /* Destination map missing — quiet editorial empty state.
     Dashed border reads as "expected content, not yet present" without
     shouting. Sits in the slot where DestinationMap would render. */
  .map-missing {
    margin: 0;
    padding: 32px 24px;
    border: 0.5px dashed var(--bone-400);
    border-radius: 4px;
    text-align: center;
  }
  .map-missing-eyebrow {
    display: block;
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--bone-600);
    margin-bottom: 0.6rem;
  }
  .map-missing-body {
    font-family: var(--font-serif);
    font-style: italic;
    font-size: 14px;
    line-height: 1.55;
    color: var(--bark-600);
    margin: 0 auto;
    max-width: 42ch;
  }

  /* ── Page 3+ — itinerary / planning sections ──────────────────────── */

  .content-page {
    margin-top: 2.25rem;
    padding: 0 24px;
  }

  /* All markdown is scoped to .markdown so we don't bleed brochure type
     into other places this page might render unrelated HTML later. */
  .markdown :global(h1),
  .markdown :global(h2) {
    font-family: var(--font-serif);
    font-size: 26px;
    line-height: 32px;
    font-weight: 500;
    letter-spacing: 0.003em;
    color: var(--forest-800);
    margin: 2rem 0 0.5rem;
    padding-top: 1.25rem;
    border-top: 0.5px solid var(--bone-400);
  }
  .markdown :global(h2:first-child),
  .markdown :global(h1:first-child) {
    margin-top: 0;
    padding-top: 0;
    border-top: none;
  }
  .markdown :global(h3) {
    font-family: var(--font-sans);
    font-size: 11px;
    line-height: 16px;
    font-weight: 500;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--bone-600);
    margin: 1.25rem 0 0.4rem;
  }
  .markdown :global(h4) {
    font-family: var(--font-sans);
    font-size: 15px;
    line-height: 22px;
    font-weight: 500;
    color: var(--forest-800);
    margin: 1rem 0 0.4rem;
  }
  .markdown :global(p) {
    font-family: var(--font-sans);
    font-size: 14px;
    line-height: 1.6;
    color: var(--bark-800);
    margin: 0.4rem 0 0.75rem;
  }
  /* Bold-immediately-after-day-heading lines read as the day's theme. Treat
     a paragraph that's entirely a <strong> as a thematic eyebrow. */
  .markdown :global(p > strong:only-child) {
    font-family: var(--font-serif);
    font-style: italic;
    font-weight: 500;
    font-size: 16px;
    color: var(--bark-600);
  }
  .markdown :global(ul),
  .markdown :global(ol) {
    margin: 0.5rem 0 1rem;
    padding-left: 1.25rem;
  }
  .markdown :global(li) {
    font-family: var(--font-sans);
    font-size: 14px;
    line-height: 1.55;
    color: var(--bark-800);
    margin: 0.2rem 0;
  }
  .markdown :global(li::marker) { color: var(--bone-400); }
  .markdown :global(strong) { font-weight: 500; color: var(--forest-800); }
  .markdown :global(em) { font-style: italic; color: var(--bark-600); }
  .markdown :global(a) {
    color: var(--forest-600);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .markdown :global(blockquote) {
    margin: 1.25rem 0;
    padding: 0.85rem 1.25rem;
    background: var(--bone-100);
    border-radius: 2px;
    font-family: var(--font-serif);
    font-style: italic;
    font-size: 15px;
    line-height: 1.6;
    color: var(--bark-600);
  }
  .markdown :global(table) {
    width: 100%;
    border-collapse: collapse;
    font-family: var(--font-sans);
    font-size: 13px;
    margin: 1rem 0;
  }
  .markdown :global(th),
  .markdown :global(td) {
    text-align: left;
    padding: 6px 10px;
    border-bottom: 0.5px solid var(--bone-400);
  }
  .markdown :global(th) {
    color: var(--bone-600);
    font-weight: 500;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    font-size: 11px;
  }
  .markdown :global(code) {
    font-family: var(--font-mono);
    font-size: 12px;
    background: var(--bone-100);
    padding: 1px 5px;
    border-radius: 3px;
    color: var(--bark-800);
  }
  .markdown :global(hr) {
    border: none;
    height: 0;
    border-top: 0.5px solid var(--bone-400);
    margin: 1.5rem 0;
  }

  /* ── Itinerary (day-grouped stops) ──────────────────────────────────
     Each day is a chapter under the destination map. Hairline rules
     separate day groups; the day numeral is Fraunces and the date sits
     beside it in mono, echoing the cover-meta treatment. */
  .day-group {
    margin-top: 1.75rem;
    padding-top: 1.25rem;
    border-top: 0.5px solid var(--bone-400);
  }
  .day-group:first-of-type {
    margin-top: 1.5rem;
    padding-top: 0;
    border-top: none;
  }
  .day-group-head {
    display: flex;
    align-items: baseline;
    gap: 14px;
    margin-bottom: 0.25rem;
  }
  .day-group-n {
    font-family: var(--font-serif);
    font-size: 22px;
    line-height: 1.15;
    font-weight: 500;
    color: var(--forest-800);
    letter-spacing: 0.003em;
  }
  .day-group-date {
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 500;
    color: var(--sunset-600);
    letter-spacing: 0.08em;
  }

  /* ── Stops ──────────────────────────────────────────────────────────
     Editorial feature treatment: each stop is a 2-column grid with the
     numeral hanging in the left margin like an illuminated initial. The
     pin color from the map (forest for stop, bone for unmapped) carries
     through to the numeral so the list reads as the map's legend without
     competing with it. Single column on purpose — a 2-column directory
     turned the trip into a service listing. */
  .stops-list {
    list-style: none;
    margin: 1rem 0 0;
    padding: 0;
  }
  .stop {
    display: grid;
    grid-template-columns: 56px 1fr;
    column-gap: 22px;
    padding: 18px 0;
    border-bottom: 0.5px solid var(--bone-400);
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .stop:first-child { padding-top: 6px; }
  .stop:last-child { border-bottom: none; }
  .stop-n {
    font-family: var(--font-serif);
    font-size: 34px;
    line-height: 1;
    font-weight: 500;
    color: var(--forest-800);
    text-align: right;
    padding-top: 4px;
    font-variant-numeric: lining-nums tabular-nums;
    letter-spacing: 0.005em;
  }
  .stop-n--unpinned { color: var(--bone-400); }
  .stop-body { min-width: 0; max-width: 60ch; }
  .stop-head {
    display: flex;
    align-items: baseline;
    gap: 10px;
    flex-wrap: wrap;
    margin-bottom: 0.35rem;
  }
  .stop-unpinned-tag {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.16em;
    color: var(--bone-600);
  }
  .stop-name {
    font-family: var(--font-serif);
    font-size: 20px;
    line-height: 1.25;
    font-weight: 500;
    color: var(--forest-800);
    letter-spacing: 0.003em;
    text-wrap: balance;
  }
  /* Category chip: tiny tinted pill matching the map-pin category system.
     Falls back to bone (the misc treatment) when category is unknown so a
     legacy or mistyped value still renders quietly. */
  .stop-cat {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.16em;
    padding: 2px 7px;
    border-radius: 2px;
    background: var(--cat-misc-tint);
    color: var(--cat-misc-on);
  }
  .stop-cat[data-cat="historic"]      { background: var(--cat-historic-tint);      color: var(--cat-historic-on); }
  .stop-cat[data-cat="cultural"]      { background: var(--cat-cultural-tint);      color: var(--cat-cultural-on); }
  .stop-cat[data-cat="food"]          { background: var(--cat-food-tint);          color: var(--cat-food-on); }
  .stop-cat[data-cat="entertainment"] { background: var(--cat-entertainment-tint); color: var(--cat-entertainment-on); }
  .stop-cat[data-cat="outdoors"]      { background: var(--cat-outdoors-tint);      color: var(--cat-outdoors-on); }
  .stop-cat[data-cat="view"]          { background: var(--cat-view-tint);          color: var(--cat-view-on); }
  .stop-cat[data-cat="quirky"]        { background: var(--cat-quirky-tint);        color: var(--cat-quirky-on); }
  .stop-cat[data-cat="shopping"]      { background: var(--cat-shopping-tint);      color: var(--cat-shopping-on); }
  .stop-hours,
  .stop-addr {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--bone-600);
    letter-spacing: 0.02em;
    margin: 1px 0;
  }
  .stop-addr { color: var(--bark-600); }
  .stop-notes {
    font-family: var(--font-sans);
    font-size: 13.5px;
    line-height: 1.6;
    color: var(--bark-800);
    margin: 8px 0 0;
  }

  /* ── Lodging ────────────────────────────────────────────────────── */
  .lodging-list {
    list-style: none;
    margin: 1rem 0 0;
    padding: 0;
    columns: 2;
    column-gap: 32px;
  }
  .lodge {
    padding: 12px 0;
    border-bottom: 0.5px solid var(--bone-400);
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .lodge:first-child { padding-top: 0; }
  .lodge:last-child { border-bottom: none; }
  .lodge-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 0.25rem;
  }
  .lodge-name {
    font-family: var(--font-serif);
    font-size: 16px;
    font-weight: 500;
    color: var(--forest-800);
  }
  .lodge-nights {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--bone-600);
    letter-spacing: 0.08em;
  }
  .lodge-addr,
  .lodge-conf {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--bark-600);
    letter-spacing: 0.02em;
    margin: 1px 0;
  }
  .lodge-conf {
    margin-top: 4px;
    text-transform: uppercase;
    letter-spacing: 0.18em;
    color: var(--bone-600);
  }

  /* ── Field guide notes ──────────────────────────────────────────────
     The notebook half of the brochure's "atlas + notebook" gesture.
     A sunset reference-mark glyph (※) sits in the margin like an
     editorial annotation; the body is an italic Fraunces note in a
     reading-width column. No side stripe — the typography carries it. */
  .fg-notes { list-style: none; margin: 1rem 0 0; padding: 0; }
  .fg-notes li {
    font-family: var(--font-serif);
    font-style: italic;
    font-size: 16px;
    line-height: 1.6;
    color: var(--bark-800);
    position: relative;
    padding: 6px 0 6px 32px;
    margin: 0 0 14px;
    max-width: 60ch;
  }
  .fg-notes li::before {
    content: "※";
    position: absolute;
    left: 0;
    top: 8px;
    font-family: var(--font-mono);
    font-style: normal;
    font-size: 13px;
    line-height: 1;
    color: var(--sunset-600);
    letter-spacing: 0;
  }
  .fg-notes li:last-child { margin-bottom: 0; }

  /* ── Gotchas (before-you-go) ───────────────────────────────────── */
  .gotchas {
    list-style: none;
    margin: 1rem 0 0;
    padding: 0;
    columns: 2;
    column-gap: 32px;
  }
  .gotchas li {
    break-inside: avoid;
    page-break-inside: avoid;
    font-family: var(--font-sans);
    font-size: 14px;
    line-height: 1.55;
    color: var(--bark-800);
    padding: 10px 0 10px 26px;
    position: relative;
    border-bottom: 0.5px dotted var(--bone-400);
  }
  .gotchas li::before {
    content: "▲";
    position: absolute;
    left: 0;
    top: 11px;
    font-size: 10px;
    color: var(--sunset-600);
  }
  .gotchas li:last-child { border-bottom: none; }

  /* ── Back cover ───────────────────────────────────────────────────── */

  .back-cover {
    margin-top: 4rem;
    padding: 3rem 28px 1.5rem;
    border-top: 0.5px solid var(--bone-400);
    text-align: center;
    color: var(--bark-600);
  }
  .back-cover :global(svg) {
    display: block;
    margin: 0 auto 1rem;
  }
  .brand-line {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 14px;
    margin-bottom: 1.5rem;
  }
  .brand-rule {
    flex: 0 0 56px;
    height: 1px;
    background: var(--sunset-600);
  }
  .brand-tag {
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.28em;
    text-transform: uppercase;
    color: var(--sunset-600);
  }
  .back-meta {
    font-family: var(--font-sans);
    font-size: 12px;
    line-height: 1.6;
    color: var(--bone-600);
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .back-meta a {
    color: var(--bark-600);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .back-mono {
    margin-top: 0.75rem;
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.18em;
    color: var(--bone-600);
  }

  /* ── Print ─────────────────────────────────────────────────────────── */

  @media print {
    /* Letter as primary target; A4 users will see slightly different
       margins but the same content fits within both safely. */
    @page { size: letter; margin: 0.75in; }

    .no-print { display: none !important; }

    :global(body) {
      background: var(--bone-50);
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    .brochure {
      max-width: none;
      padding: 0;
      margin: 0;
    }

    /* Major section breaks: cover and each content section start on a
       fresh page. The back cover flows after the last content section
       without forcing its own page; with 0.75" margins and small footer
       height, it almost always lands cleanly. */
    .cover,
    .content-page {
      page-break-after: always;
      break-after: page;
    }

    /* The cover-belt is part of the cover spread visually — keep it
       grouped with the cover on the same page. The route inset rides
       along inside it. */
    .cover-belt {
      page-break-before: avoid;
      break-before: avoid;
      margin-top: 1.5rem;
      padding: 0 0.25in;
    }

    /* Eyebrows + section headings should never orphan from the body
       that immediately follows them. */
    .eyebrow,
    .markdown :global(h1),
    .markdown :global(h2),
    .markdown :global(h3),
    .markdown :global(h4) {
      page-break-after: avoid;
      break-after: avoid;
    }
    /* Day blocks: try to keep an h2 with the next 2–3 lines of body so
       a heading doesn't strand at the bottom of a page. Browsers
       interpret these as hints, not guarantees. */
    .markdown :global(h2) {
      page-break-before: auto;
      break-before: auto;
    }

    /* Lists and tables generally shouldn't split awkwardly, but for
       long itineraries we accept clean splits. Tables stay together. */
    .markdown :global(table),
    .markdown :global(blockquote),
    .markdown :global(li) {
      page-break-inside: avoid;
      break-inside: avoid;
    }

    /* Cover edges to the page edge — the .cover already has a paper-feel
       background and rounds, so just zero its radius for paper. */
    .cover {
      border-radius: 0;
      aspect-ratio: 8.5 / 6.5;
    }
    .cover-photo { aspect-ratio: 8.5 / 6.5; }

    /* Back cover stays on the last page; suppress its top margin so
       it doesn't push to a new page on the boundary. */
    .back-cover {
      page-break-before: auto;
      break-before: auto;
      margin-top: 2rem;
      padding-top: 2rem;
    }

    /* Anchors print without underlines (the URLs themselves aren't useful
       on paper). Photographer credit on back cover keeps its underline. */
    .markdown :global(a) {
      color: var(--forest-800);
      text-decoration: none;
    }
  }
</style>

<script>
  import { marked } from 'marked';
  import Logo from '$lib/components/Logo.svelte';
  import PaperMap from '$lib/components/PaperMap.svelte';
  import DestinationMap from '$lib/components/DestinationMap.svelte';

  let { data } = $props();

  const trip = $derived(data.trip);
  const files = $derived(data.files || {});
  const route = $derived(data.route);
  const waypointCoords = $derived(data.waypointCoords || []);
  const hasMap = $derived(Array.isArray(route) && route.length >= 2 && waypointCoords.length >= 2);

  // If the user has run Prepare brochure, render against the structured
  // brochure.md content. Otherwise fall back to raw planning sections —
  // unprepared trips still get a usable preview.
  const brochure = $derived(data.brochureData ?? null);
  const isStructured = $derived(!!brochure);

  // Content selection: a locked trip's itinerary.md is the canonical brochure
  // content. Otherwise fall back to the planning sections in lifecycle order
  // — preview-brochure mode for trips still being shaped.
  const isLocked = $derived(trip?.locked === 'true');
  const hasItinerary = $derived(typeof files.itinerary === 'string' && files.itinerary.trim().length > 0);

  const SECTION_LABELS = {
    overview: 'Overview',
    route: 'Route',
    stops: 'Stops',
    logistics: 'Logistics',
  };
  const SECTION_ORDER = ['overview', 'route', 'stops', 'logistics'];

  const sections = $derived.by(() => {
    if (isLocked && hasItinerary) {
      return [{ key: 'itinerary', label: 'Itinerary', body: files.itinerary }];
    }
    return SECTION_ORDER
      .filter(k => typeof files[k] === 'string' && files[k].trim().length > 0)
      .map(k => ({ key: k, label: SECTION_LABELS[k], body: files[k] }));
  });

  const renderMd = (md) => marked.parse(md || '', { mangle: false, headerIds: false });

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

  // Atmosphere photos — Pexels now caches up to 3 results per query. Legacy
  // entries with a single photo fall back to a one-element array so the
  // brochure still works against the old cache shape.
  const photos = $derived(trip?._image?.photos ?? (trip?._image ? [trip._image] : []));
  // photos[0] is the cover. photos[1] and [2] (if present) get placed inline
  // as atmosphere breaks between major sections.
  const atmosphere1 = $derived(photos[1] ?? null);
  const atmosphere2 = $derived(photos[2] ?? null);

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
  <title>{trip?.title || trip?._slug} — Field guide</title>
</svelte:head>

<!-- Print hint banner — hidden in print via @media print. Gives the user
     a clear way to save as PDF without an unexpected auto-print. -->
<div class="print-hint">
  <span>Save this brochure as a PDF</span>
  <button class="btn btn-primary btn-compact" onclick={() => window.print()} type="button">
    Print / save PDF
  </button>
</div>

<div class="brochure">
  <!-- Page 1 — Cover -->
  <section class="cover">
    {#if trip?._image}
      <img
        class="cover-photo"
        src={trip._image.large || trip._image.medium}
        srcset={trip._image.medium && trip._image.large ? `${trip._image.medium} 350w, ${trip._image.large} 940w` : undefined}
        sizes="(max-width: 768px) 100vw, 720px"
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
    <!-- Structured render from brochure.md -->

    {#if brochure.days?.length}
      <section class="content-page" data-section="itinerary">
        <div class="eyebrow">Itinerary</div>
        {#each brochure.days as day}
          <article class="day-block">
            <h2 class="day-heading">
              <span class="day-n">Day {day.n}</span>
              {#if day.date}<span class="day-date">{day.date}</span>{/if}
            </h2>
            {#if day.theme}<p class="day-theme">{day.theme}</p>{/if}
            {#each day.blocks ?? [] as block}
              <div class="block">
                <h3 class="block-period">{block.period}</h3>
                <ul class="block-items">
                  {#each block.items ?? [] as item}
                    <li>
                      {#if item.time}<span class="item-time">{item.time}</span>{/if}
                      <span class="item-activity">{item.activity}</span>
                    </li>
                  {/each}
                </ul>
              </div>
            {/each}
          </article>
        {/each}
      </section>
    {/if}

    {#if atmosphere1}
      <figure class="atmosphere">
        <img
          src={atmosphere1.large || atmosphere1.medium}
          srcset={atmosphere1.medium && atmosphere1.large ? `${atmosphere1.medium} 350w, ${atmosphere1.large} 940w` : undefined}
          sizes="(max-width: 768px) 100vw, 760px"
          alt=""
          loading="lazy"
        />
        <figcaption>
          Photo by
          {#if atmosphere1.photographer_url}
            <a href={atmosphere1.photographer_url} target="_blank" rel="noopener">{atmosphere1.photographer}</a>
          {:else}
            {atmosphere1.photographer}
          {/if}
          via Pexels
        </figcaption>
      </figure>
    {/if}

    {#if brochure.stops?.length}
      <section class="content-page" data-section="stops">
        <div class="eyebrow">
          Stops
          {#if hasDestinationMap}
            <span class="eyebrow-detail">· {stopsWithCoords.length} of {brochure.stops.length} pinned on map</span>
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
              <span class="legend-swatch legend-swatch--must-see" aria-hidden="true"></span>
              <span>must-see</span>
            </li>
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
        {/if}

        <ul class="stops-list">
          {#each brochure.stops as stop, i}
            {@const hasCoords = Array.isArray(stop.coords) && stop.coords.length === 2}
            <li class="stop" class:stop--must-see={stop.must_see} class:stop--unpinned={!hasCoords}>
              <div class="stop-head">
                <span class="stop-n" class:stop-n--must-see={stop.must_see} class:stop-n--unpinned={!hasCoords} aria-hidden="true">{i + 1}</span>
                <span class="stop-name">{stop.name}</span>
                {#if stop.category}<span class="stop-cat">{stop.category}</span>{/if}
                {#if !hasCoords}<span class="stop-unpinned-tag">unmapped</span>{/if}
              </div>
              {#if stop.hours}<div class="stop-hours">{stop.hours}</div>{/if}
              {#if stop.address}<div class="stop-addr">{stop.address}</div>{/if}
              {#if stop.notes}<p class="stop-notes">{stop.notes}</p>{/if}
            </li>
          {/each}
        </ul>
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
                {#if lodge.nights}<span class="lodge-nights">{lodge.nights} night{lodge.nights === 1 ? '' : 's'}</span>{/if}
              </div>
              {#if lodge.address}<div class="lodge-addr">{lodge.address}</div>{/if}
              {#if lodge.confirmation}<div class="lodge-conf">Confirmation · {lodge.confirmation}</div>{/if}
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    {#if atmosphere2}
      <figure class="atmosphere">
        <img
          src={atmosphere2.large || atmosphere2.medium}
          srcset={atmosphere2.medium && atmosphere2.large ? `${atmosphere2.medium} 350w, ${atmosphere2.large} 940w` : undefined}
          sizes="(max-width: 768px) 100vw, 760px"
          alt=""
          loading="lazy"
        />
        <figcaption>
          Photo by
          {#if atmosphere2.photographer_url}
            <a href={atmosphere2.photographer_url} target="_blank" rel="noopener">{atmosphere2.photographer}</a>
          {:else}
            {atmosphere2.photographer}
          {/if}
          via Pexels
        </figcaption>
      </figure>
    {/if}

    {#if brochure.field_guide_notes?.length}
      <section class="content-page" data-section="notes">
        <div class="eyebrow">Field guide notes</div>
        <ul class="fg-notes">
          {#each brochure.field_guide_notes as note}
            <li>{note}</li>
          {/each}
        </ul>
      </section>
    {/if}

    {#if brochure.gotchas?.length}
      <section class="content-page" data-section="gotchas">
        <div class="eyebrow">Before you go</div>
        <ul class="gotchas">
          {#each brochure.gotchas as gotcha}
            <li>{gotcha}</li>
          {/each}
        </ul>
      </section>
    {/if}

  {:else}
    <!-- Fallback: raw planning markdown for unprepared trips -->
    {#each sections as section}
      <section class="content-page" data-section={section.key}>
        <div class="eyebrow">
          {#if section.key === 'itinerary'}Itinerary{:else}Section · {section.label}{/if}
        </div>
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
  /* Strip the document body to bone — no background colors from the parent. */
  :global(body) {
    background: var(--surface-page);
  }

  /* Print hint banner — sticky on-screen, gone in print. */
  .print-hint {
    position: sticky;
    top: 0;
    z-index: 10;
    background: var(--forest-800);
    color: var(--bone-200);
    padding: 10px 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 14px;
    font-family: var(--font-sans);
    font-size: 13px;
    font-weight: 500;
  }
  .print-hint :global(.btn) {
    background: var(--bone-200);
    color: var(--forest-800);
    border-color: var(--bone-200);
  }
  .print-hint :global(.btn:hover) {
    background: var(--bone-50);
    border-color: var(--bone-50);
  }

  .brochure {
    max-width: 820px;
    margin: 0 auto;
    padding: 1.75rem 0 2.5rem;
    color: var(--text-primary);
    font-family: var(--font-sans);
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
    .stops-list, .lodging-list, .gotchas { columns: 1; }
    .atmosphere { margin-left: 20px; margin-right: 20px; }
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
  .legend-swatch--must-see {
    background: var(--sunset-600);
    border: 1px solid var(--bone-50);
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
    margin: 1rem 0;
    padding: 0.5rem 1rem;
    border-left: 2px solid var(--sunset-600);
    background: var(--bone-100);
    font-family: var(--font-serif);
    font-style: italic;
    font-size: 15px;
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

  /* ── Atmosphere photos (between sections) ─────────────────────────── */

  .atmosphere {
    margin: 2.25rem 24px 0;
    padding: 0;
  }
  .atmosphere img {
    width: 100%;
    height: auto;
    display: block;
    border-radius: 4px;
    aspect-ratio: 5 / 3;
    object-fit: cover;
  }
  .atmosphere figcaption {
    margin-top: 6px;
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--bone-600);
    letter-spacing: 0.12em;
    text-align: right;
  }
  .atmosphere figcaption a {
    color: var(--bark-600);
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  /* ── Structured render (brochure.md) ─────────────────────────────── */

  /* ── Itinerary ──────────────────────────────────────────────────── */
  .day-block {
    margin-top: 1.5rem;
    padding-top: 1.25rem;
    border-top: 0.5px solid var(--bone-400);
  }
  .day-block:first-of-type {
    margin-top: 0.5rem;
    padding-top: 0;
    border-top: none;
  }
  .day-heading {
    display: flex;
    align-items: baseline;
    gap: 14px;
    margin: 0 0 0.25rem;
  }
  .day-n {
    font-family: var(--font-serif);
    font-size: 26px;
    line-height: 32px;
    font-weight: 500;
    color: var(--forest-800);
    letter-spacing: 0.003em;
  }
  .day-date {
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 500;
    color: var(--sunset-600);
    letter-spacing: 0.08em;
  }
  .day-theme {
    font-family: var(--font-serif);
    font-style: italic;
    font-size: 16px;
    font-weight: 500;
    color: var(--bark-600);
    margin: 0 0 1rem;
  }
  .block { margin-top: 1rem; }
  .block-period {
    font-family: var(--font-sans);
    font-size: 11px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.22em;
    color: var(--bone-600);
    margin: 0 0 0.5rem;
  }
  .block-items { list-style: none; margin: 0; padding: 0; }
  .block-items li {
    display: grid;
    grid-template-columns: 88px 1fr;
    column-gap: 14px;
    padding: 4px 0;
    font-family: var(--font-sans);
    font-size: 14px;
    line-height: 1.5;
    color: var(--bark-800);
    border-bottom: 0.5px dotted var(--bone-200);
  }
  .block-items li:last-child { border-bottom: none; }
  .item-time {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--forest-800);
    letter-spacing: 0.04em;
    align-self: baseline;
  }
  .item-activity { color: var(--bark-800); }

  /* ── Stops ──────────────────────────────────────────────────────── */
  .stops-list {
    list-style: none;
    margin: 1rem 0 0;
    padding: 0;
    columns: 2;
    column-gap: 32px;
  }
  .stop {
    padding: 12px 0;
    border-bottom: 0.5px solid var(--bone-400);
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .stop:first-child { padding-top: 0; }
  .stop:last-child { border-bottom: none; }
  .stop-head {
    display: flex;
    align-items: baseline;
    gap: 10px;
    flex-wrap: wrap;
    margin-bottom: 0.25rem;
  }
  .stop-n {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: var(--forest-800);
    color: var(--bone-200);
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 500;
    line-height: 1;
    flex: 0 0 auto;
    align-self: center;
  }
  .stop-n--must-see {
    background: var(--sunset-600);
    color: var(--sunset-50);
  }
  .stop-n--unpinned {
    background: transparent;
    color: var(--bone-600);
    border: 1.5px solid var(--bone-400);
    /* Slightly smaller text since the border adds visual weight. */
    font-size: 10px;
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
    font-size: 17px;
    font-weight: 500;
    color: var(--forest-800);
    letter-spacing: 0.003em;
  }
  .stop-cat {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.18em;
    color: var(--bone-600);
    padding: 1px 6px;
    border: 0.5px solid var(--bone-400);
    border-radius: 2px;
  }
  .stop--must-see .stop-name { color: var(--forest-900); }
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
    font-size: 13px;
    line-height: 1.55;
    color: var(--bark-800);
    margin: 6px 0 0;
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

  /* ── Field guide notes ──────────────────────────────────────────── */
  .fg-notes { list-style: none; margin: 1rem 0 0; padding: 0; }
  .fg-notes li {
    font-family: var(--font-serif);
    font-style: italic;
    font-size: 16px;
    line-height: 1.6;
    color: var(--bark-800);
    padding: 12px 0 12px 18px;
    border-left: 2px solid var(--sunset-600);
    margin: 0 0 12px;
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

    .print-hint { display: none !important; }

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

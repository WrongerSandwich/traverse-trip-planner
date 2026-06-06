<script>
  import MiniMap from './MiniMap.svelte';
  import Logo from './Logo.svelte';
  import TripJobBadge from './TripJobBadge.svelte';
  import { tripColor } from '$lib/utils/colors.js';
  import { formatDriveLabel } from '$lib/utils/formatDrive.js';
  import { hasWaypoints } from '$lib/utils/waypoints.js';

  let {
    trip,
    starred = false,
    jobs = [],
    fresh = false,
    archived = false,
    onclick,
    onhover,
    onleave,
    onbookmark,
    ondeepen,
    oncancel,
    onrestore,
  } = $props();

  const isIdea = $derived((trip.status || trip._stage) === 'idea');
  const isPlanning = $derived((trip.status || trip._stage) === 'planning');

  // Hide the Research CTA while a deepen job is in flight for this trip — the
  // TripJobBadge below already says "Researching…", so showing a disabled
  // button next to it is redundant. Parent sets an optimistic deepen job on
  // confirm so this flips immediately, before the next /api/jobs poll.
  const deepenRunning = $derived(
    jobs.some(j => (typeof j.workflow === 'string' ? j.workflow.split(':')[0] : j.workflow) === 'deepen')
  );

  // Suppress the Research CTA while ANY job is in flight for this trip, not just
  // deepen. After deepen finishes it promotes the trip to planning and hands off
  // to geocode → enrich → stop-prep; the jobs registry flips to the next leg
  // before `data.trips` re-fetches, so gating on `deepenRunning` alone briefly
  // re-shows "Research →" on a card that already has a "Geocoding…" badge (Bug
  // 1). `jobs` is pre-filtered to this trip's slug by the parent.
  const anyJobRunning = $derived(jobs.length > 0);

  // Show the waypoints-missing hint on the MiniMap thumbnail for planning trips
  // without usable waypoints. Idea-stage cards are excluded — absence is expected
  // pre-research and adding the hint would be noise. Also hidden while a research
  // job is running since waypoints will arrive when the job completes.
  const showWaypointHint = $derived(isPlanning && !hasWaypoints(trip) && !deepenRunning);

  const status  = $derived(trip.status || trip._stage || 'idea');
  const color   = $derived(tripColor(trip));
  const date    = $derived(trip.created ? new Date(trip.created).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '');
  const driveLabel = $derived(formatDriveLabel(trip._drive_hours));

  function handleKey(e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      const nextCard = e.currentTarget.closest('.card')?.nextElementSibling;
      if (nextCard?.classList?.contains('card')) {
        e.preventDefault();
        nextCard.querySelector('.card-overlay')?.focus();
      }
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      const prevCard = e.currentTarget.closest('.card')?.previousElementSibling;
      if (prevCard?.classList?.contains('card')) {
        e.preventDefault();
        prevCard.querySelector('.card-overlay')?.focus();
      }
    }
  }
</script>

<article class="card" class:fresh class:archived id="card-{trip._slug}"
  onmouseenter={onhover}
  onmouseleave={onleave}
  aria-label={fresh ? `${trip.title || trip._slug} (newly active)` : undefined}>

  <button
    class="card-overlay"
    onclick={onclick}
    onkeydown={handleKey}
    aria-label="Open {trip.title || trip._slug}"
  ></button>

  <!-- Thumbnail with status badge overlay -->
  {#if trip._image}
    <div class="thumb photo">
      <img
        src={trip._image.medium}
        srcset="{trip._image.medium} 350w, {trip._image.large} 940w"
        sizes="(max-width: 768px) 95vw, 360px"
        alt={trip.title || trip.destination}
        loading="lazy"
      />
      {#if archived}
        <span class="badge badge-archived">Archived</span>
      {:else}
        <span class="badge" style="--stage-color: {color}">{status}</span>
      {/if}
      {#if trip.national_park}<span class="np-badge"><svg width="9" height="10" viewBox="0 0 8 9" aria-hidden="true"><path d="M4 0L0 9h8L4 0z" fill="currentColor"/></svg>NPS</span>{/if}
      <div class="credit">
        <a href={trip._image.photographer_url} target="_blank" rel="noopener">{trip._image.photographer}</a> / Pexels
      </div>
    </div>
  {:else if Array.isArray(trip._coords)}
    <div class="thumb">
      <MiniMap coords={trip._coords} {color} />
      {#if archived}
        <span class="badge badge-archived">Archived</span>
      {:else}
        <span class="badge" style="--stage-color: {color}">{status}</span>
      {/if}
      {#if trip.national_park}<span class="np-badge"><svg width="9" height="10" viewBox="0 0 8 9" aria-hidden="true"><path d="M4 0L0 9h8L4 0z" fill="currentColor"/></svg>NPS</span>{/if}
      {#if showWaypointHint}
        <div class="waypoint-hint" role="status">
          <span class="waypoint-hint-copy">No route line — missing waypoints.</span>
          {#if ondeepen}
            <button
              class="waypoint-hint-btn"
              onclick={(e) => { e.stopPropagation(); ondeepen(e); }}
              type="button"
              aria-label="Run Research to add waypoints"
            >
              Run Research →
            </button>
          {/if}
        </div>
      {/if}
    </div>
  {:else}
    <div class="thumb placeholder">
      <Logo variant="mono-dark" size={48} class="placeholder-mark" />
      {#if archived}
        <span class="badge badge-archived">Archived</span>
      {:else}
        <span class="badge" style="--stage-color: {color}">{status}</span>
      {/if}
      {#if trip.national_park}<span class="np-badge"><svg width="9" height="10" viewBox="0 0 8 9" aria-hidden="true"><path d="M4 0L0 9h8L4 0z" fill="currentColor"/></svg>NPS</span>{/if}
    </div>
  {/if}

  <div class="body">
    <div class="top-row">
      {#if trip.vibe}<div class="eyebrow">{trip.vibe}</div>{/if}
      <button
        class="bookmark"
        class:active={starred}
        onclick={onbookmark}
        aria-label={starred ? 'Remove bookmark' : 'Bookmark this trip'}
        title={starred ? 'Bookmarked' : 'Bookmark'}
      >
        <svg width="13" height="15" viewBox="0 0 10 13" aria-hidden="true">
          {#if starred}
            <path d="M1 1h8v11L5 9 1 12z" fill="currentColor"/>
          {:else}
            <path d="M1 1h8v11L5 9 1 12z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="miter"/>
          {/if}
        </svg>
      </button>
    </div>

    <h2>{trip.title || trip._slug}</h2>

    {#if trip.pitch}<p class="pitch">{trip.pitch}</p>{/if}

    {#if archived}
      <button
        class="btn btn-secondary btn-compact card-cta"
        onclick={onrestore}
        title="Move this trip back to its original stage"
      >
        Restore
      </button>
    {:else if isIdea && !anyJobRunning}
      <button
        class="btn btn-secondary btn-compact card-cta"
        onclick={ondeepen}
        disabled={!ondeepen}
        title={
          ondeepen
            ? 'Look into this trip with web search'
            : 'Research is offline — configure the research model and search backend in .env or via Settings'
        }
      >
        Research →
      </button>
    {/if}

    {#if jobs.length > 0}
      <div class="badge-row">
        <TripJobBadge {jobs} />
      </div>
    {/if}

    <div class="footer">
      <div class="meta">
        {#if driveLabel}<span>{driveLabel}</span>{/if}
        {#if driveLabel && trip.destination}<span class="sep">·</span>{/if}
        {#if trip.destination}<span>{trip.destination}</span>{/if}
      </div>
      {#if trip._cost}
        <span class="cost">{trip._cost}</span>
      {/if}
    </div>
  </div>
</article>

<style>
  .card {
    position: relative;
    background: var(--surface-raised);
    border-radius: 8px;
    overflow: hidden;
    border: 1px solid var(--border-subtle);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04), 0 3px 10px rgba(0, 0, 0, 0.05);
    display: flex;
    flex-direction: column;
    cursor: pointer;
    transition: transform 0.18s cubic-bezier(0.22, 1, 0.36, 1),
                box-shadow 0.18s cubic-bezier(0.22, 1, 0.36, 1),
                border-color 0.18s;
    text-align: left;
    width: 100%;
  }

  /* Invisible full-card overlay button — handles the "open detail" click.
     z-index: 1 keeps it above normal flow content; interactive children
     use z-index: 2 to sit above it so their clicks are not intercepted. */
  .card-overlay {
    position: absolute;
    inset: 0;
    z-index: 1;
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
  }
  .card-overlay:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }
  .card:hover {
    transform: translateY(-3px);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.1), 0 1px 3px rgba(0, 0, 0, 0.05);
    border-color: var(--border-default);
  }
  .card:active {
    transform: scale(0.985);
    border-color: var(--border-strong);
    transition-duration: 0.05s;
  }
  .card:global(.highlight) { outline: 2px solid var(--focus-ring); outline-offset: 2px; }

  /* Newly-seeded or just-researched trip. Parent (home page) sets this when
     the user hasn't yet acknowledged the new card — clearing happens on
     mouseenter (the onhover callback) or click. Outline is inset so it
     doesn't poke into neighboring cards; the soft accent glow makes the
     card pop against the grid without competing with the existing hover. */
  .card.fresh {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
    box-shadow:
      0 0 24px color-mix(in oklab, var(--accent) 18%, transparent),
      0 1px 2px rgba(0, 0, 0, 0.04),
      0 3px 10px rgba(0, 0, 0, 0.05);
  }

  /* ── Thumbnail ── */
  .thumb {
    height: var(--thumb-h, 220px);
    flex-shrink: 0;
    background: var(--border-default);
    overflow: hidden;
    position: relative;
  }
  .thumb.photo img {
    width: 100%; height: 100%; object-fit: cover; display: block;
    transition: transform 0.4s cubic-bezier(0.22, 1, 0.36, 1);
  }
  .card:hover .thumb.photo img { transform: scale(1.05); }
  .thumb.placeholder {
    display: flex; align-items: center; justify-content: center;
    background: var(--surface-sunken);
  }
  .thumb.placeholder :global(.placeholder-mark) { opacity: 0.22; }

  /* Badge as photo overlay — bottom-left.
     Leading stage-colored dot carries the pre-attentive cue so readers
     don't have to parse the word at 0.58rem to tell idea / planning /
     completed apart. (A 3px left stripe used to do this, but it tripped
     the shared design laws' ban on colored side accents > 1px.) */
  .badge {
    position: absolute;
    bottom: 0.6rem;
    left: 0.6rem;
    font-size: 0.58rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    padding: 0.18rem 0.5rem;
    border-radius: 2px;
    background: rgba(31, 25, 14, 0.72);
    color: var(--bone-100);
    backdrop-filter: blur(4px);
    display: inline-flex;
    align-items: center;
    gap: 0.32rem;
  }
  .badge::before {
    content: '';
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--stage-color, var(--bone-100));
    flex-shrink: 0;
  }

  /* NPS badge — top-right, clear of photo credit */
  .np-badge {
    position: absolute;
    top: 0.6rem;
    right: 0.6rem;
    display: flex;
    align-items: center;
    gap: 0.28rem;
    font-size: 0.64rem;
    font-weight: 800;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    padding: 0.25rem 0.6rem;
    border-radius: 2px;
    background: var(--sunset-800);
    color: var(--bone-100);
    border: 1px solid rgba(201, 182, 149, 0.35);
  }

  .credit {
    position: absolute; bottom: 0; right: 0;
    z-index: 2;
    background: rgba(20, 20, 20, 0.45);
    color: rgba(230, 230, 230, 0.7);
    font-size: 0.56rem; padding: 0.14rem 0.45rem; border-radius: 3px 0 0 0;
  }
  .credit a { color: inherit; text-decoration: none; }
  .credit a:hover { text-decoration: underline; }

  /* ── Body ── */
  .body {
    padding: 1rem 1.25rem 0.9rem;
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    flex: 1;
    transition: background 0.22s cubic-bezier(0.22, 1, 0.36, 1);
  }
  .card:hover .body { background: var(--surface-sunken); }

  .top-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    margin-bottom: -0.1rem;
  }

  .bookmark {
    flex-shrink: 0;
    align-self: flex-start;
    position: relative;
    z-index: 2;
    background: none;
    border: none;
    padding: 0.15rem 0.1rem;
    cursor: pointer;
    color: var(--text-tertiary);
    line-height: 1;
    transition: color 0.12s, transform 0.12s;
    display: flex;
    align-items: center;
  }
  /* Invisible expanded hit area — visible bookmark stays small and aligns
     naturally with the vibe pill, but tap target meets the 44px guideline. */
  .bookmark::before {
    content: '';
    position: absolute;
    inset: -10px;
  }
  .bookmark:hover  { color: var(--text-primary); transform: scale(1.1); }
  .bookmark:active { color: var(--text-primary); transform: scale(0.92); }
  .bookmark.active { color: var(--accent); }

  .eyebrow {
    align-self: flex-start;
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.18em;
    color: var(--text-tertiary);
    margin-bottom: 2px;
  }

  h2 {
    font-family: var(--font-serif);
    font-size: 1.25rem;
    font-weight: 500;
    line-height: 1.2;
    color: var(--text-primary);
    letter-spacing: 0.005em;
    margin: 0;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .pitch {
    font-size: 0.825rem;
    line-height: 1.65;
    color: var(--text-secondary);
    flex: 1;
    margin: 0;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  /* ── Mono meta footer — drive · dest, with cost right-aligned ── */
  .footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    flex-wrap: wrap;
    padding-top: 0.55rem;
    border-top: 1px solid var(--border-subtle);
    margin-top: auto;
    font-family: var(--font-mono);
    font-size: 11px;
    line-height: 1;
    color: var(--text-tertiary);
  }
  .footer .meta {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex-wrap: wrap;
  }
  .footer .sep { color: var(--border-default); }
  .footer .cost {
    color: var(--text-primary);
    font-weight: 500;
    white-space: nowrap;
  }

  /* Card-level secondary CTA — small inline action button on idea cards. */
  .card-cta { position: relative; z-index: 2; align-self: flex-start; }

  /* Per-trip job badge container — sits above the footer, below CTAs. */
  .badge-row {
    position: relative;
    z-index: 2;
    align-self: flex-start;
  }

  /* ── Archived card treatment ──
     55% opacity at rest; rises to 75% on hover to signal the Restore
     affordance is interactive. No raw color literals — uses tokens only. */
  .card.archived {
    opacity: 0.55;
    transition: opacity 0.18s cubic-bezier(0.22, 1, 0.36, 1),
                transform 0.18s cubic-bezier(0.22, 1, 0.36, 1),
                box-shadow 0.18s cubic-bezier(0.22, 1, 0.36, 1),
                border-color 0.18s;
  }
  .card.archived:hover { opacity: 0.75; }

  /* Archived badge — desaturated muted-grey palette, replaces the stage pill. */
  .badge-archived {
    position: absolute;
    bottom: 0.6rem;
    left: 0.6rem;
    font-size: 0.58rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    padding: 0.18rem 0.5rem;
    border-radius: 2px;
    background: rgba(31, 25, 14, 0.72);
    color: var(--text-tertiary);
    backdrop-filter: blur(4px);
    display: inline-flex;
    align-items: center;
    gap: 0.32rem;
  }
  .badge-archived::before {
    content: '';
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--border-strong);
    flex-shrink: 0;
  }

  @media (max-width: 768px) {
    /* Shorter thumbnail — saves ~50px per card */
    :global(:root) { --thumb-h: 170px; }

    /* Bookmark stays visually small; ::before above provides the tap target.
       Push the hit-area further out on mobile so a thumb can land on it. */
    .bookmark::before { inset: -14px; }
    .card-cta { min-height: var(--tap-min); }
  }

  /* ── Waypoints-missing hint (card MiniMap thumbnail) ───────────────── */
  /* Sits at the bottom of the thumbnail, above the stage badge. Uses a
     scrim (rgba) over the map per the CSS-literal exception in CLAUDE.md;
     all other values reference tokens. */
  .waypoint-hint {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: 3;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
    padding: 0.4rem 0.6rem 1.8rem; /* bottom padding clears the .badge */
    background: color-mix(in oklab, var(--surface-overlay) 86%, transparent);
    backdrop-filter: blur(3px);
    pointer-events: auto;
  }

  .waypoint-hint-copy {
    font-size: 0.68rem;
    line-height: 1.3;
    color: var(--text-secondary);
    font-family: var(--font-sans);
    flex: 1 1 auto;
    min-width: 0;
  }

  .waypoint-hint-btn {
    flex-shrink: 0;
    position: relative;
    z-index: 4;
    background: var(--surface-raised);
    border: 1px solid var(--border-default);
    border-radius: 4px;
    padding: 0.2rem 0.55rem;
    font-size: 0.68rem;
    font-family: var(--font-sans);
    font-weight: 500;
    color: var(--text-primary);
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.12s, border-color 0.12s;
  }

  .waypoint-hint-btn:hover {
    background: var(--surface-sunken);
    border-color: var(--border-strong);
  }
</style>

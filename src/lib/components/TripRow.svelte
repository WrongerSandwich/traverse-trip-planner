<script>
  import MiniMap from './MiniMap.svelte';
  import Logo from './Logo.svelte';
  import TripJobBadge from './TripJobBadge.svelte';
  import { tripColor } from '$lib/utils/colors.js';
  import { formatDriveLabel } from '$lib/utils/formatDrive.js';

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
    onrestore,
  } = $props();

  const isIdea = $derived((trip.status || trip._stage) === 'idea');
  // Suppress the Research CTA while ANY job runs for this trip, not just deepen.
  // After deepen promotes idea→planning it hands off to geocode → enrich →
  // stop-prep; the registry flips to the next leg before `data.trips` re-fetches,
  // so gating on deepen alone briefly re-shows "Research →" beside a
  // "Geocoding…" badge (Bug 1). `jobs` is pre-filtered to this trip's slug.
  const anyJobRunning = $derived(jobs.length > 0);
  const status = $derived(trip.status || trip._stage || 'idea');
  const color  = $derived(tripColor(trip));
  const driveLabel = $derived(formatDriveLabel(trip._drive_hours));

  function handleKey(e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      const next = e.currentTarget.closest('.row')?.nextElementSibling;
      if (next?.classList?.contains('row')) {
        e.preventDefault();
        next.querySelector('.row-overlay')?.focus();
      }
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      const prev = e.currentTarget.closest('.row')?.previousElementSibling;
      if (prev?.classList?.contains('row')) {
        e.preventDefault();
        prev.querySelector('.row-overlay')?.focus();
      }
    }
  }
</script>

<article class="row" class:fresh class:archived id="card-{trip._slug}"
  onmouseenter={onhover}
  onmouseleave={onleave}
  aria-label={fresh ? `${trip.title || trip._slug} (newly active)` : undefined}>

  <button
    class="row-overlay"
    onclick={onclick}
    onkeydown={handleKey}
    aria-label="Open {trip.title || trip._slug}"
  ></button>

  {#if trip._image}
    <div class="thumb photo">
      <img
        src={trip._image.medium}
        srcset="{trip._image.medium} 350w"
        sizes="64px"
        alt=""
        loading="lazy"
      />
    </div>
  {:else if Array.isArray(trip._coords)}
    <div class="thumb">
      <MiniMap coords={trip._coords} {color} />
    </div>
  {:else}
    <div class="thumb placeholder">
      <Logo variant="mono-dark" size={24} class="placeholder-mark" />
    </div>
  {/if}

  <div class="body">
    <div class="title-line">
      <h2>{trip.title || trip._slug}</h2>
      <div class="title-actions">
        {#if archived}
          <button
            class="row-cta"
            onclick={onrestore}
            title="Move this trip back to its original stage"
          >
            Restore
          </button>
        {:else if isIdea && !anyJobRunning}
          <button
            class="row-cta"
            onclick={ondeepen}
            disabled={!ondeepen}
            title={
              ondeepen
                ? 'Look into this trip with web search'
                : 'Research is offline — configure the research model and search backend'
            }
          >
            Research →
          </button>
        {/if}
        <button
          class="bookmark"
          class:active={starred}
          onclick={onbookmark}
          aria-label={starred ? 'Remove bookmark' : 'Bookmark this trip'}
          title={starred ? 'Bookmarked' : 'Bookmark'}
        >
          <svg width="11" height="13" viewBox="0 0 10 13" aria-hidden="true">
            {#if starred}
              <path d="M1 1h8v11L5 9 1 12z" fill="currentColor"/>
            {:else}
              <path d="M1 1h8v11L5 9 1 12z" fill="none" stroke="currentColor" stroke-width="1" stroke-linejoin="miter"/>
            {/if}
          </svg>
        </button>
      </div>
    </div>

    <div class="meta-line">
      {#if archived}
        <span class="tag archived-tag" aria-label="Archived trip">Archived</span>
      {:else}
        <span
          class="stage-dot"
          style="--stage-color: {color}"
          aria-label={`Stage: ${status}`}
          title={status}
        ></span>
      {/if}
      {#if trip.destination}
        <span class="dest">{trip.destination}</span>
      {/if}
      {#if driveLabel}<span class="meta-item">{driveLabel}</span>{/if}
      {#if trip._cost}<span class="meta-item cost">{trip._cost}</span>{/if}
      {#if trip.national_park}
        <span class="tag nps" aria-label="National Park Service unit">
          <svg width="8" height="9" viewBox="0 0 8 9" aria-hidden="true"><path d="M4 0L0 9h8L4 0z" fill="currentColor"/></svg>
          NPS
        </span>
      {/if}
      {#if jobs.length > 0}
        <span class="job-slot"><TripJobBadge {jobs} /></span>
      {/if}
    </div>
  </div>
</article>

<style>
  .row {
    position: relative;
    background: var(--surface-raised);
    border: 1px solid var(--border-subtle);
    border-radius: 6px;
    overflow: hidden;
    display: grid;
    grid-template-columns: 64px 1fr;
    align-items: stretch;
    cursor: pointer;
    transition:
      background 0.15s,
      border-color 0.15s,
      transform 0.12s cubic-bezier(0.22, 1, 0.36, 1);
    text-align: left;
    width: 100%;
    min-height: 76px;
  }
  .row:hover {
    background: var(--surface-sunken);
    border-color: var(--border-default);
  }
  .row:active { transform: scale(0.997); }
  @media (prefers-reduced-motion: reduce) {
    .row, .row:active { transition: none; transform: none; }
  }
  /* Fresh outline is drawn inset (offset: -2px) so it stays visible even with the
     row's `overflow: hidden` clipping; same trick as TripCard.svelte. */
  .row.fresh {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
    box-shadow: 0 0 18px color-mix(in oklab, var(--accent) 18%, transparent);
  }

  /* Click overlay covers the whole row; interactive children sit above it. */
  .row-overlay {
    position: absolute;
    inset: 0;
    z-index: 1;
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
  }
  .row-overlay:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  /* ── Thumbnail ── */
  .thumb {
    background: var(--border-default);
    position: relative;
    overflow: hidden;
    align-self: stretch;
  }
  .thumb.photo img {
    width: 100%; height: 100%; object-fit: cover; display: block;
  }
  .thumb.placeholder {
    display: flex; align-items: center; justify-content: center;
    background: var(--surface-sunken);
  }
  .thumb.placeholder :global(.placeholder-mark) { opacity: 0.22; }

  /* ── Body ── */
  .body {
    padding: 0.7rem 0.9rem 0.7rem 0.95rem;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 0.3rem;
    min-width: 0;
  }

  .title-line {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.65rem;
    min-width: 0;
  }

  h2 {
    font-family: var(--font-serif);
    font-size: 1.02rem;
    font-weight: 500;
    line-height: 1.25;
    color: var(--text-primary);
    letter-spacing: 0.005em;
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
    flex: 1;
  }

  .title-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-shrink: 0;
    position: relative;
    z-index: 2;
  }

  .row-cta {
    background: transparent;
    border: 1px solid var(--border-default);
    border-radius: 3px;
    color: var(--text-secondary);
    font-family: var(--font-sans);
    font-size: 0.72rem;
    font-weight: 500;
    padding: 0.22rem 0.55rem;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.12s, border-color 0.12s, color 0.12s;
  }
  .row-cta:hover:not(:disabled) {
    background: var(--surface-raised);
    border-color: var(--border-strong);
    color: var(--text-primary);
  }
  .row-cta:disabled { opacity: 0.5; cursor: not-allowed; }

  .bookmark {
    background: none;
    border: none;
    padding: 0.2rem;
    cursor: pointer;
    color: var(--text-tertiary);
    line-height: 1;
    display: flex;
    align-items: center;
    transition: color 0.12s, transform 0.12s;
    position: relative;
  }
  .bookmark::before {
    content: '';
    position: absolute;
    inset: -8px;
  }
  .bookmark:hover  { color: var(--text-primary); transform: scale(1.1); }
  .bookmark:active { color: var(--text-primary); transform: scale(0.92); }
  .bookmark.active { color: var(--accent); }

  /* ── Meta line ──
     Two-tier hierarchy: title above, single readable subtitle below.
     12px sans at --text-secondary lets the destination breathe; cost stays
     primary-weight as the right-leaning anchor. No interpunct separators —
     gap + the leading stage dot do the rhythm. Job badge pins right. */
  .meta-line {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    flex-wrap: wrap;
    font-family: var(--font-sans);
    font-size: 12px;
    line-height: 1;
    color: var(--text-secondary);
    min-width: 0;
  }
  .meta-item { color: var(--text-secondary); }
  .meta-line .cost { color: var(--text-primary); font-weight: 500; }
  .meta-line .dest {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 28ch;
  }

  .stage-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--stage-color, var(--text-tertiary));
    flex-shrink: 0;
    display: inline-block;
  }

  .tag {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    font-size: 9.5px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    padding: 0.15rem 0.4rem;
    border-radius: 2px;
  }
  .tag.nps {
    color: var(--bone-100);
    background: var(--sunset-800);
  }

  /* Job badge pins to the right edge of the meta line so it doesn't wrap
     onto a second visual row in narrow viewports. (Critique minor: prior
     version let it land alone on a wrapped line, reading as a tag.) */
  .job-slot {
    position: relative;
    z-index: 2;
    margin-left: auto;
  }
  .job-slot :global(.job-badge) {
    font-size: 9.5px;
    padding: 0.12rem 0.4rem;
  }

  /* ── Archived row treatment ── */
  .row.archived {
    opacity: 0.55;
    transition: opacity 0.15s, background 0.15s, border-color 0.15s, transform 0.12s cubic-bezier(0.22, 1, 0.36, 1);
  }
  .row.archived:hover { opacity: 0.75; }

  /* Archived label tag — desaturated sibling of the NPS badge. */
  .tag.archived-tag {
    color: var(--text-tertiary);
    background: var(--surface-sunken);
    border: 1px solid var(--border-subtle);
  }

  @media (max-width: 768px) {
    .row { grid-template-columns: 56px 1fr; min-height: 72px; }
    .body { padding: 0.6rem 0.7rem 0.6rem 0.8rem; }
    /* Title actions get extra tap area on touch */
    .bookmark::before { inset: -12px; }
    .row-cta { min-height: var(--tap-min); display: inline-flex; align-items: center; }
  }
</style>

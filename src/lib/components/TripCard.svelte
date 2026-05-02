<script>
  import MiniMap from './MiniMap.svelte';
  import { tripColor } from '$lib/utils/colors.js';

  let { trip, starred = false, onclick, onhover, onleave, onbookmark, ondeepen, onpromote } = $props();

  const isIdea = $derived((trip.status || trip._stage) === 'idea');
  const isExploring = $derived((trip.status || trip._stage) === 'exploring');

  const status  = $derived(trip.status || trip._stage || 'idea');
  const color   = $derived(tripColor(trip));
  const date    = $derived(trip.created ? new Date(trip.created).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '');
  const driveLabel = $derived(
    trip._drive_hours != null
      ? `${trip._drive_hours % 1 === 0 ? trip._drive_hours : trip._drive_hours.toFixed(1)} hr`
      : null
  );

  const isFly = $derived(trip.fly_in === 'true');
</script>

<article class="card" onclick={onclick} id="card-{trip._slug}" role="button" tabindex="0"
  onkeydown={e => e.key === 'Enter' && onclick?.()}
  onmouseenter={onhover}
  onmouseleave={onleave}>

  <!-- Thumbnail with status badge overlay -->
  {#if trip._image}
    <div class="thumb photo">
      <img src={trip._image.medium} alt={trip.title || trip.destination} loading="lazy" />
      <span class="badge">{status}{trip.locked === 'true' ? ' · locked' : ''}</span>
      {#if trip.national_park}<span class="np-badge"><svg width="9" height="10" viewBox="0 0 8 9" aria-hidden="true"><path d="M4 0L0 9h8L4 0z" fill="currentColor"/></svg>NPS</span>{/if}
      <div class="credit">
        <a href={trip._image.photographer_url} target="_blank" rel="noopener">{trip._image.photographer}</a> / Pexels
      </div>
    </div>
  {:else if Array.isArray(trip._coords)}
    <div class="thumb">
      <MiniMap coords={trip._coords} {color} />
      <span class="badge">{status}{trip.locked === 'true' ? ' · locked' : ''}</span>
      {#if trip.national_park}<span class="np-badge"><svg width="9" height="10" viewBox="0 0 8 9" aria-hidden="true"><path d="M4 0L0 9h8L4 0z" fill="currentColor"/></svg>NPS</span>{/if}
    </div>
  {:else}
    <div class="thumb placeholder">
      🗺️
      <span class="badge">{status}{trip.locked === 'true' ? ' · locked' : ''}</span>
      {#if trip.national_park}<span class="np-badge"><svg width="9" height="10" viewBox="0 0 8 9" aria-hidden="true"><path d="M4 0L0 9h8L4 0z" fill="currentColor"/></svg>NPS</span>{/if}
    </div>
  {/if}

  <div class="body">
    <div class="top-row">
      {#if trip.vibe}<div class="vibe">{trip.vibe}</div>{/if}
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

    {#if isIdea && ondeepen}
      <button class="research-btn" onclick={ondeepen} title="Research this trip with Claude">
        Research →
      </button>
    {:else if isExploring && onpromote}
      <button class="research-btn" onclick={onpromote} title="Move into Planning">
        Start Planning →
      </button>
    {/if}

    <div class="footer">
      {#if isFly}
        <span class="mode-chip fly">✈ fly</span>
      {:else if driveLabel}
        <span class="mode-chip drive">{driveLabel}</span>
      {/if}
      {#if trip.destination}
        <span class="dest">{trip.destination}</span>
      {/if}
      {#if trip._cost}
        <span class="cost">{trip._cost}</span>
      {/if}
    </div>
  </div>
</article>

<style>
  .card {
    background: var(--surface);
    border-radius: 8px;
    overflow: hidden;
    border: 1px solid var(--border-subtle);
    box-shadow: 0 1px 2px oklch(0% 0 0 / 0.04), 0 3px 10px oklch(0% 0 0 / 0.05);
    display: flex;
    flex-direction: column;
    cursor: pointer;
    transition: transform 0.18s cubic-bezier(0.22, 1, 0.36, 1),
                box-shadow 0.18s cubic-bezier(0.22, 1, 0.36, 1),
                border-color 0.18s;
    text-align: left;
    width: 100%;
  }
  .card:hover {
    transform: translateY(-3px);
    box-shadow: 0 8px 24px oklch(0% 0 0 / 0.1), 0 1px 3px oklch(0% 0 0 / 0.05);
    border-color: var(--accent-border);
  }
  .card:active {
    transform: scale(0.985);
    border-color: var(--accent);
    transition-duration: 0.05s;
  }
  .card:global(.highlight) { outline: 2px solid var(--accent); outline-offset: 2px; }

  /* ── Thumbnail ── */
  .thumb {
    height: var(--thumb-h, 220px);
    flex-shrink: 0;
    background: var(--border);
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
    color: var(--text-3); font-size: 1.5rem;
  }

  /* Badge as photo overlay — bottom-left */
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
    background: oklch(12% 0.01 80 / 0.72);
    color: oklch(93% 0.008 80);
    backdrop-filter: blur(4px);
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
    background: oklch(30% 0.07 52 / 0.93);
    color: oklch(93% 0.022 68);
    border: 1px solid oklch(62% 0.05 65 / 0.35);
  }

  .credit {
    position: absolute; bottom: 0; right: 0;
    background: oklch(10% 0 0 / 0.45);
    color: oklch(90% 0 0 / 0.7);
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
  .card:hover .body { background: var(--accent-bg); }

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
    background: none;
    border: none;
    padding: 0.15rem 0.1rem;
    cursor: pointer;
    color: var(--text-3);
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
  .bookmark:hover  { color: var(--accent); transform: scale(1.1); }
  .bookmark:active { color: var(--accent); transform: scale(0.92); }
  .bookmark.active { color: var(--accent); }

  .vibe {
    display: inline-flex;
    align-self: flex-start;
    font-size: 0.58rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.09em;
    color: var(--accent);
    background: var(--accent-bg);
    padding: 0.18rem 0.5rem;
    border-radius: 2px;
    margin-bottom: -0.05rem;
  }

  h2 {
    font-size: 1.15rem;
    font-weight: 700;
    line-height: 1.22;
    color: var(--text);
    letter-spacing: -0.025em;
    margin: 0;
  }

  .pitch {
    font-size: 0.825rem;
    line-height: 1.65;
    color: var(--text-2);
    flex: 1;
    margin: 0;
  }

  /* ── Compact footer ── */
  .footer {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    flex-wrap: wrap;
    padding-top: 0.45rem;
    border-top: 1px solid var(--border-subtle);
    margin-top: auto;
  }

  /* Colored mode chip — the primary skim anchor */
  .mode-chip {
    display: inline-flex;
    align-items: center;
    font-size: 0.62rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    padding: 0.2rem 0.55rem;
    border-radius: 2px;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .mode-chip.drive {
    background: oklch(93.5% 0.048 155);
    color: oklch(32% 0.12 155);
  }
  .mode-chip.fly {
    background: oklch(93.5% 0.048 195);
    color: oklch(28% 0.12 195);
  }

  .footer .dest {
    font-size: 0.72rem;
    color: var(--text-2);
    font-weight: 500;
  }

  .research-btn {
    align-self: flex-start;
    border: 1.5px solid var(--accent-border);
    background: none;
    color: var(--accent);
    font-size: 0.7rem;
    font-weight: 600;
    font-family: var(--font);
    padding: 0.22rem 0.6rem;
    border-radius: 3px;
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
  }
  .research-btn:hover  { background: var(--accent); color: oklch(97% 0.012 80); }
  .research-btn:active { background: var(--accent); color: oklch(97% 0.012 80); transform: scale(0.96); }

  .footer .cost {
    font-size: 0.72rem;
    font-weight: 700;
    color: var(--text);
    margin-left: auto;
  }

  @media (max-width: 768px) {
    /* Shorter thumbnail — saves ~50px per card */
    :global(:root) { --thumb-h: 170px; }

    /* Bookmark stays visually small; ::before above provides the tap target.
       Push the hit-area further out on mobile so a thumb can land on it. */
    .bookmark::before { inset: -14px; }
    .research-btn { min-height: var(--tap-min); display: flex; align-items: center; }
  }
</style>

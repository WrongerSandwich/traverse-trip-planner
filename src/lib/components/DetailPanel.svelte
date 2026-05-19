<script>
  import { renderMarkdown } from '$lib/sanitize.js';
  import MiniMap from './MiniMap.svelte';
  import { tripColor } from '$lib/utils/colors.js';
  import { swipeClose } from '$lib/actions/swipeClose.js';

  let { trip = null, onclose, starred = false, onbookmark, onarchive } = $props();

  // TODO: consider splitting enrichTrips() in data.js into geocode/image/calculation concerns
  const markerColor = tripColor;

  const TAB_LABELS = { overview: 'Overview', route: 'Route', stops: 'Stops', logistics: 'Logistics' };

  let tripFiles = $state(null);
  let activeTab  = $state('overview');
  let loading    = $state(false);

  $effect(() => {
    const slug = trip?._slug;
    if (!slug) { tripFiles = null; return; }
    loading = true;
    tripFiles = null;
    fetch(`/api/trip/${encodeURIComponent(slug)}`)
      .then(r => r.json())
      .then(d => {
        tripFiles = d;
        activeTab = Object.keys(d?.files || {})[0] || 'overview';
      })
      .finally(() => loading = false);
  });

  const tabs = $derived(Object.keys(tripFiles?.files || {}).filter(k => tripFiles.files[k]));
  const renderedContent = $derived.by(() => {
    const content = tripFiles?.files?.[activeTab];
    return content ? renderMarkdown(content) : '';
  });

  const driveLabel = $derived(
    trip?._drive_hours != null
      ? `${trip._drive_hours % 1 === 0 ? trip._drive_hours : trip._drive_hours.toFixed(1)} hr`
      : null
  );

  function handleKeydown(e) { if (e.key === 'Escape') onclose?.(); }


</script>

<svelte:window onkeydown={handleKeydown} />

<div class="backdrop" class:open={!!trip} onclick={onclose} role="presentation"></div>

<aside class="panel" class:open={!!trip}
  use:swipeClose={() => onclose?.()}>

  <!-- Hero: photo with overlay, or dark fallback header -->
  {#if trip?._image}
    <div class="hero">
      <img
        src={trip._image.large || trip._image.medium}
        srcset={trip._image.medium && trip._image.large ? `${trip._image.medium} 350w, ${trip._image.large} 940w` : undefined}
        sizes="(max-width: 768px) 100vw, 420px"
        alt={trip?.title || ''}
      />
      <div class="hero-overlay">
        {#if trip.vibe}<span class="hero-vibe">{trip.vibe}</span>{/if}
        <h2>{trip?.title || trip?._slug || ''}</h2>
        <div class="hero-meta">
          {#if trip.destination}<span class="hero-dest">{trip.destination}</span>{/if}
          {#if driveLabel}
            <span class="hero-mode drive">{driveLabel}</span>
          {/if}
        </div>
      </div>
      <button class="panel-bookmark" class:active={starred} onclick={onbookmark} aria-label={starred ? 'Remove bookmark' : 'Bookmark'}>
        <svg width="14" height="17" viewBox="0 0 10 13" aria-hidden="true">
          {#if starred}
            <path d="M1 1h8v11L5 9 1 12z" fill="currentColor"/>
          {:else}
            <path d="M1 1h8v11L5 9 1 12z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="miter"/>
          {/if}
        </svg>
      </button>
      <button class="close light" onclick={onclose} aria-label="Close">✕</button>
      {#if trip.national_park}
        <span class="hero-nps">
          <svg width="8" height="9" viewBox="0 0 8 9" aria-hidden="true"><path d="M4 0L0 9h8L4 0z" fill="currentColor"/></svg>
          NPS
        </span>
      {/if}
    </div>
  {:else}
    <div class="header-dark">
      <div class="header-text">
        {#if trip?.vibe}<span class="dark-vibe">{trip.vibe}</span>{/if}
        <h2>{trip?.title || trip?._slug || ''}</h2>
        {#if trip?.destination}<div class="dark-dest">{trip.destination}</div>{/if}
      </div>
      <button class="close dark" onclick={onclose} aria-label="Close">✕</button>
    </div>
  {/if}

  <!-- Mini map -->
  {#if trip && Array.isArray(trip._coords)}
    <div class="panel-map">
      <MiniMap coords={trip._coords} color={markerColor(trip)} zoom={9} interactive={true} />
    </div>
  {/if}

  <!-- Tabs -->
  {#if tabs.length > 0}
    <div class="tabs">
      {#each tabs as tab}
        <button class="tab" class:active={activeTab === tab} onclick={() => activeTab = tab}>
          {TAB_LABELS[tab] || tab}
        </button>
      {/each}
    </div>
  {/if}

  <!-- Content -->
  <div class="body">
    {#if loading}
      <div class="empty">Reading the file…</div>
    {:else if !tripFiles || tabs.length === 0}
      <div class="empty">
        <p>Nothing researched yet.</p>
        <p class="empty-hint">Use the <strong>Research</strong> button on the trip card to flesh this out.</p>
      </div>
    {:else}
      <div class="prose">{@html renderedContent}</div>
    {/if}

    {#if trip && onarchive}
      <div class="danger-zone">
        <button class="btn btn-danger btn-compact" onclick={onarchive}>Archive trip</button>
        <span class="archive-hint">Hides it from view but keeps the file so it won't be re-suggested.</span>
      </div>
    {/if}
  </div>

</aside>

<style>
  .backdrop {
    position: fixed; inset: 0;
    background: rgba(20, 20, 20, 0.45);
    z-index: 900;
    opacity: 0; pointer-events: none;
    transition: opacity 0.25s;
  }
  .backdrop.open { opacity: 1; pointer-events: auto; }

  .panel {
    position: fixed; top: 0; right: 0;
    width: 520px; max-width: 100vw; height: 100vh;
    background: var(--surface-raised);
    box-shadow: -12px 0 60px rgba(0, 0, 0, 0.2), -2px 0 8px rgba(0, 0, 0, 0.08);
    z-index: 901;
    display: flex; flex-direction: column;
    transform: translateX(100%);
    transition: transform 0.3s cubic-bezier(0.22, 1, 0.36, 1);
  }
  .panel.open { transform: translateX(0); }

  /* ── Photo hero ── */
  .hero {
    position: relative;
    height: 240px;
    flex-shrink: 0;
    overflow: hidden;
    background: var(--border-default);
  }
  .hero img {
    width: 100%; height: 100%;
    object-fit: cover; display: block;
  }
  .hero-overlay {
    position: absolute; inset: 0;
    background: linear-gradient(to top, rgba(31, 25, 14, 0.88) 0%, rgba(31, 25, 14, 0.1) 55%, transparent 100%);
    display: flex; flex-direction: column; justify-content: flex-end;
    padding: 1.25rem 1.4rem;
    gap: 0.3rem;
  }
  .hero-vibe {
    font-size: 0.6rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--forest-50);
    background: var(--forest-800);
    padding: 0.16rem 0.45rem;
    border-radius: 2px;
    align-self: flex-start;
  }
  .hero h2 {
    font-family: var(--font-serif);
    font-size: 1.55rem;
    font-weight: 500;
    line-height: 1.15;
    color: var(--bone-50);
    letter-spacing: 0.005em;
    margin: 0;
  }
  .hero-meta {
    display: flex; align-items: center; gap: 0.5rem;
    margin-top: 0.1rem;
  }
  .hero-dest {
    font-size: 0.78rem;
    color: var(--bone-400);
    font-weight: 400;
  }
  .hero-mode {
    font-size: 0.62rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    padding: 0.15rem 0.45rem;
    border-radius: 2px;
  }
  .hero-mode.drive { background: var(--surface-raised); color: var(--text-primary); }

  .hero-nps {
    position: absolute;
    top: 0.75rem; right: 7.75rem;
    display: flex; align-items: center; gap: 0.22rem;
    font-size: 0.6rem; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase;
    padding: 0.2rem 0.5rem; border-radius: 2px;
    background: var(--sunset-800);
    color: var(--bone-100);
    border: 1px solid rgba(201, 182, 149, 0.3);
  }

  /* Floating hero controls — translucent dark pill backdrop keeps them
     legible against any photo, including high-key/light ones where pure
     white-on-image disappears. */
  .panel-bookmark, .close.light {
    background: rgba(0, 0, 0, 0.45);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
    border-radius: 50%;
    border: none;
    cursor: pointer;
    line-height: 1;
    padding: 0.4rem;
    display: flex; align-items: center; justify-content: center;
    transition: background 0.12s, color 0.12s, transform 0.12s;
  }

  .panel-bookmark {
    position: absolute; top: 0.7rem; right: 4.25rem;
    color: var(--bone-50);
  }
  .panel-bookmark:hover  { background: rgba(0, 0, 0, 0.65); color: var(--bone-50); transform: scale(1.08); }
  .panel-bookmark.active { background: rgba(0, 0, 0, 0.55); color: var(--sunset-400); }

  .close {
    position: absolute; top: 0.7rem; right: 0.75rem;
    font-size: 1.3rem;
    font-weight: 600;
  }
  .close.light       { color: var(--bone-50); }
  .close.light:hover { background: rgba(0, 0, 0, 0.65); color: var(--bone-50); }
  .close.dark {
    background: none; border: none; cursor: pointer; line-height: 1;
    padding: 0.3rem; border-radius: 3px;
    transition: background 0.12s, color 0.12s;
    color: var(--text-tertiary);
  }
  .close.dark:hover  { color: var(--text-primary); background: rgba(255, 255, 255, 0.08); }

  /* ── Dark fallback header (no photo) ── */
  .header-dark {
    background: var(--surface-invert);
    padding: 1.4rem 1.4rem 1.3rem;
    display: flex; align-items: flex-start; gap: 0.75rem;
    flex-shrink: 0;
    position: relative;
  }
  .header-text { flex: 1; min-width: 0; }
  .dark-vibe {
    display: inline-block;
    font-size: 0.6rem; font-weight: 700;
    text-transform: uppercase; letter-spacing: 0.1em;
    color: var(--text-tertiary);
    margin-bottom: 0.35rem;
  }
  .header-dark h2 {
    font-family: var(--font-serif);
    font-size: 1.4rem; font-weight: 500; line-height: 1.2;
    color: var(--text-primary); letter-spacing: 0.005em;
    margin: 0;
  }
  .dark-dest { font-size: 0.78rem; color: var(--text-tertiary); margin-top: 0.3rem; }

  /* ── Map ── */
  .panel-map { height: 140px; flex-shrink: 0; background: var(--border-default); }

  /* ── Tabs ── */
  .tabs {
    display: flex; border-bottom: 1px solid var(--border-subtle);
    flex-shrink: 0; overflow-x: auto;
    background: var(--surface-raised);
  }
  .tab {
    padding: 0.65rem 1.15rem; font-size: 0.78rem; font-weight: 500;
    color: var(--text-tertiary); cursor: pointer; border: none; background: none;
    border-bottom: 2px solid transparent; white-space: nowrap;
    transition: color 0.12s;
    font-family: var(--font-sans);
  }
  .tab:hover { color: var(--text-primary); }
  .tab.active { color: var(--text-primary); border-bottom-color: var(--accent); font-weight: 600; }

  /* ── Body ── */
  .body { flex: 1; overflow-y: auto; padding: 1.5rem 1.75rem 3rem; }

  .empty {
    color: var(--text-tertiary);
    font-size: 0.875rem;
    padding: 3rem 0;
    text-align: center;
    line-height: 1.7;
  }
  .empty-hint { margin-top: 0.5rem; font-size: 0.8rem; }

  /* ── Danger zone (archive) ── */
  .danger-zone {
    margin-top: 2.25rem;
    padding-top: 1.1rem;
    border-top: 1px dashed var(--border-default);
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.4rem;
  }
  .archive-hint { font-size: 0.72rem; color: var(--text-tertiary); line-height: 1.45; }

  /* ── Prose ── */
  .prose { font-size: 0.9rem; line-height: 1.75; color: var(--text-secondary); }
  .prose :global(h1), .prose :global(h2) {
    font-size: 1.05rem; font-weight: 700; margin: 1.6rem 0 0.55rem;
    color: var(--text-primary); letter-spacing: -0.015em;
  }
  .prose :global(h3) {
    font-size: 0.9rem; font-weight: 700; margin: 1.2rem 0 0.35rem;
    color: var(--text-primary);
  }
  .prose :global(h1:first-child), .prose :global(h2:first-child), .prose :global(h3:first-child) { margin-top: 0; }
  .prose :global(p) { margin: 0 0 0.9rem; }
  .prose :global(ul), .prose :global(ol) { margin: 0 0 0.9rem 1.3rem; }
  .prose :global(li) { margin-bottom: 0.35rem; }
  .prose :global(strong) { font-weight: 700; color: var(--text-primary); }
  .prose :global(a) { color: var(--accent-text); text-decoration: none; }
  .prose :global(a:hover) { text-decoration: underline; }
  .prose :global(hr) { border: none; border-top: 1px solid var(--border-subtle); margin: 1.5rem 0; }
  .prose :global(code) { font-family: monospace; font-size: 0.82em; background: var(--surface-sunken); color: var(--text-primary); padding: 0.1em 0.4em; border-radius: 3px; }
  .prose :global(table) { width: 100%; border-collapse: collapse; font-size: 0.84rem; margin: 0 0 1.1rem; }
  .prose :global(th) { text-align: left; font-weight: 700; padding: 0.45rem 0.65rem; border-bottom: 2px solid var(--border-default); color: var(--text-primary); }
  .prose :global(td) { padding: 0.4rem 0.65rem; border-bottom: 1px solid var(--border-subtle); vertical-align: top; }
  .prose :global(tr:last-child td) { border-bottom: none; }

  @media (max-width: 768px) {
    .panel { width: 100vw; }

    /* Shorter hero — reclaims viewport for content */
    .hero { height: 180px; }

    /* Smaller title + 2-line clamp so long names don't crowd the destination/mode chips */
    .hero h2 {
      font-size: 1.25rem;
      letter-spacing: 0.005em;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      text-overflow: ellipsis;
      word-break: break-word;
    }

    /* Larger tap targets on tabs and close */
    .tab { min-height: var(--tap-min); padding: 0 1rem; }
    .panel-bookmark, .close { min-width: var(--tap-min); min-height: var(--tap-min); }

    /* Tighter body padding */
    .body { padding: 1.1rem 1.1rem 2.5rem; }

    /* Smaller map strip */
    .panel-map { height: 120px; }
  }
</style>

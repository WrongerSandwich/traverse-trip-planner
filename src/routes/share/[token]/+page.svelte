<script>
  import { marked } from 'marked';

  let { data } = $props();

  const SECTION_LABELS = {
    overview: 'Overview',
    route: 'Route',
    stops: 'Stops',
    logistics: 'Logistics',
    itinerary: 'Itinerary',
  };
  const SECTION_ORDER = ['overview', 'route', 'stops', 'logistics', 'itinerary'];

  const trip = $derived(data.trip);
  const files = $derived(data.files || {});
  const isLocked = $derived(trip?.locked === 'true');

  // If locked, show only the itinerary; otherwise show all sections that have content.
  const visibleSections = $derived(
    isLocked && files.itinerary
      ? ['itinerary']
      : SECTION_ORDER.filter(s => files[s] && files[s].trim())
  );
</script>

<svelte:head>
  <title>{trip?.title || 'Traverse trip'} — shared</title>
</svelte:head>

<div class="page">
  <header>
    <h1>{trip?.title || trip?._slug}</h1>
    <div class="meta">
      {#if trip?.destination}<span>{trip.destination}</span>{/if}
      {#if trip?.target_date}<span class="date">{trip.target_date}</span>{/if}
    </div>
  </header>

  {#if trip?._image}
    <div class="hero">
      <img
        src={trip._image.large || trip._image.medium}
        srcset={trip._image.medium && trip._image.large ? `${trip._image.medium} 350w, ${trip._image.large} 940w` : undefined}
        sizes="(max-width: 768px) 100vw, 760px"
        alt={trip.title || trip.destination}
      />
      <div class="credit">
        Photo by <a href={trip._image.photographer_url} target="_blank" rel="noopener">{trip._image.photographer}</a> via Pexels
      </div>
    </div>
  {/if}

  {#if trip?.pitch}<p class="pitch">{trip.pitch}</p>{/if}

  <main>
    {#each visibleSections as section}
      <section>
        <h2>{SECTION_LABELS[section]}</h2>
        <div class="md">{@html marked(files[section] || '')}</div>
      </section>
    {:else}
      <p class="empty">No content shared yet for this trip.</p>
    {/each}
  </main>

  <footer>
    <p>Shared via <strong>Traverse</strong> — read-only.</p>
  </footer>
</div>

<style>
  :global(body) { background: var(--bg); color: var(--text); }

  .page {
    max-width: 760px;
    margin: 0 auto;
    padding: 2rem 1.25rem 4rem;
    font-family: var(--font);
  }
  header { margin-bottom: 1.5rem; }
  h1 {
    margin: 0 0 0.4rem;
    font-size: 2rem;
    font-weight: 700;
    color: var(--text);
  }
  .meta {
    display: flex; flex-wrap: wrap; gap: 0.5rem 0.85rem;
    font-size: 0.85rem;
    color: var(--text-2);
  }
  .meta .date { color: var(--accent); font-weight: 600; }

  .hero {
    margin: 1rem 0 1.5rem;
    border-radius: 8px;
    overflow: hidden;
    background: var(--surface);
    border: 1px solid var(--border-subtle);
  }
  .hero img { width: 100%; height: auto; display: block; }
  .credit {
    padding: 0.5rem 0.75rem;
    font-size: 0.7rem;
    color: var(--text-3);
    background: var(--surface-page);
    border-top: 1px solid var(--border-subtle);
  }
  .credit a { color: var(--text-2); text-decoration: underline; text-underline-offset: 2px; }

  .pitch {
    font-size: 1.05rem;
    line-height: 1.55;
    color: var(--text);
    margin: 0 0 1.5rem;
  }

  main { display: flex; flex-direction: column; gap: 2rem; }
  section {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 1.25rem 1.4rem;
  }
  section h2 {
    margin: 0 0 0.75rem;
    font-size: 0.78rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-2);
  }
  .md :global(h2),
  .md :global(h3) {
    margin: 1.25rem 0 0.5rem;
    font-size: 1.05rem;
    color: var(--text);
  }
  .md :global(h2:first-child),
  .md :global(h3:first-child) { margin-top: 0; }
  .md :global(p) { margin: 0.4rem 0 0.75rem; line-height: 1.55; }
  .md :global(ul), .md :global(ol) { padding-left: 1.25rem; }
  .md :global(li) { margin: 0.2rem 0; line-height: 1.5; }
  .md :global(table) { border-collapse: collapse; width: 100%; font-size: 0.9rem; margin: 0.75rem 0; }
  .md :global(th), .md :global(td) {
    border: 1px solid var(--border-subtle);
    padding: 0.4rem 0.6rem; text-align: left;
  }
  .md :global(a) { color: var(--accent); text-decoration: underline; text-underline-offset: 2px; }

  .empty {
    color: var(--text-3);
    font-style: italic;
    padding: 2rem 0;
    text-align: center;
  }

  footer {
    margin-top: 3rem;
    padding-top: 1.5rem;
    border-top: 1px solid var(--border-subtle);
    text-align: center;
    color: var(--text-3);
    font-size: 0.78rem;
  }
  footer strong { color: var(--text-2); }
</style>

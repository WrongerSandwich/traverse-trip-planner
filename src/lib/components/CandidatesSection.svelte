<script>
  let { candidates, isPromoted = () => false } = $props();

  let tab = $state('stops');
  let categoryFilter = $state(null);

  const filteredStops = $derived(
    (candidates?.stops ?? []).filter((s) => !categoryFilter || s.category === categoryFilter)
  );
</script>

{#if !candidates}
  <p class="empty">Candidates appear here after research runs.</p>
{:else}
  <div class="tabs">
    <button class:active={tab === 'stops'} onclick={() => (tab = 'stops')}>Stops ({candidates.stops.length})</button>
    <button class:active={tab === 'lodging'} onclick={() => (tab = 'lodging')}>Lodging ({candidates.lodging.length})</button>
  </div>

  {#if tab === 'stops'}
    {#each filteredStops as stop (stop.id)}
      <article class="card" class:in-plan={isPromoted(stop.id)}>
        <header>
          <h4>{stop.name}</h4>
          <span class="badge cat-{stop.category}">{stop.category}</span>
          {#if isPromoted(stop.id)}<span class="badge in-plan">In plan</span>{/if}
        </header>
        <p class="desc">{stop.description}</p>
        <p class="why"><em>{stop.why_recommended}</em></p>
        {#if stop.source_url}<a href={stop.source_url} target="_blank" rel="noreferrer">Source ↗</a>{/if}
      </article>
    {/each}
  {:else}
    {#each candidates.lodging as l (l.id)}
      <article class="card" class:in-plan={isPromoted(l.id)}>
        <header>
          <h4>{l.name}</h4>
          <span class="badge tier-{l.price_tier}">{l.price_tier}</span>
          {#if l.nights}<span class="nights">{l.nights} nights</span>{/if}
        </header>
        <p class="desc">{l.description}</p>
        {#if l.booking_url}<a href={l.booking_url} target="_blank" rel="noreferrer">Book ↗</a>{/if}
      </article>
    {/each}
  {/if}
{/if}

<style>
  .tabs {
    display: flex;
    gap: 0.5rem;
    border-bottom: 1px solid var(--border-default);
    margin-bottom: 1rem;
  }
  .tabs button {
    background: none;
    border: none;
    padding: 0.5rem 1rem;
    color: var(--text-tertiary);
    cursor: pointer;
    border-bottom: 2px solid transparent;
    font-family: var(--font-sans);
    font-size: 0.85rem;
  }
  .tabs button.active {
    color: var(--text-primary);
    border-bottom-color: var(--accent);
  }
  .card {
    padding: 0.75rem;
    border: 1px solid var(--border-default);
    border-radius: 0.5rem;
    margin-bottom: 0.5rem;
    background: var(--surface-raised);
  }
  .card.in-plan { border-color: var(--accent); }
  .card header {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    margin-bottom: 0.25rem;
  }
  .card h4 {
    margin: 0;
    font-size: 1rem;
    font-family: var(--font-sans);
    font-weight: 500;
    color: var(--text-primary);
  }
  .badge {
    padding: 0.1rem 0.4rem;
    border-radius: 0.25rem;
    font-size: 0.75rem;
    background: var(--surface-sunken);
    color: var(--text-tertiary);
  }
  .badge.in-plan {
    background: var(--accent);
    color: var(--text-inverse);
  }
  .nights {
    font-size: 0.75rem;
    color: var(--text-tertiary);
  }
  .desc {
    margin: 0.25rem 0;
    color: var(--text-secondary);
    font-size: 0.9rem;
  }
  .why {
    margin: 0.25rem 0;
    font-size: 0.85rem;
    color: var(--text-tertiary);
  }
  .card a {
    font-size: 0.8rem;
    color: var(--accent-text);
  }
  .empty {
    color: var(--text-tertiary);
    padding: 1rem;
    text-align: center;
  }
</style>

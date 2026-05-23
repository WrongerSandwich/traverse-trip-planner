<script>
  import { invalidate } from '$app/navigation';

  let { candidates, plan = null, slug, readonly = false } = $props();

  let tab = $state('stops');
  let categoryFilter = $state(null);
  let promoteFor = $state(null); // candidate id whose day-picker is open
  let working = $state(false);
  let error = $state(null);

  const filteredStops = $derived(
    (candidates?.stops ?? []).filter((s) => !categoryFilter || s.category === categoryFilter)
  );

  const promotedIds = $derived(
    new Set([
      ...((plan?.days ?? []).flatMap((d) => d.stops ?? [])),
      ...((plan?.days ?? []).flatMap((d) => (d.lodging_id ? [d.lodging_id] : []))),
    ])
  );

  function isPromotedFn(id) {
    return promotedIds.has(id);
  }

  function lodgingDays(id) {
    return (plan?.days ?? []).filter((d) => d.lodging_id === id).map((d) => d.number);
  }

  async function api(path, opts) {
    working = true;
    error = null;
    try {
      const res = await fetch(path, {
        headers: { 'content-type': 'application/json' },
        ...opts,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `${res.status}`);
      }
      await invalidate('app:trip');
    } catch (err) {
      error = err.message;
    } finally {
      working = false;
    }
  }

  async function promoteStop(id, day) {
    await api(`/api/plan/${slug}/promote`, {
      method: 'POST',
      body: JSON.stringify({ id, day }),
    });
    promoteFor = null;
  }

  async function unPromoteStop(id) {
    await api(`/api/plan/${slug}/un-promote`, {
      method: 'POST',
      body: JSON.stringify({ id }),
    });
  }

  async function setLodgingForDay(dayNumber, id) {
    await api(`/api/plan/${slug}/day/${dayNumber}/lodging`, {
      method: 'PUT',
      body: JSON.stringify({ id }),
    });
    promoteFor = null;
  }
</script>

{#if error}
  <p class="banner-error" role="alert">{error}</p>
{/if}

{#if !candidates}
  <p class="empty">Candidates appear here after research runs.</p>
{:else}
  <div class="tabs">
    <button class:active={tab === 'stops'} onclick={() => (tab = 'stops')}>Stops ({candidates.stops.length})</button>
    <button class:active={tab === 'lodging'} onclick={() => (tab = 'lodging')}>Lodging ({candidates.lodging.length})</button>
  </div>

  {#if tab === 'stops'}
    {#each filteredStops as stop (stop.id)}
      <article class="card" class:in-plan={isPromotedFn(stop.id)}>
        <header>
          <h4>{stop.name}</h4>
          <span class="badge cat-{stop.category}">{stop.category}</span>
          {#if isPromotedFn(stop.id)}
            <span class="badge in-plan">In plan</span>
            <button
              class="btn-inline"
              onclick={() => unPromoteStop(stop.id)}
              disabled={working || readonly}
            >Un-promote</button>
          {:else}
            <button
              class="btn-inline"
              onclick={() => (promoteFor = promoteFor === stop.id ? null : stop.id)}
              disabled={working || readonly}
            >Promote to day…</button>
          {/if}
        </header>
        <p class="desc">{stop.description}</p>
        {#if stop.why_recommended}<p class="why"><em>{stop.why_recommended}</em></p>{/if}
        {#if stop.source_url}<a href={stop.source_url} target="_blank" rel="noreferrer">Source ↗</a>{/if}
        {#if promoteFor === stop.id}
          <div class="day-picker">
            {#each plan?.days ?? [] as d (d.number)}
              <button
                class="picker-item"
                onclick={() => promoteStop(stop.id, d.number)}
                disabled={working || readonly}
              >Day {d.number}</button>
            {/each}
            {#if !(plan?.days?.length)}
              <button
                class="picker-item"
                onclick={() => promoteStop(stop.id, null)}
                disabled={working || readonly}
              >Create Day 1</button>
            {/if}
          </div>
        {/if}
      </article>
    {/each}
  {:else}
    {#each candidates.lodging as l (l.id)}
      {@const daysUsed = lodgingDays(l.id)}
      <article class="card" class:in-plan={isPromotedFn(l.id)}>
        <header>
          <h4>{l.name}</h4>
          <span class="badge tier-{l.price_tier}">{l.price_tier}</span>
          {#if l.nights}<span class="nights">{l.nights} nights</span>{/if}
          {#if daysUsed.length > 0}
            <span class="badge in-plan">In plan · Day{daysUsed.length > 1 ? 's' : ''} {daysUsed.join(', ')}</span>
          {/if}
          <button
            class="btn-inline"
            onclick={() => (promoteFor = promoteFor === l.id ? null : l.id)}
            disabled={working || readonly}
          >Set lodging for day…</button>
        </header>
        <p class="desc">{l.description}</p>
        {#if l.booking_url}<a href={l.booking_url} target="_blank" rel="noreferrer">Book ↗</a>{/if}
        {#if promoteFor === l.id}
          <div class="day-picker">
            {#each plan?.days ?? [] as d (d.number)}
              <button
                class="picker-item"
                onclick={() => setLodgingForDay(d.number, l.id)}
                disabled={working || readonly}
              >Day {d.number}{#if d.lodging_id === l.id} (currently set){/if}</button>
            {/each}
            {#each daysUsed as n (n)}
              <button
                class="picker-item"
                onclick={() => setLodgingForDay(n, null)}
                disabled={working || readonly}
              >Clear from Day {n}</button>
            {/each}
            {#if !(plan?.days?.length)}
              <p class="picker-empty">Add a day in the Plan section first.</p>
            {/if}
          </div>
        {/if}
      </article>
    {/each}
  {/if}
{/if}

<style>
  .banner-error {
    padding: 0.5rem 0.75rem;
    background: var(--state-danger-surface);
    color: var(--text-primary);
    border-left: 3px solid var(--state-danger);
    border-radius: 0.25rem;
    margin-bottom: 1rem;
    font-family: var(--font-sans);
    font-size: 0.9rem;
  }
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
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.25rem;
    flex-wrap: wrap;
  }
  .card h4 {
    margin: 0;
    font-size: 1rem;
    font-family: var(--font-sans);
    font-weight: 500;
    color: var(--text-primary);
    flex: 1;
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
  .btn-inline {
    background: none;
    border: 1px solid var(--border-default);
    padding: 0.25rem 0.5rem;
    border-radius: 0.25rem;
    color: var(--text-primary);
    cursor: pointer;
    font-family: var(--font-sans);
    font-size: 0.8rem;
  }
  .btn-inline:hover:not(:disabled) {
    background: var(--surface-sunken);
  }
  .btn-inline:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .day-picker {
    margin-top: 0.5rem;
    padding: 0.5rem;
    background: var(--surface-sunken);
    border-radius: 0.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .picker-item {
    display: block;
    width: 100%;
    text-align: left;
    padding: 0.4rem 0.5rem;
    background: none;
    border: 1px solid var(--border-default);
    border-radius: 0.25rem;
    cursor: pointer;
    color: var(--text-primary);
    font-family: var(--font-sans);
    font-size: 0.85rem;
  }
  .picker-item:hover:not(:disabled) {
    background: var(--surface-raised);
  }
  .picker-item:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .picker-empty {
    margin: 0;
    color: var(--text-tertiary);
    font-size: 0.85rem;
  }
</style>

<script>
  import { failureSentence } from '$lib/errors-registry.js';

  let {
    open = $bindable(false),
    trip,
    onclose,
    onsaved,
  } = $props();

  let query     = $state('');
  let photos    = $state([]);
  let pick      = $state(0);
  let busy      = $state(false);
  let saving    = $state(false);
  let errorCode = $state(null);
  let initialQuery = $state('');
  let cancelBtn = $state(null);
  let saveBtn   = $state(null);
  let previousFocus = null;

  // Seed local state when the modal opens.
  $effect(() => {
    if (!open || !trip) return;
    initialQuery = trip.image_query || trip.title || trip.destination || '';
    query  = initialQuery;
    photos = trip._image?.photos ?? (trip._image ? [trip._image] : []);
    pick   = 0; // the live `_image.photos` is already in picked-first order
    busy   = false;
    errorCode = null;
    previousFocus = document.activeElement;
    queueMicrotask(() => saveBtn?.focus());
  });

  $effect(() => {
    if (!open && previousFocus) { previousFocus.focus(); previousFocus = null; }
  });

  const queryDirty = $derived(query.trim() !== initialQuery.trim());
  const canSearch  = $derived(!!query.trim() && !busy);
  const canSave    = $derived(!saving && photos.length > 0);

  async function search() {
    if (!canSearch) return;
    busy = true;
    errorCode = null;
    try {
      const url = `/api/trip/${encodeURIComponent(trip._slug)}/image/search?q=${encodeURIComponent(query.trim())}`;
      const res = await fetch(url);
      if (res.status === 503) { errorCode = 'image_search_unconfigured'; return; }
      if (!res.ok) { errorCode = 'image_search_failed'; return; }
      const data = await res.json();
      if (!data.photos?.length) { errorCode = 'image_search_failed'; photos = []; pick = 0; return; }
      photos = data.photos;
      pick = 0;
    } catch {
      errorCode = 'image_search_failed';
    } finally {
      busy = false;
    }
  }

  async function save() {
    if (!canSave) return;
    saving = true;
    errorCode = null;
    const patch = {};
    if (queryDirty) patch.image_query = query.trim();
    patch.image_pick = pick;
    try {
      const res = await fetch(`/api/trip/${encodeURIComponent(trip._slug)}/image`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) { errorCode = 'image_save_failed'; return; }
      open = false;
      onsaved?.();
    } catch {
      errorCode = 'image_save_failed';
    } finally {
      saving = false;
    }
  }

  function cancel() {
    open = false;
    onclose?.();
  }

  function handleKey(e) {
    if (!open) return;
    if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  }
</script>

<svelte:window onkeydown={handleKey} />

{#if open}
  <div class="backdrop" onclick={cancel} role="presentation"></div>

  <div class="modal" role="dialog" aria-modal="true" aria-labelledby="cover-title">
    <div class="modal-body">
      <h2 id="cover-title" class="modal-title">Change cover photo</h2>

      <label class="field-label" for="cover-query">Pexels search</label>
      <div class="query-row">
        <input
          id="cover-query"
          type="text"
          bind:value={query}
          placeholder="e.g. Glacier mountains"
          disabled={busy || saving}
        />
        <button
          class="btn btn-secondary btn-compact"
          onclick={search}
          disabled={!canSearch || !queryDirty}
          title={queryDirty ? 'Search Pexels with this query' : 'Edit the query to re-search'}
        >
          {busy ? 'Searching…' : 'Re-search'}
        </button>
      </div>

      <div class="tiles" role="radiogroup" aria-label="Pick a cover photo">
        {#each photos as photo, i (photo.medium)}
          <button
            class="tile"
            class:active={i === pick}
            role="radio"
            aria-checked={i === pick}
            onclick={() => (pick = i)}
            disabled={saving}
          >
            <img src={photo.medium} alt="" loading="lazy" />
            {#if i === pick}<span class="tile-check" aria-hidden="true">✓</span>{/if}
          </button>
        {/each}
        {#if photos.length === 0 && !busy}
          <div class="tiles-empty">No photos to pick from yet.</div>
        {/if}
      </div>

      {#if photos[pick]?.photographer}
        <p class="credit">
          Photo by
          {#if photos[pick].photographer_url}
            <a href={photos[pick].photographer_url} target="_blank" rel="noopener">{photos[pick].photographer}</a>
          {:else}
            {photos[pick].photographer}
          {/if}
          / Pexels
        </p>
      {/if}

      {#if errorCode}
        <p class="error" role="alert">{failureSentence(errorCode)}</p>
      {/if}
    </div>

    <div class="modal-actions">
      <button class="btn btn-tertiary" bind:this={cancelBtn} onclick={cancel} disabled={saving}>Cancel</button>
      <button class="btn btn-primary" bind:this={saveBtn} onclick={save} disabled={!canSave}>
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed; inset: 0;
    background: rgba(0, 0, 0, 0.45);
    z-index: 998;
  }
  .modal {
    position: fixed;
    top: 50%; left: 50%;
    transform: translate(-50%, -50%);
    width: min(480px, calc(100vw - 2rem));
    background: var(--surface-overlay);
    color: var(--text-primary);
    border-radius: 10px;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.35);
    z-index: 999;
    overflow: hidden;
    font-family: var(--font-sans);
  }
  .modal-body { padding: 1.4rem 1.4rem 0.9rem; }
  .modal-title {
    font-family: var(--font-serif);
    font-size: 1.1rem;
    font-weight: 500;
    margin: 0 0 0.9rem;
    color: var(--text-primary);
  }
  .field-label {
    display: block;
    font-size: 0.78rem;
    color: var(--text-secondary);
    margin-bottom: 0.3rem;
  }
  .query-row {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 0.9rem;
  }
  .query-row input {
    flex: 1;
    padding: 0.4rem 0.55rem;
    border: 1px solid var(--border-subtle);
    border-radius: 6px;
    background: var(--surface-sunken);
    color: var(--text-primary);
    font: inherit;
  }
  .tiles {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.5rem;
    margin-bottom: 0.45rem;
  }
  .tile {
    position: relative;
    padding: 0;
    border: 2px solid transparent;
    border-radius: 6px;
    overflow: hidden;
    background: var(--surface-sunken);
    cursor: pointer;
    aspect-ratio: 4 / 3;
  }
  .tile img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .tile.active { border-color: var(--accent); }
  .tile-check {
    position: absolute;
    top: 4px; right: 4px;
    width: 18px; height: 18px;
    border-radius: 50%;
    background: var(--accent);
    color: var(--surface-overlay);
    font-size: 12px;
    display: grid; place-items: center;
  }
  .tiles-empty {
    grid-column: 1 / -1;
    padding: 1.2rem 0;
    text-align: center;
    color: var(--text-secondary);
    font-size: 0.85rem;
  }
  .credit {
    font-size: 0.74rem;
    color: var(--text-secondary);
    margin: 0;
  }
  .credit a { color: inherit; text-decoration: underline; }
  .error {
    margin: 0.6rem 0 0;
    color: var(--state-danger);
    font-size: 0.85rem;
  }
  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.6rem;
    padding: 0.75rem 1.4rem 1.1rem;
  }
</style>

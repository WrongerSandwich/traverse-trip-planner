<script>
  import { untrack } from 'svelte';
  import { goto, invalidateAll } from '$app/navigation';
  import { streamAction } from '$lib/utils/action.js';

  let { data } = $props();

  const trip = $derived(data.trip);
  // Snapshot of brochure data we'll mutate locally before save. The
  // initializer reads `data` but isn't meant to track it — the $effect
  // below handles re-sync on regenerate. untrack() makes that explicit
  // and silences the "captures initial value" lint.
  let proposal = $state(untrack(() => structuredClone(data.brochureData)));
  $effect(() => { proposal = structuredClone(data.brochureData); });

  // Photo options come from the trip's enriched _image.photos (when fresh
  // multi-photo cache exists) or fall back to a one-element array.
  const photos = $derived(trip?._image?.photos ?? (trip?._image ? [trip._image] : []));

  // Keep flags: parallel arrays of include-or-not toggles. We don't strip
  // unchecked items until save — preserving user edits across toggles.
  let keepStops = $state([]);
  let keepLodging = $state([]);
  let keepNotes = $state([]);
  let keepGotchas = $state([]);

  $effect(() => {
    keepStops = (proposal?.stops ?? []).map(() => true);
    keepLodging = (proposal?.lodging ?? []).map(() => true);
    keepNotes = (proposal?.field_guide_notes ?? []).map(() => true);
    keepGotchas = (proposal?.gotchas ?? []).map(() => true);
  });

  let busy = $state(false);
  let statusLog = $state([]);
  let error = $state(null);

  async function generate() {
    if (busy) return;
    busy = true;
    error = null;
    statusLog = [];
    try {
      await streamAction(`/api/brochure/prepare/${encodeURIComponent(trip._slug)}`, ({ msg, done }) => {
        statusLog = [...statusLog, msg];
        if (done && !msg.toLowerCase().startsWith('error')) {
          // brochure.md is now on disk — reload so the form populates from it
          invalidateAll();
        }
      });
    } catch (e) {
      error = e.message;
    } finally {
      busy = false;
    }
  }

  async function regeocode() {
    if (busy) return;
    busy = true;
    error = null;
    statusLog = [];
    try {
      await streamAction(`/api/brochure/regeocode/${encodeURIComponent(trip._slug)}`, ({ msg, done }) => {
        statusLog = [...statusLog, msg];
        if (done && !msg.toLowerCase().startsWith('error')) {
          invalidateAll();
        }
      });
    } catch (e) {
      error = e.message;
    } finally {
      busy = false;
    }
  }

  // Count stops missing coords so the button can say something useful.
  const missingCoordsCount = $derived(
    (proposal?.stops ?? []).filter(s => !Array.isArray(s.coords)).length,
  );

  async function save() {
    if (busy || !proposal) return;
    busy = true;
    error = null;
    try {
      const toSave = structuredClone(proposal);
      toSave.stops = (toSave.stops ?? []).filter((_, i) => keepStops[i]);
      toSave.lodging = (toSave.lodging ?? []).filter((_, i) => keepLodging[i]);
      toSave.field_guide_notes = (toSave.field_guide_notes ?? []).filter((_, i) => keepNotes[i]);
      toSave.gotchas = (toSave.gotchas ?? []).filter((_, i) => keepGotchas[i]);

      const res = await fetch(`/api/brochure/save/${encodeURIComponent(trip._slug)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: toSave }),
      });
      if (!res.ok) throw new Error(`Save failed: ${res.status}`);
      // Land on the rendered brochure
      goto(`/trips/${encodeURIComponent(trip._slug)}/brochure`);
    } catch (e) {
      error = e.message;
      busy = false;
    }
  }

  // Counts for the live summary line
  const keepStopsCount = $derived(keepStops.filter(Boolean).length);
  const keepLodgingCount = $derived(keepLodging.filter(Boolean).length);
  const keepNotesCount = $derived(keepNotes.filter(Boolean).length);
  const keepGotchasCount = $derived(keepGotchas.filter(Boolean).length);
</script>

<svelte:head>
  <title>Prepare brochure — {trip?.title || trip?._slug}</title>
</svelte:head>

<div class="page">
  <header class="page-header">
    <a class="back" href={`/trips/${encodeURIComponent(trip?._slug || '')}`}>← {trip?.title || 'Trip'}</a>
    <h1>Prepare brochure</h1>
    <p class="lede">
      {#if proposal}
        Toggle stops, lodging, notes, and gotchas you'd like to keep. Your
        choices write to <code>brochure.md</code> and shape what the printable
        brochure shows.
      {:else}
        No brochure proposal yet. Generate one from the trip's planning notes
        — the Field guide will read your overview, route, stops, logistics,
        and itinerary and propose a structured set of brochure content for
        you to review.
      {/if}
    </p>
  </header>

  {#if error}
    <div class="error-banner">Error: {error}</div>
  {/if}

  {#if !proposal}
    <!-- No brochure.md yet — show the Generate CTA. -->
    <div class="cta">
      <button class="btn btn-primary" disabled={busy} onclick={generate}>
        {busy ? 'Generating proposal…' : 'Generate proposal'}
      </button>
      <p class="cta-hint">Takes 15–30 seconds. Uses your default model.</p>
    </div>

    {#if statusLog.length}
      <ul class="status-log">
        {#each statusLog as line}<li>{line}</li>{/each}
      </ul>
    {/if}
  {:else}
    <!-- Brochure.md exists — show review form. -->

    <section class="block">
      <h2>Identity</h2>
      <label class="field">
        <span>Title</span>
        <input class="text-input" type="text" bind:value={proposal.title} />
      </label>
      <label class="field">
        <span>Subtitle</span>
        <input class="text-input" type="text" bind:value={proposal.subtitle} />
      </label>
    </section>

    {#if photos.length > 1}
      <section class="block">
        <h2>Cover photo</h2>
        <p class="hint">Choose which Pexels result lands on the cover.</p>
        <div class="photo-grid">
          {#each photos as photo, i}
            <label class="photo-option" class:active={proposal.cover_image === photo.large}>
              <input type="radio" name="cover" value={photo.large} bind:group={proposal.cover_image} />
              <img src={photo.medium} alt="" />
              <span class="photo-credit">by {photo.photographer}</span>
            </label>
          {/each}
        </div>
      </section>
    {/if}

    {#if proposal.stops?.length}
      <section class="block">
        <h2>Stops <span class="count">{keepStopsCount} of {proposal.stops.length}</span></h2>
        <ul class="checklist">
          {#each proposal.stops as stop, i}
            <li class:dimmed={!keepStops[i]}>
              <label>
                <input type="checkbox" bind:checked={keepStops[i]} />
                <div class="item-body">
                  <div class="item-head">
                    <span class="item-name">{stop.name}</span>
                    {#if stop.category}<span class="item-tag">{stop.category}</span>{/if}
                    {#if stop.must_see}<span class="item-anchor">must see</span>{/if}
                  </div>
                  {#if stop.notes}<p class="item-notes">{stop.notes}</p>{/if}
                </div>
              </label>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    {#if proposal.lodging?.length}
      <section class="block">
        <h2>Lodging <span class="count">{keepLodgingCount} of {proposal.lodging.length}</span></h2>
        <ul class="checklist">
          {#each proposal.lodging as lodge, i}
            <li class:dimmed={!keepLodging[i]}>
              <label>
                <input type="checkbox" bind:checked={keepLodging[i]} />
                <div class="item-body">
                  <div class="item-head">
                    <span class="item-name">{lodge.name}</span>
                    {#if lodge.nights}<span class="item-tag">{lodge.nights} night{lodge.nights === 1 ? '' : 's'}</span>{/if}
                  </div>
                  {#if lodge.address}<p class="item-notes">{lodge.address}</p>{/if}
                </div>
              </label>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    {#if proposal.field_guide_notes?.length}
      <section class="block">
        <h2>Field guide notes <span class="count">{keepNotesCount} of {proposal.field_guide_notes.length}</span></h2>
        <ul class="checklist">
          {#each proposal.field_guide_notes as note, i}
            <li class:dimmed={!keepNotes[i]}>
              <label>
                <input type="checkbox" bind:checked={keepNotes[i]} />
                <div class="item-body">
                  <p class="note-text">{note}</p>
                </div>
              </label>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    {#if proposal.gotchas?.length}
      <section class="block">
        <h2>Before-you-go <span class="count">{keepGotchasCount} of {proposal.gotchas.length}</span></h2>
        <ul class="checklist">
          {#each proposal.gotchas as gotcha, i}
            <li class:dimmed={!keepGotchas[i]}>
              <label>
                <input type="checkbox" bind:checked={keepGotchas[i]} />
                <div class="item-body">
                  <p class="note-text">{gotcha}</p>
                </div>
              </label>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    <div class="actions">
      <button class="btn btn-primary" disabled={busy} onclick={save}>
        {busy ? 'Saving…' : 'Save brochure'}
      </button>
      {#if missingCoordsCount > 0}
        <button class="btn btn-secondary" disabled={busy} onclick={regeocode} title="Try fallback geocode queries for stops without coords. No AI call.">
          Fill in {missingCoordsCount} missing pin{missingCoordsCount === 1 ? '' : 's'}
        </button>
      {/if}
      <button class="btn btn-secondary" disabled={busy} onclick={generate} title="Re-run the AI extraction — overwrites any edits in brochure.md">
        Re-generate from notes
      </button>
      <a class="btn btn-tertiary" href={`/trips/${encodeURIComponent(trip._slug)}/brochure`}>View brochure</a>
    </div>

    {#if statusLog.length}
      <ul class="status-log">
        {#each statusLog as line}<li>{line}</li>{/each}
      </ul>
    {/if}
  {/if}
</div>

<style>
  :global(body) { background: var(--surface-page); }

  .page {
    max-width: 760px;
    margin: 0 auto;
    padding: 2rem 1.5rem 4rem;
    font-family: var(--font-sans);
    color: var(--text-primary);
  }
  .page-header { margin-bottom: 2rem; }
  .back {
    display: inline-block;
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--bone-600);
    text-decoration: none;
    margin-bottom: 1rem;
  }
  .back:hover { color: var(--forest-800); }
  h1 {
    font-family: var(--font-serif);
    font-size: 32px;
    line-height: 1.1;
    font-weight: 500;
    letter-spacing: 0.003em;
    margin: 0 0 0.75rem;
    color: var(--forest-800);
  }
  .lede {
    font-family: var(--font-sans);
    font-size: 14px;
    line-height: 1.6;
    color: var(--bark-800);
    margin: 0;
    max-width: 56ch;
  }
  .lede code {
    font-family: var(--font-mono);
    font-size: 12px;
    background: var(--surface-raised);
    padding: 1px 5px;
    border-radius: 3px;
  }

  .error-banner {
    background: var(--sunset-50);
    border: 0.5px solid var(--embers-600);
    color: var(--embers-600);
    padding: 0.75rem 1rem;
    border-radius: 4px;
    margin-bottom: 1.5rem;
    font-family: var(--font-mono);
    font-size: 12px;
  }

  .cta {
    text-align: center;
    padding: 3rem 1rem;
    background: var(--surface-raised);
    border: 0.5px solid var(--bone-400);
    border-radius: 8px;
  }
  .cta-hint {
    font-family: var(--font-sans);
    font-size: 12px;
    color: var(--bone-600);
    margin: 0.75rem 0 0;
  }

  .block {
    margin: 2rem 0 0;
    padding-top: 1.5rem;
    border-top: 0.5px solid var(--bone-400);
  }
  .block:first-of-type {
    border-top: none;
    padding-top: 0;
  }
  h2 {
    font-family: var(--font-serif);
    font-size: 20px;
    font-weight: 500;
    color: var(--forest-800);
    margin: 0 0 0.5rem;
    display: flex;
    align-items: baseline;
    gap: 12px;
  }
  .count {
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 500;
    color: var(--bone-600);
    letter-spacing: 0.12em;
  }
  .hint {
    font-family: var(--font-sans);
    font-size: 12px;
    color: var(--bone-600);
    margin: 0 0 0.75rem;
  }

  .field {
    display: block;
    margin: 0.75rem 0;
  }
  .field > span {
    display: block;
    font-family: var(--font-mono);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.18em;
    color: var(--bone-600);
    margin-bottom: 4px;
  }
  .text-input {
    width: 100%;
    font-family: var(--font-sans);
    font-size: 15px;
    padding: 8px 12px;
    border: 0.5px solid var(--bone-400);
    border-radius: 4px;
    background: var(--surface-raised);
    color: var(--text-primary);
  }
  .text-input:focus {
    outline: none;
    border-color: var(--forest-800);
  }

  .photo-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
  }
  .photo-option {
    display: block;
    cursor: pointer;
    border: 2px solid transparent;
    border-radius: 4px;
    overflow: hidden;
    transition: border-color 0.15s ease;
  }
  .photo-option.active { border-color: var(--sunset-600); }
  .photo-option input { position: absolute; opacity: 0; pointer-events: none; }
  .photo-option img { width: 100%; height: auto; display: block; aspect-ratio: 5 / 3; object-fit: cover; }
  .photo-credit {
    display: block;
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--bone-600);
    padding: 4px 6px;
    background: var(--surface-raised);
  }

  .checklist {
    list-style: none;
    margin: 0.75rem 0 0;
    padding: 0;
  }
  .checklist > li {
    padding: 10px 0;
    border-bottom: 0.5px solid var(--bone-400);
    transition: opacity 0.15s ease;
  }
  .checklist > li:last-child { border-bottom: none; }
  .checklist > li.dimmed { opacity: 0.4; }
  .checklist label {
    display: grid;
    grid-template-columns: 22px 1fr;
    gap: 12px;
    cursor: pointer;
    align-items: start;
  }
  .checklist input[type="checkbox"] {
    margin-top: 4px;
    width: 16px;
    height: 16px;
    accent-color: var(--forest-800);
    cursor: pointer;
  }
  .item-head {
    display: flex;
    align-items: baseline;
    gap: 10px;
    flex-wrap: wrap;
    margin-bottom: 2px;
  }
  .item-name {
    font-family: var(--font-serif);
    font-size: 16px;
    font-weight: 500;
    color: var(--forest-800);
  }
  .item-tag {
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.18em;
    color: var(--bone-600);
    padding: 1px 6px;
    border: 0.5px solid var(--bone-400);
    border-radius: 2px;
  }
  .item-anchor {
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.18em;
    color: var(--sunset-600);
  }
  .item-notes {
    font-family: var(--font-sans);
    font-size: 13px;
    line-height: 1.5;
    color: var(--bark-800);
    margin: 4px 0 0;
  }
  .note-text {
    font-family: var(--font-serif);
    font-size: 14px;
    line-height: 1.55;
    color: var(--bark-800);
    font-style: italic;
    margin: 0;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    margin-top: 2.5rem;
    padding-top: 1.5rem;
    border-top: 0.5px solid var(--bone-400);
  }

  .status-log {
    list-style: none;
    margin: 1.5rem 0 0;
    padding: 0.75rem 1rem;
    background: var(--surface-raised);
    border-radius: 4px;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--bark-800);
  }
  .status-log li { padding: 2px 0; }
</style>

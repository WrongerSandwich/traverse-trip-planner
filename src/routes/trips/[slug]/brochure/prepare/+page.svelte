<script>
  import { untrack } from 'svelte';
  import { goto, invalidateAll } from '$app/navigation';
  import { streamAction } from '$lib/utils/action.js';
  import { parseCoordInput } from '$lib/utils/coords.js';
  import PromiseTooltip from '$lib/components/PromiseTooltip.svelte';
  import { failureSentence } from '$lib/errors-registry.js';

  let { data } = $props();

  // Mirror of src/routes/api/brochure/regeocode/[slug]/+server.js _promise,
  // used as a synchronous fallback. Telemetry-resolved values come from
  // `data.promises.regeocode` (see src/lib/server/promises.js). Regeocode
  // doesn't call chat() so its tokens stay zero regardless.
  const REGEOCODE_FALLBACK = {
    verb: 'Re-geocode stops',
    produces: 'Updated map pin coordinates for any stops that were missing a location on the brochure.',
    time_seconds: 8,
    tokens_range: [0, 0],
  };
  const REGEOCODE_PROMISE = $derived(data.promises?.regeocode ?? REGEOCODE_FALLBACK);

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

  // ── Regeocode — Instant Inline (docs/ai-workflow-ux.md §2.1) ─────────────
  let regeoStatus        = $state('idle');   // 'idle' | 'in_progress' | 'success' | 'failure'
  let regeoErrorCode     = $state(null);
  let regeoGeocodedCount = $state(null);     // # of new pins added (null = not run yet)
  let regeoLog           = $state([]);       // SSE messages for <details> disclosure
  let regeoToastTimer    = $state(null);     // setTimeout handle for success auto-dismiss

  async function regeocode() {
    if (regeoStatus === 'in_progress') return;

    if (regeoToastTimer) { clearTimeout(regeoToastTimer); regeoToastTimer = null; }

    regeoStatus        = 'in_progress';
    regeoErrorCode     = null;
    regeoGeocodedCount = null;
    regeoLog           = [];

    try {
      await streamAction(
        `/api/brochure/regeocode/${encodeURIComponent(trip._slug)}`,
        ({ msg, done }) => {
          regeoLog = [...regeoLog, msg];
          if (!done) return;

          const isErr = typeof msg === 'string' && msg.toLowerCase().startsWith('error');
          if (isErr) {
            regeoStatus    = 'failure';
            regeoErrorCode = 'network_error';
          } else {
            // Extract count from the server's done message.
            // Patterns: "Added 2 new stop pins. …" or "No new pins found. …"
            const added = msg.match(/Added (\d+) new (stop|lodging) pin/);
            regeoStatus        = 'success';
            regeoGeocodedCount = added ? parseInt(added[1], 10) : 0;
            invalidateAll();
            // Auto-dismiss the success toast after 4s
            regeoToastTimer = setTimeout(() => {
              regeoStatus     = 'idle';
              regeoToastTimer = null;
            }, 4000);
          }
        },
      );
    } catch (e) {
      regeoLog       = [...regeoLog, `Error: ${e.message}`];
      regeoStatus    = 'failure';
      regeoErrorCode = 'network_error';
    }
  }

  function retryRegeocode() {
    regeocode();
  }

  function dismissRegeoError() {
    regeoStatus    = 'idle';
    regeoErrorCode = null;
  }

  // Kick off the Ambient Background brochure-prepare job. The route returns
  // 202 immediately; progress + success/failure are surfaced by the global
  // jobs indicator. When the user dismisses or opens the success toast,
  // invalidateAll() picks up the new brochure.md on the next nav.
  async function generate() {
    if (busy) return;
    busy = true;
    error = null;
    statusLog = ['Submitting…'];
    try {
      const res = await fetch(`/api/brochure/prepare/${encodeURIComponent(trip._slug)}`, { method: 'POST' });
      if (res.status === 409) {
        error = 'Already preparing this brochure — watch the indicator at the top of the page.';
        return;
      }
      if (!res.ok && res.status !== 202) {
        error = `Couldn't start brochure prep (${res.status}).`;
        return;
      }
      statusLog = [
        ...statusLog,
        'Brochure prep is running in the background — the indicator at the top of the page will tell you when the draft is ready. You can navigate away.',
      ];
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

  // ── Manual coord entry ──────────────────────────────────────────────────
  // Input text and error messages indexed as 's{i}' (stop) or 'l{i}' (lodge).
  // editingCoord tracks which already-mapped rows have their input open.
  let coordInputs = $state({});
  let coordErrors = $state({});
  let editingCoord = $state({});

  // Reset coord state whenever the server-side brochure data is reloaded
  // (after generate or regeocode), so stale inputs don't linger.
  $effect(() => {
    data.brochureData; // track the reload trigger
    coordInputs = {};
    coordErrors = {};
    editingCoord = {};
  });

  function handleCoordInput(prefix, i, value) {
    const key = `${prefix}${i}`;
    coordInputs[key] = value;
    if (!value.trim()) {
      coordErrors[key] = '';
      return;
    }
    const parsed = parseCoordInput(value);
    if (parsed) {
      coordErrors[key] = '';
      if (prefix === 's') {
        proposal.stops[i].coords = parsed;
      } else {
        proposal.lodging[i].coords = parsed;
      }
    } else {
      coordErrors[key] = 'Enter a lat, lon pair or Google Maps URL';
    }
  }

  function startEditCoord(prefix, i) {
    const key = `${prefix}${i}`;
    const item = prefix === 's' ? proposal.stops[i] : proposal.lodging[i];
    coordInputs[key] = item.coords ? `${item.coords[0]}, ${item.coords[1]}` : '';
    coordErrors[key] = '';
    editingCoord[key] = true;
  }
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

  {#if data.brochureStale && proposal}
    <div class="brochure-stale-notice">
      <span>Sections have changed since this brochure was prepared — re-generate to pick up the latest content.</span>
      <button class="btn btn-secondary btn-compact" onclick={generate} disabled={busy}>Re-prepare brochure</button>
    </div>
  {/if}

  {#if !proposal}
    <!-- No brochure.md yet — show the Generate CTA. -->
    <div class="cta">
      <button class="btn btn-primary" disabled={busy} onclick={generate}>
        {busy ? 'Submitting…' : 'Generate proposal'}
      </button>
      <p class="cta-hint">Runs in the background (~45s). You can navigate away — the indicator at the top of the page surfaces the result when it's ready.</p>
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
                    {#if !stop.coords}<span class="item-tag item-unmapped">unmapped</span>{/if}
                  </div>
                  {#if stop.notes}<p class="item-notes">{stop.notes}</p>{/if}
                </div>
              </label>
              <div class="coord-row">
                {#if !stop.coords || editingCoord[`s${i}`]}
                  <input
                    class="coord-input"
                    type="text"
                    placeholder="39.0686, −92.9457 or Google Maps URL"
                    value={coordInputs[`s${i}`] ?? ''}
                    oninput={e => handleCoordInput('s', i, e.currentTarget.value)}
                  />
                  {#if coordErrors[`s${i}`]}<span class="coord-error">{coordErrors[`s${i}`]}</span>{/if}
                {:else}
                  <button class="edit-coord-btn" onclick={() => startEditCoord('s', i)}>Edit location</button>
                {/if}
              </div>
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
                    {#if !lodge.coords}<span class="item-tag item-unmapped">unmapped</span>{/if}
                  </div>
                  {#if lodge.address}<p class="item-notes">{lodge.address}</p>{/if}
                </div>
              </label>
              <div class="coord-row">
                {#if !lodge.coords || editingCoord[`l${i}`]}
                  <input
                    class="coord-input"
                    type="text"
                    placeholder="39.0686, −92.9457 or Google Maps URL"
                    value={coordInputs[`l${i}`] ?? ''}
                    oninput={e => handleCoordInput('l', i, e.currentTarget.value)}
                  />
                  {#if coordErrors[`l${i}`]}<span class="coord-error">{coordErrors[`l${i}`]}</span>{/if}
                {:else}
                  <button class="edit-coord-btn" onclick={() => startEditCoord('l', i)}>Edit location</button>
                {/if}
              </div>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    {#if proposal.field_guide_notes?.length}
      <section class="block">
        <h2>What to expect <span class="count">{keepNotesCount} of {proposal.field_guide_notes.length}</span></h2>
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
        <h2>Don't forget <span class="count">{keepGotchasCount} of {proposal.gotchas.length}</span></h2>
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
      <button class="btn btn-primary" disabled={busy || regeoStatus === 'in_progress'} onclick={save}>
        {busy ? 'Saving…' : 'Save brochure'}
      </button>
      {#if missingCoordsCount > 0}
        <!-- Instant Inline: regeocode button is the spinner (docs/ai-workflow-ux.md §2.1) -->
        <PromiseTooltip promise={REGEOCODE_PROMISE}>
          <button
            class="btn btn-secondary regeo-btn"
            class:regeo-running={regeoStatus === 'in_progress'}
            disabled={regeoStatus === 'in_progress' || busy}
            aria-busy={regeoStatus === 'in_progress'}
            onclick={regeocode}
          >
            {#if regeoStatus === 'in_progress'}
              <span class="regeo-spinner" aria-hidden="true"></span>
              Re-geocoding…
            {:else}
              Fill in {missingCoordsCount} missing pin{missingCoordsCount === 1 ? '' : 's'}
            {/if}
          </button>
        </PromiseTooltip>
      {/if}
      <button class="btn btn-secondary" disabled={busy || regeoStatus === 'in_progress'} onclick={generate} title="Re-run the AI extraction — overwrites any edits in brochure.md">
        Re-generate from notes
      </button>
      <a class="btn btn-tertiary" href={`/trips/${encodeURIComponent(trip._slug)}/brochure`}>View brochure</a>
    </div>

    <!-- Instant Inline: SSE log as collapsed disclosure -->
    {#if regeoLog.length > 0}
      <details class="regeo-log-disclosure">
        <summary>Geocoding details</summary>
        <div class="regeo-log">
          {#each regeoLog as line}
            <div class="regeo-log-line">{line}</div>
          {/each}
        </div>
      </details>
    {/if}

    <!-- Instant Inline: success toast — auto-dismisses after 4s -->
    {#if regeoStatus === 'success'}
      <div class="regeo-toast" role="status" aria-live="polite">
        {regeoGeocodedCount ? `✓ ${regeoGeocodedCount} stop${regeoGeocodedCount === 1 ? '' : 's'} geocoded` : '✓ No new pins found'}
      </div>
    {/if}

    <!-- Instant Inline: failure envelope with registry-resolved sentence + affordances -->
    {#if regeoStatus === 'failure'}
      <div class="regeo-error" role="alert">
        <p class="regeo-error-sentence">{failureSentence(regeoErrorCode)}</p>
        <div class="regeo-error-actions">
          <button class="btn btn-secondary btn-compact" onclick={retryRegeocode}>Retry</button>
          <button class="btn btn-tertiary btn-compact" onclick={dismissRegeoError}>Dismiss</button>
        </div>
      </div>
    {/if}

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

  .brochure-stale-notice {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.6rem 1rem;
    background: var(--amber-50, #fffbeb);
    border: 1px solid var(--amber-300, #fcd34d);
    border-radius: 6px;
    font-size: 0.85rem;
    color: var(--amber-800, #92400e);
    margin-bottom: 1rem;
  }
  .brochure-stale-notice span { flex: 1; }

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

  .item-unmapped {
    color: var(--bone-600);
    border-color: var(--bone-400);
    opacity: 0.8;
  }

  .coord-row {
    padding-left: 34px; /* 22px checkbox + 12px gap */
    margin-top: 6px;
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .coord-input {
    font-family: var(--font-mono);
    font-size: 11px;
    padding: 4px 8px;
    border: 0.5px solid var(--bone-400);
    border-radius: 3px;
    background: var(--surface-raised);
    color: var(--text-primary);
    min-width: 260px;
    flex: 1;
  }
  .coord-input:focus {
    outline: none;
    border-color: var(--forest-800);
  }
  .coord-error {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--embers-600);
    flex-basis: 100%;
    padding-left: 2px;
  }
  .edit-coord-btn {
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--bone-600);
    background: none;
    border: 0.5px solid var(--bone-400);
    border-radius: 3px;
    padding: 2px 8px;
    cursor: pointer;
  }
  .edit-coord-btn:hover {
    color: var(--forest-800);
    border-color: var(--forest-800);
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

  /* ── Instant Inline: regeocode button-as-spinner ── */
  @keyframes regeo-spin { to { transform: rotate(360deg); } }

  .regeo-spinner {
    display: inline-block;
    width: 10px; height: 10px;
    border: 1.5px solid rgba(0, 0, 0, 0.2);
    border-top-color: currentColor;
    border-radius: 50%;
    animation: regeo-spin 0.8s linear infinite;
    vertical-align: middle;
    margin-right: 0.2rem;
    flex-shrink: 0;
  }
  .regeo-btn.regeo-running {
    opacity: 0.8;
    cursor: not-allowed;
  }

  /* SSE log disclosure — power-user details, collapsed by default */
  .regeo-log-disclosure {
    margin-top: 0.75rem;
    font-size: 0.74rem;
    color: var(--text-tertiary);
  }
  .regeo-log-disclosure summary {
    cursor: pointer;
    font-weight: 600;
    font-size: 0.72rem;
    color: var(--text-tertiary);
    list-style: none;
    padding: 0.15rem 0;
    user-select: none;
  }
  .regeo-log-disclosure summary::-webkit-details-marker { display: none; }
  .regeo-log {
    margin-top: 0.3rem;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    max-height: 120px;
    overflow-y: auto;
    padding: 0.35rem 0.5rem;
    background: var(--surface-raised);
    border: 0.5px solid var(--bone-400);
    border-radius: 4px;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--bark-800);
  }
  .regeo-log-line { line-height: 1.45; }

  /* Instant Inline: success toast */
  @keyframes regeo-toast-in {
    from { opacity: 0; transform: translateY(4px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .regeo-toast {
    margin-top: 0.75rem;
    display: inline-flex;
    align-items: center;
    background: var(--forest-800);
    color: var(--bone-200);
    padding: 0.45rem 0.85rem;
    border-radius: 5px;
    font-family: var(--font-sans);
    font-size: 0.82rem;
    font-weight: 600;
    animation: regeo-toast-in 0.18s ease;
    pointer-events: none;
  }

  /* Inline failure envelope */
  .regeo-error {
    margin-top: 0.75rem;
    padding: 0.5rem 0.65rem;
    background: var(--sunset-50, #fff5f0);
    border: 1px solid var(--embers-600, #c0392b);
    border-radius: 4px;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    max-width: 36rem;
  }
  .regeo-error-sentence {
    margin: 0;
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--text-primary);
    line-height: 1.4;
  }
  .regeo-error-actions {
    display: flex;
    gap: 0.4rem;
  }
</style>

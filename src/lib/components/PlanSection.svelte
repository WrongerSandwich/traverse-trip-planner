<script>
  import { invalidate } from '$app/navigation';
  import ConfirmModal from '$lib/components/ConfirmModal.svelte';

  let { plan, candidates, slug, readonly = false } = $props();

  // ── Confirm modal ──
  let confirmOpen = $state(false);
  let confirmOpts = $state({});
  let confirmResolve = null;

  function showConfirm(opts) {
    if (confirmResolve) confirmResolve(false);
    return new Promise((resolve) => {
      confirmResolve = resolve;
      confirmOpts = opts;
      confirmOpen = true;
    });
  }

  function candidateById(id) {
    return (
      candidates?.stops.find((s) => s.id === id) ||
      candidates?.lodging.find((l) => l.id === id)
    );
  }

  let pickerOpen = $state(null); // day number or `lodging:${n}`
  let editing = $state(null); // day number for metadata edit
  let working = $state(false);
  let error = $state(null);

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

  async function addDay() {
    await api(`/api/plan/${slug}`, { method: 'POST' });
  }

  async function removeDay(n) {
    const ok = await showConfirm({
      title: `Remove Day ${n}?`,
      body: 'Stops assigned to this day will return to the candidates pool.',
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) return;
    await api(`/api/plan/${slug}/day/${n}`, { method: 'DELETE' });
  }

  async function addStop(dayNumber, candidateId) {
    await api(`/api/plan/${slug}/day/${dayNumber}/stops`, {
      method: 'POST',
      body: JSON.stringify({ id: candidateId }),
    });
    pickerOpen = null;
  }

  async function removeStop(dayNumber, id) {
    await api(`/api/plan/${slug}/day/${dayNumber}/stops/${id}`, {
      method: 'DELETE',
    });
  }

  async function moveStop(dayNumber, id, direction) {
    const day = plan.days.find((d) => d.number === dayNumber);
    if (!day) return;
    const idx = day.stops.indexOf(id);
    if (idx === -1) return; // dangling id — not safe to swap
    const j = idx + direction;
    if (j < 0 || j >= day.stops.length) return;
    const next = [...day.stops];
    [next[idx], next[j]] = [next[j], next[idx]];
    await api(`/api/plan/${slug}/day/${dayNumber}/stops`, {
      method: 'PUT',
      body: JSON.stringify({ order: next }),
    });
  }

  async function setLodging(dayNumber, candidateId) {
    await api(`/api/plan/${slug}/day/${dayNumber}/lodging`, {
      method: 'PUT',
      body: JSON.stringify({ id: candidateId }),
    });
    pickerOpen = null;
  }

  async function saveMeta(dayNumber, patch) {
    await api(`/api/plan/${slug}/day/${dayNumber}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    editing = null;
  }

  function unpromotedStops() {
    const inPlan = new Set();
    for (const d of plan?.days ?? []) for (const s of d.stops) inPlan.add(s);
    return (candidates?.stops ?? []).filter((s) => !inPlan.has(s.id));
  }

  function unpromotedLodging() {
    const inPlan = new Set();
    for (const d of plan?.days ?? []) if (d.lodging_id) inPlan.add(d.lodging_id);
    return (candidates?.lodging ?? []).filter((l) => !inPlan.has(l.id));
  }
</script>

{#if error}
  <p class="banner-error" role="alert">{error}</p>
{/if}

{#if !plan}
  <div class="empty">
    <p>Plan will appear after extraction completes.</p>
  </div>
{:else if plan.days.length === 0}
  <div class="empty">
    <p>No days planned yet.</p>
    <button class="btn-inline" onclick={addDay} disabled={working || readonly}>+ Add Day 1</button>
  </div>
{:else}
  {#each plan.days as day (day.number)}
    <article class="day-card">
      <header>
        <h3>Day {day.number}{#if day.date} · {day.date}{/if}</h3>
        <button
          class="btn-inline"
          onclick={() => (editing = editing === day.number ? null : day.number)}
          disabled={working || readonly}
        >Edit</button>
        <button
          class="btn-inline btn-icon"
          onclick={() => removeDay(day.number)}
          disabled={working || readonly}
          aria-label="Remove day"
        >×</button>
      </header>

      {#if editing === day.number}
        <form
          onsubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            const driveStr = fd.get('drive');
            const driveNum = driveStr ? Number(driveStr) : null;
            saveMeta(day.number, {
              date: fd.get('date') || null,
              drive_distance_mi: Number.isFinite(driveNum) ? driveNum : null,
              notes: fd.get('notes') ?? '',
            });
          }}
        >
          <input name="date" placeholder="YYYY-MM-DD" value={day.date ?? ''} />
          <input
            name="drive"
            type="number"
            placeholder="Drive (mi)"
            value={day.drive_distance_mi ?? ''}
          />
          <textarea name="notes" placeholder="Notes" rows="3">{day.notes ?? ''}</textarea>
          <div class="form-actions">
            <button class="btn-inline btn-primary" type="submit" disabled={working || readonly}>Save</button>
            <button
              class="btn-inline"
              type="button"
              onclick={() => (editing = null)}
              disabled={working || readonly}
            >Cancel</button>
          </div>
        </form>
      {/if}

      {#if day.stops.length > 0}
        <ol class="stops">
          {#each day.stops as id, i}
            {@const cand = candidateById(id)}
            <li>
              {#if cand}
                <span class="cat">{cand.category}</span>
                <span class="name">{cand.name}</span>
              {:else}
                <span class="dangling" title="Candidate missing from candidates.md">⚠ {id}</span>
              {/if}
              <button
                class="btn-inline btn-icon"
                onclick={() => moveStop(day.number, id, -1)}
                disabled={i === 0 || working || readonly}
                aria-label="Move up"
              >↑</button>
              <button
                class="btn-inline btn-icon"
                onclick={() => moveStop(day.number, id, 1)}
                disabled={i === day.stops.length - 1 || working || readonly}
                aria-label="Move down"
              >↓</button>
              <button
                class="btn-inline btn-icon"
                onclick={() => removeStop(day.number, id)}
                disabled={working || readonly}
                aria-label="Remove"
              >×</button>
            </li>
          {/each}
        </ol>
      {/if}

      <button
        class="btn-inline add-stop"
        onclick={() => (pickerOpen = pickerOpen === day.number ? null : day.number)}
        disabled={working || readonly}
      >+ Add stop</button>

      <div class="lodging">
        <strong>Lodging:</strong>
        {#if day.lodging_id}
          {@const l = candidateById(day.lodging_id)}
          {#if l}
            <span class="name">{l.name}</span>
          {:else}
            <span class="dangling" title="Candidate missing from candidates.md">⚠ {day.lodging_id}</span>
          {/if}
          <button
            class="btn-inline"
            onclick={() => setLodging(day.number, null)}
            disabled={working || readonly}
          >clear</button>
        {:else}
          <button
            class="btn-inline"
            onclick={() =>
              (pickerOpen =
                pickerOpen === `lodging:${day.number}` ? null : `lodging:${day.number}`)}
            disabled={working || readonly}
          >+ Add lodging</button>
        {/if}
      </div>

      {#if pickerOpen === day.number}
        <div class="picker">
          <h5>Add a stop to Day {day.number}</h5>
          {#each unpromotedStops() as s (s.id)}
            <button onclick={() => addStop(day.number, s.id)} class="picker-item" disabled={working || readonly}>
              <span class="cat">{s.category}</span> {s.name}
            </button>
          {/each}
          {#if unpromotedStops().length === 0}
            <p class="picker-empty">All stops already in plan.</p>
          {/if}
        </div>
      {:else if pickerOpen === `lodging:${day.number}`}
        <div class="picker">
          <h5>Set lodging for Day {day.number}</h5>
          {#each unpromotedLodging() as l (l.id)}
            <button onclick={() => setLodging(day.number, l.id)} class="picker-item" disabled={working || readonly}>
              <span class="cat">{l.price_tier}</span> {l.name}
            </button>
          {/each}
          {#if unpromotedLodging().length === 0}
            <p class="picker-empty">All lodging already in plan.</p>
          {/if}
        </div>
      {/if}
    </article>
  {/each}
  <button class="btn-inline add-day" onclick={addDay} disabled={working || readonly}>+ Add day</button>
{/if}

<ConfirmModal
  bind:open={confirmOpen}
  title={confirmOpts.title ?? ''}
  body={confirmOpts.body ?? ''}
  confirmLabel={confirmOpts.confirmLabel ?? 'Confirm'}
  danger={confirmOpts.danger ?? false}
  onconfirm={() => { const r = confirmResolve; confirmResolve = null; r?.(true); }}
  oncancel={() => { const r = confirmResolve; confirmResolve = null; r?.(false); }}
/>

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
  .day-card {
    border: 1px solid var(--border-default);
    border-radius: 0.5rem;
    padding: 1rem;
    margin-bottom: 1rem;
    background: var(--surface-raised);
    font-family: var(--font-sans);
  }
  .day-card header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }
  .day-card h3 {
    margin: 0;
    flex: 1;
    color: var(--text-primary);
    font-size: 1rem;
    font-family: var(--font-sans);
    font-weight: 500;
  }
  .btn-inline {
    background: none;
    border: 1px solid var(--border-default);
    padding: 0.25rem 0.5rem;
    border-radius: 0.25rem;
    color: var(--text-primary);
    cursor: pointer;
    font-family: var(--font-sans);
    font-size: 0.85rem;
  }
  .btn-inline:hover:not(:disabled) {
    background: var(--surface-sunken);
  }
  .btn-inline:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .btn-inline.btn-primary {
    background: var(--accent);
    color: var(--text-inverse);
    border-color: var(--accent);
  }
  .btn-inline.btn-icon {
    padding: 0.15rem 0.4rem;
    line-height: 1;
    min-width: 1.75rem;
  }
  .add-stop {
    margin-top: 0.25rem;
  }
  .add-day {
    margin-top: 0.5rem;
  }
  .stops {
    padding-left: 1.25rem;
    margin: 0.5rem 0;
  }
  .stops li {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0.25rem 0;
  }
  .name {
    flex: 1;
    color: var(--text-primary);
  }
  .dangling {
    color: var(--state-warning);
    flex: 1;
    font-size: 0.85rem;
  }
  .cat {
    font-size: 0.75rem;
    padding: 0.1rem 0.4rem;
    border-radius: 0.25rem;
    background: var(--surface-sunken);
    color: var(--text-tertiary);
  }
  .lodging {
    margin-top: 0.75rem;
    padding-top: 0.5rem;
    border-top: 1px dashed var(--border-default);
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.9rem;
    color: var(--text-secondary);
  }
  .lodging strong {
    color: var(--text-primary);
  }
  .picker {
    margin-top: 0.5rem;
    padding: 0.5rem;
    background: var(--surface-sunken);
    border-radius: 0.5rem;
  }
  .picker h5 {
    margin: 0 0 0.5rem;
    color: var(--text-primary);
    font-family: var(--font-sans);
    font-size: 0.85rem;
    font-weight: 500;
  }
  .picker-item {
    display: block;
    width: 100%;
    text-align: left;
    padding: 0.5rem;
    background: none;
    border: none;
    border-bottom: 1px solid var(--border-default);
    cursor: pointer;
    color: var(--text-primary);
    font-family: var(--font-sans);
    font-size: 0.9rem;
  }
  .picker-item:last-child {
    border-bottom: none;
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
  .empty {
    padding: 2rem;
    text-align: center;
    color: var(--text-tertiary);
    font-family: var(--font-sans);
  }
  .empty p {
    margin: 0 0 0.75rem;
  }
  form {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
    padding: 0.5rem;
    background: var(--surface-page);
    border: 1px solid var(--border-subtle);
    border-radius: 0.25rem;
  }
  form input,
  form textarea {
    padding: 0.4rem;
    border: 1px solid var(--border-default);
    border-radius: 0.25rem;
    background: var(--surface-raised);
    color: var(--text-primary);
    font-family: var(--font-sans);
    font-size: 0.9rem;
  }
  .form-actions {
    display: flex;
    gap: 0.5rem;
  }
</style>

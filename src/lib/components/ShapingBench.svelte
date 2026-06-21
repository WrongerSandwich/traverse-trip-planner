<!-- src/lib/components/ShapingBench.svelte -->
<script>
  import { untrack } from 'svelte';
  import { invalidate } from '$app/navigation';
  import PlanSection from './PlanSection.svelte';
  import CandidatesSection from './CandidatesSection.svelte';
  import TripMap from './TripMap.svelte';
  import { failureSentence } from '$lib/errors-registry.js';
  import { formatPlanDateRange } from '$lib/format-date.js';

  let {
    plan, candidates, slug,
    home = null, destination = null,
    candidatesPinHint = null,
    readonly = false, jobs = [], features = null,
  } = $props();

  // Optimistic snapshot. Seeded from loader data and re-seeded whenever the
  // loader data changes (i.e. after every successful invalidate('app:trip') —
  // the server truth replaces the optimistic guess, normally identically).
  let local = $state(untrack(() => ({ plan: $state.snapshot(plan), candidates: $state.snapshot(candidates) })));
  $effect(() => {
    // Re-read on prop change. Touch both so Svelte tracks them.
    const p = plan, c = candidates;
    local = { plan: $state.snapshot(p), candidates: $state.snapshot(c) };
  });

  let planRef = $state(null);
  let working = $state(false);
  let hoveredId = $state(null);
  let errorCode = $state(null);
  let errorCtx = $state({});

  // Single optimistic orchestrator handed to both children. Snapshot `local`,
  // apply the reducer thunk immediately, fire the request, then reconcile.
  // On success, invalidate('app:trip') refetches and the reseed effect aligns
  // `local` with server truth. On failure we EXPLICITLY restore the pre-mutation
  // snapshot — we can't rely on invalidate to revert, because when the server
  // state is unchanged (the mutation was rejected) the `plan`/`candidates` props
  // don't change reference, so the reseed effect never fires.
  async function mutate({ apply, request, errorCtx: ctx }) {
    working = true;
    errorCode = null;
    errorCtx = {};
    const prev = $state.snapshot(local);
    if (typeof apply === 'function') local = apply(prev);
    try {
      const res = await fetch(request.path, { headers: { 'content-type': 'application/json' }, ...request.opts });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        errorCode = body.code || 'action_failed';
        errorCtx = body.context || ctx || { action: 'update the plan' };
        local = prev;
        return false;
      }
      await invalidate('app:trip');
      return true;
    } catch {
      errorCode = 'network_error';
      local = prev;
      return false;
    } finally {
      working = false;
    }
  }

  function onHover(id) { hoveredId = id; }

  // Map inputs derived from the optimistic snapshot so pins react on drop.
  const visibleStops = $derived((local.candidates?.stops ?? []).filter((s) => !s.hidden));
  const visibleLodging = $derived((local.candidates?.lodging ?? []).filter((l) => !l.hidden));
  const promotedIds = $derived.by(() => {
    const ids = new Set();
    for (const d of local.plan?.days ?? []) {
      for (const id of d.stops ?? []) ids.add(id);
      if (d.lodging_id) ids.add(d.lodging_id);
    }
    return ids;
  });
  function scrollToCard(id) {
    const el = document.getElementById(`candidate-${id}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    hoveredId = id;
  }
</script>

<div class="shaping-bench">
  {#if errorCode}
    <div class="banner-error" role="alert">
      <span>{failureSentence(errorCode, errorCtx)}</span>
      <button type="button" class="banner-dismiss" onclick={() => { errorCode = null; }}>Dismiss</button>
    </div>
  {/if}

  {#if Array.isArray(destination)}
    <div class="bench-map">
      <TripMap
        mode="candidates"
        stops={visibleStops}
        lodging={visibleLodging}
        home={Array.isArray(home) ? home : null}
        destination={destination}
        promotedIds={promotedIds}
        hoveredId={hoveredId}
        onHover={onHover}
        onClick={scrollToCard}
        visibleCategories={null}
      />
    </div>
  {/if}

  <div class="bench-grid">
    <section class="section bench-col" id="section-plan" aria-label="Plan">
      <header class="section-header">
        <h2 class="section-heading-serif">Plan</h2>
        {#if local.plan?.days?.length}
          {@const planDays = local.plan.days}
          {@const n = planDays.length}
          {@const dateRange = formatPlanDateRange(planDays)}
          <span class="section-plan-meta" aria-hidden="true">{n} day{n === 1 ? '' : 's'}{dateRange ? ` · ${dateRange}` : ''}</span>
        {/if}
        {#if !readonly}
          <div class="section-header-actions">
            <button class="btn btn-secondary btn-compact" onclick={() => planRef?.addDay()} disabled={working}>+ Add day</button>
          </div>
        {/if}
      </header>
      <PlanSection
        {slug}
        store={local}
        {mutate}
        {hoveredId}
        {onHover}
        bind:working
        readonly={readonly}
        bind:this={planRef}
      />
    </section>

    <section class="section bench-col" id="section-candidates" aria-label="Candidates">
      <header class="section-header">
        <h2 class="section-heading-serif">Candidates</h2>
        {#if candidatesPinHint}<span class="section-header-hint" aria-live="polite">{candidatesPinHint}</span>{/if}
      </header>
      <CandidatesSection
        {slug}
        store={local}
        {mutate}
        bind:hoveredId
        {onHover}
        showMap={false}
        destination={destination}
        home={home}
        readonly={readonly}
        jobs={jobs}
        features={features}
      />
    </section>
  </div>
</div>

<style>
  /* The candidates-mode TripMap is height:100% internally, so the container
     must set an explicit height or Leaflet collapses to 0 (matches the
     .map-block treatment in CandidatesSection). */
  .bench-map {
    height: 280px;
    margin-bottom: 1rem;
    border-radius: var(--radius-md);
    overflow: hidden;
    border: 1px solid var(--border-subtle);
  }
  @media (max-width: 600px) {
    .bench-map { height: 200px; }
  }
  .bench-grid { display: flex; flex-direction: column; gap: 1.4rem; }
  @media (min-width: 960px) {
    .bench-grid {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: 1.5rem;
      align-items: start;
    }
    .bench-col { min-width: 0; }
  }
  .banner-error {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.5rem 0.75rem;
    background: var(--state-danger-surface);
    color: var(--text-primary);
    border: 1px solid var(--state-danger);
    border-radius: 4px;
    margin-bottom: 0.75rem;
    font-family: var(--font-sans);
    font-size: 0.9rem;
  }
  .banner-error span { flex: 1; }
  .banner-dismiss {
    background: transparent;
    border: 0.5px solid var(--state-danger);
    color: var(--state-danger);
    font-family: var(--font-sans);
    font-size: 0.74rem;
    font-weight: 600;
    padding: 0.25rem 0.55rem;
    border-radius: 4px;
    cursor: pointer;
  }
  .banner-dismiss:hover {
    background: color-mix(in oklab, var(--state-danger) 8%, transparent);
  }
</style>

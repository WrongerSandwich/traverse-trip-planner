<!-- src/lib/components/ShapingBench.svelte -->
<script>
  import { invalidate } from '$app/navigation';
  import PlanSection from './PlanSection.svelte';
  import CandidatesSection from './CandidatesSection.svelte';
  import TripMap from './TripMap.svelte';

  let {
    plan, candidates, slug,
    home = null, destination = null,
    candidatesPinHint = null,
    readonly = false, jobs = [], features = null,
  } = $props();

  // Optimistic snapshot. Seeded from loader data and re-seeded whenever the
  // loader data changes (i.e. after every successful invalidate('app:trip') —
  // the server truth replaces the optimistic guess, normally identically).
  let local = $state({ plan: $state.snapshot(plan), candidates: $state.snapshot(candidates) });
  $effect(() => {
    // Re-read on prop change. Touch both so Svelte tracks them.
    const p = plan, c = candidates;
    local = { plan: $state.snapshot(p), candidates: $state.snapshot(c) };
  });

  let working = $state(false);
  let hoveredId = $state(null);
  let errorCode = $state(null);
  let errorCtx = $state({});

  // Single optimistic orchestrator handed to both children. Apply the reducer
  // thunk to local immediately, fire the request, then reconcile via invalidate
  // (which re-seeds `local` through the effect above). On failure, invalidate
  // pulls server truth back (reverting the optimistic change) and we surface a
  // registry code.
  async function mutate({ apply, request, errorCtx: ctx }) {
    working = true;
    errorCode = null;
    errorCtx = {};
    if (typeof apply === 'function') local = apply($state.snapshot(local));
    try {
      const res = await fetch(request.path, { headers: { 'content-type': 'application/json' }, ...request.opts });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        errorCode = body.code || 'action_failed';
        errorCtx = body.context || ctx || { action: 'update the plan' };
        await invalidate('app:trip');
        return false;
      }
      await invalidate('app:trip');
      return true;
    } catch {
      errorCode = 'network_error';
      await invalidate('app:trip');
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
      <header class="section-header"><h2 class="section-heading-serif">Plan</h2></header>
      <PlanSection
        {slug}
        store={local}
        {mutate}
        {hoveredId}
        {onHover}
        bind:working
        readonly={readonly}
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
  .bench-map { margin-bottom: 1rem; }
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
</style>

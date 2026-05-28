<script>
  import { invalidate } from '$app/navigation';
  import { failureSentence } from '$lib/errors-registry.js';
  import { formatDayHeader } from '$lib/format-date.js';
  import { streamAction } from '$lib/utils/action.js';
  import TripMap from './TripMap.svelte';
  import StopCard from './StopCard.svelte';
  import LodgingCard from './LodgingCard.svelte';
  import HideToast from './HideToast.svelte';

  let { candidates, plan = null, slug, destination = null, home = null, readonly = false, jobs = [], features = null } = $props();

  // ── UI state ────────────────────────────────────────────────────────────
  let tab = $state('stops');                       // 'stops' | 'lodging'
  let visibleCategories = $state(null);            // Set<string> | null (null = all)
  let promoteFor = $state(null);                   // candidate id whose day picker is open
  let openPanel = $state(/** @type {null | 'add' | 'find-more'} */ (null));
  let working = $state(false);
  let errorCode = $state(/** @type {string|null} */ (null));
  let errorCtx = $state(/** @type {Record<string,string>} */ ({}));
  let hoveredId = $state(null);                    // card ↔ map sync
  let showHidden = $state(false);                  // toggle for the "N hidden — show" reveal

  // Add-candidate panel state. SSE consumer routes terminal errors through
  // ERROR_REGISTRY; success clears the input and invalidates app:trip.
  let addInput = $state('');
  let addRunning = $state(false);
  let addErrorCode = $state(/** @type {string|null} */ (null));
  let addErrorCtx = $state(/** @type {Record<string,string>} */ ({}));
  let addLog = $state(/** @type {string[]} */ ([]));

  // Find-more panel state. POSTs to the Ambient Background endpoint; on 202
  // we close the panel and let the global jobs pill surface progress. On 409
  // (already running) or other errors we keep the panel open and render the
  // sentence.
  let findSteering = $state('');
  let findCount = $state(5);
  let findSubmitting = $state(false);
  let findErrorCode = $state(/** @type {string|null} */ (null));
  let findErrorCtx = $state(/** @type {Record<string,string>} */ ({}));

  // Refresh-metadata state. Triggers the enrich-candidates job server-side;
  // the global background-jobs pill takes over for progress UI.
  let refreshing = $state(false);
  let kebabOpen = $state(false);
  let refreshError = $state(/** @type {string|null} */ (null));

  // Focuses the panel input on mount. Used via `use:focusOnMount` instead of
  // the HTML autofocus attribute — autofocus's a11y warning applies to
  // page-load focus, but here the element only mounts when the user has
  // explicitly toggled the panel open, so immediate keyboard input is expected.
  function focusOnMount(node) {
    node.focus();
  }

  // Toast state for the hide-with-undo gesture.
  let hideToast = $state(/** @type {{ id: string, name: string, type: 'stop'|'lodging' } | null} */ (null));
  let hideToastTimer = null;

  // ── Derivations ─────────────────────────────────────────────────────────
  const allStops = $derived(candidates?.stops ?? []);
  const allLodging = $derived(candidates?.lodging ?? []);

  const visibleStops = $derived(allStops.filter((s) => showHidden || !s.hidden));
  const visibleLodging = $derived(allLodging.filter((l) => showHidden || !l.hidden));

  const hiddenCount = $derived(
    allStops.filter((s) => s.hidden).length + allLodging.filter((l) => l.hidden).length
  );

  const presentCategories = $derived.by(() => {
    const set = new Set();
    for (const s of visibleStops) set.add(s.category || 'misc');
    return Array.from(set);
  });

  // Active tab as a candidate-type tag ('stop' | 'lodging') used by the
  // subtools row to wire add/find-more to the right pool.
  const currentTabType = $derived(tab === 'stops' ? 'stop' : 'lodging');

  const filteredStops = $derived(
    visibleStops.filter((s) => !visibleCategories || visibleCategories.has(s.category || 'misc'))
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

  // Returns the days a lodging is assigned to as { number, date } objects
  // so LodgingCard can render a calendar-aware tag (Wed · Thu) rather
  // than the engineer-coded "Day 1, 2". Sorted by day number for stable
  // display order.
  function lodgingDays(id) {
    return (plan?.days ?? [])
      .filter((d) => d.lodging_id === id)
      .sort((a, b) => a.number - b.number)
      .map((d) => ({ number: d.number, date: d.date ?? null }));
  }

  // Haversine in miles. Used to surface the distance chip on each stop card
  // (from destination) and the cluster-fit hint in the day picker.
  function distanceMi(a, b) {
    if (!a || !b) return null;
    const lat1 = Number(a.lat), lng1 = Number(a.lng);
    const lat2 = Number(b.lat), lng2 = Number(b.lng);
    if (!Number.isFinite(lat1) || !Number.isFinite(lng1) || !Number.isFinite(lat2) || !Number.isFinite(lng2)) return null;
    const toRad = (d) => (d * Math.PI) / 180;
    const R = 3959;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const x = Math.sin(dLat/2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng/2) ** 2;
    return Math.round(2 * R * Math.asin(Math.sqrt(x)));
  }

  // Day picker mini-card data — per-day { number, date, lodgingName, stopCount, distanceFromCandidate }
  function dayOptionsFor(candidate) {
    const days = plan?.days ?? [];
    const candCoords = candidate?.coords;
    return days.map((d) => {
      const lodgingName = d.lodging_id
        ? allLodging.find((l) => l.id === d.lodging_id)?.name ?? null
        : null;
      const stopCount = (d.stops ?? []).length;
      // Day centroid = average of day's stop coords (if available).
      let centroid = null;
      if (candCoords && stopCount) {
        let sumLat = 0, sumLng = 0, n = 0;
        for (const sid of d.stops ?? []) {
          const s = allStops.find((x) => x.id === sid);
          if (s?.coords?.lat != null && s?.coords?.lng != null) {
            sumLat += Number(s.coords.lat);
            sumLng += Number(s.coords.lng);
            n++;
          }
        }
        if (n > 0) centroid = { lat: sumLat / n, lng: sumLng / n };
      }
      const distance = candCoords && centroid ? distanceMi(candCoords, centroid) : null;
      const header = formatDayHeader(d);
      return {
        number: d.number,
        date: d.date ?? null,
        // Shared header tier — primary "Wednesday · Jul 15" + secondary
        // "Day 1" — matches PlanSection's day-card and Move-picker
        // vocabulary so the user sees consistent day naming across the
        // promote flow.
        headerPrimary: header.primary,
        headerSecondary: header.secondary,
        lodgingName,
        stopCount,
        distance,
        fitsCluster: distance != null && distance <= 30,
        // Lodging-specific: whether this lodging is currently set on this day
        currentlySet: d.lodging_id === candidate?.id,
      };
    });
  }

  // ── API plumbing ────────────────────────────────────────────────────────
  async function api(path, opts) {
    working = true;
    errorCode = null;
    errorCtx = {};
    try {
      const res = await fetch(path, {
        headers: { 'content-type': 'application/json' },
        ...opts,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        errorCode = body.code || 'action_failed';
        errorCtx = body.context || { action: 'update candidates' };
        return false;
      }
      await invalidate('app:trip');
      return true;
    } catch {
      errorCode = 'network_error';
      return false;
    } finally {
      working = false;
    }
  }

  // SSE consumer for the add-candidate Instant Inline endpoint. Mirrors the
  // add-destination flow on the home page (utils/action.js#streamAction):
  // every event's `msg` lands in `addLog`; the terminal event carries either
  // an error code (routed through ERROR_REGISTRY) or success metadata (id +
  // tokens). On success we clear the input and invalidate app:trip so the
  // new card appears in the list.
  async function streamAdd(name) {
    if (!name?.trim()) return;
    addRunning = true;
    addErrorCode = null;
    addErrorCtx = {};
    addLog = [];
    let resolvedError = null;
    let resolvedCtx = {};
    let resolvedId = null;
    try {
      await streamAction(
        `/api/actions/add-candidate/${encodeURIComponent(slug)}`,
        (event) => {
          const { msg, done, code, context, id } = event;
          if (msg) addLog = [...addLog, msg];
          if (done && code) {
            resolvedError = code;
            resolvedCtx = context || {};
          }
          if (done && !code && id) {
            resolvedId = id;
          }
        },
        { name: name.trim(), type: currentTabType },
      );
      if (resolvedError) {
        addErrorCode = resolvedError;
        addErrorCtx = resolvedCtx;
      } else {
        addInput = '';
        await invalidate('app:trip');
        if (resolvedId) {
          // Wait one tick for the new card to mount, then scroll.
          queueMicrotask(() => scrollToCard(resolvedId));
        }
      }
    } catch {
      addErrorCode = 'network_error';
      addErrorCtx = {};
    } finally {
      addRunning = false;
    }
  }

  // Submit handler for the find-more Ambient Background endpoint. Returns
  // 202 on a successful start (panel closes, badge takes over) and 409 if
  // a job is already running for this trip. Other errors flow through
  // ERROR_REGISTRY via `code`.
  async function submitFindMore() {
    findSubmitting = true;
    findErrorCode = null;
    findErrorCtx = {};
    try {
      const res = await fetch(`/api/actions/find-more/${encodeURIComponent(slug)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: currentTabType, steering: findSteering, count: findCount }),
      });
      if (res.status === 202) {
        openPanel = null;
        findSteering = '';
        await invalidate('app:trip');
        return;
      }
      const body = await res.json().catch(() => ({}));
      findErrorCode = body.code || 'network_error';
      findErrorCtx = body.context || {};
    } catch {
      findErrorCode = 'network_error';
    } finally {
      findSubmitting = false;
    }
  }

  async function promoteStop(stopId, dayNumber) {
    const ok = await api(`/api/plan/${slug}/promote`, {
      method: 'POST',
      body: JSON.stringify({ id: stopId, day: dayNumber }),
    });
    if (ok) promoteFor = null;
  }

  async function unPromoteStop(stopId) {
    await api(`/api/plan/${slug}/un-promote`, {
      method: 'POST',
      body: JSON.stringify({ id: stopId }),
    });
  }

  async function setLodgingForDay(dayNumber, lodgingId) {
    const ok = await api(`/api/plan/${slug}/day/${dayNumber}/lodging`, {
      method: 'PUT',
      body: JSON.stringify({ id: lodgingId }),
    });
    if (ok) promoteFor = null;
  }

  // ── Hide flow with undo toast ──
  async function hideCandidate(candidate, type) {
    const segment = type === 'lodging' ? 'lodging' : 'stops';
    const ok = await api(`/api/candidates/${slug}/${segment}/${encodeURIComponent(candidate.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ hidden: true }),
    });
    if (!ok) return;
    queueHideToast({ id: candidate.id, name: candidate.name, type });
  }

  async function unhideCandidate(id, type) {
    const segment = type === 'lodging' ? 'lodging' : 'stops';
    await api(`/api/candidates/${slug}/${segment}/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ hidden: false }),
    });
  }

  function queueHideToast(entry) {
    if (hideToastTimer) {
      clearTimeout(hideToastTimer);
      hideToastTimer = null;
    }
    hideToast = entry;
    hideToastTimer = setTimeout(() => {
      hideToast = null;
      hideToastTimer = null;
    }, 5000);
  }

  async function undoHide() {
    if (!hideToast) return;
    const { id, type } = hideToast;
    hideToast = null;
    if (hideToastTimer) { clearTimeout(hideToastTimer); hideToastTimer = null; }
    await unhideCandidate(id, type);
  }

  function dismissHideToast() {
    hideToast = null;
    if (hideToastTimer) { clearTimeout(hideToastTimer); hideToastTimer = null; }
  }

  // ── Filter helpers ──
  function toggleCategoryChip(cat) {
    if (!visibleCategories) {
      // Click on a chip while "all" is active: switch to single-cat mode.
      visibleCategories = new Set([cat]);
      return;
    }
    if (visibleCategories.has(cat)) {
      visibleCategories.delete(cat);
      if (visibleCategories.size === 0) visibleCategories = null;
      else visibleCategories = new Set(visibleCategories);
    } else {
      visibleCategories = new Set([...visibleCategories, cat]);
    }
  }
  function clearCategoryFilter() {
    visibleCategories = null;
  }

  // ── Pin/card hover sync ──
  function setHover(id) { hoveredId = id; }

  // When the user clicks a pin, scroll the matching card into view.
  function scrollToCard(id) {
    const el = document.getElementById(`candidate-${id}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // Switch tabs and reset all add/find-more panel state so a half-typed
  // "Mound City Group" in the Stops add panel doesn't bleed into Lodging.
  function setTab(next) {
    if (next === tab) return;
    tab = next;
    openPanel = null;
    addInput = '';
    addLog = [];
    addErrorCode = null;
    addErrorCtx = {};
    findSteering = '';
    findErrorCode = null;
    findErrorCtx = {};
  }

  // Capitalize-once for chip labels.
  function titleCase(s) {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
  }

  // Compute the destination coord array shape needed by the map.
  const destinationCoords = $derived(
    Array.isArray(destination) ? destination : null
  );

  // True while any deepen, geocode-candidates, or enrich-candidates job is
  // running on this trip — disables the Refresh metadata button so a second
  // enrich doesn't stack on top of an in-flight one.
  const anyBlockingJobRunning = $derived(
    (jobs ?? []).some((j) => {
      if (j.slug !== slug) return false;
      const bare = (j.workflow || '').replace(/:.*$/, '');
      return bare === 'deepen' || bare === 'geocode-candidates' || bare === 'enrich-candidates';
    })
  );

  // POST /api/actions/enrich-candidates/[slug].
  // Returns 202 on a successful job start; the global background-jobs pill
  // surfaces progress. On 409 (already running) or other errors the inline
  // refreshError message surfaces the problem.
  async function refreshMetadata({ force = false } = {}) {
    if (refreshing) return;
    kebabOpen = false;
    refreshing = true;
    refreshError = null;
    try {
      const res = await fetch(`/api/actions/enrich-candidates/${encodeURIComponent(slug)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force }),
      });
      if (!res.ok && res.status !== 202) {
        const data = await res.json().catch(() => ({}));
        refreshError = data.code || `http_${res.status}`;
      }
    } catch {
      refreshError = 'network_error';
    } finally {
      refreshing = false;
    }
  }
</script>

<svelte:window onpointerdown={(e) => {
  if (!kebabOpen) return;
  // Close the kebab if the click was outside .refresh-controls
  if (!e.target?.closest?.('.refresh-controls')) kebabOpen = false;
}} />

{#if errorCode}
  <div class="banner-error" role="alert">
    <span>{failureSentence(errorCode, errorCtx)}</span>
    <button type="button" class="banner-dismiss" onclick={() => { errorCode = null; }}>Dismiss</button>
  </div>
{/if}

{#if !candidates}
  <!-- Pre-research empty: ghost preview teaches the wide-net mental model. -->
  <div class="empty-pre">
    <div class="ghost-preview" aria-hidden="true">
      <div class="ghost-card"></div>
      <div class="ghost-card"></div>
      <div class="ghost-card"></div>
    </div>
    <p class="empty-line">
      Run research to see what's nearby. Keep what looks worth a stop; hide the rest.
    </p>
  </div>
{:else if (visibleStops.length + visibleLodging.length) === 0 && hiddenCount === 0}
  <!-- candidates.md exists but is fully empty (rare; shouldn't normally happen
       but defensive). -->
  <p class="empty-line">No candidates yet. Add one manually or re-run research.</p>
{:else}
  <!-- Map: visible above the cards. The brief commits to map-IS-the-interface
       on this surface, so it gets first-paint real estate. -->
  <div class="map-block">
    <TripMap
      mode="candidates"
      stops={visibleStops}
      lodging={visibleLodging}
      home={Array.isArray(home) ? home : null}
      destination={destinationCoords}
      promotedIds={promotedIds}
      hoveredId={hoveredId}
      onHover={setHover}
      onClick={scrollToCard}
      visibleCategories={visibleCategories}
    />
  </div>

  <!-- Filter strip: category chips on the left, Stops/Lodging tabs on the right.
       Chips control map+cards together; tabs only switch the list type. -->
  <div class="filter-strip">
    <div class="chips" role="group" aria-label="Filter by category">
      <button
        type="button"
        class="chip chip--all"
        class:active={!visibleCategories}
        onclick={clearCategoryFilter}
      >All</button>
      {#each presentCategories as cat}
        <button
          type="button"
          class="chip"
          data-category={cat}
          class:active={visibleCategories?.has(cat)}
          onclick={() => toggleCategoryChip(cat)}
        >
          <span class="chip-dot" aria-hidden="true"></span>
          {titleCase(cat)}
        </button>
      {/each}
    </div>
    <div class="tabs" role="tablist" aria-label="Candidate type">
      <button
        type="button"
        role="tab"
        aria-selected={tab === 'stops'}
        class:active={tab === 'stops'}
        onclick={() => setTab('stops')}
      >Stops <span class="tab-count">{filteredStops.length}</span></button>
      <button
        type="button"
        role="tab"
        aria-selected={tab === 'lodging'}
        class:active={tab === 'lodging'}
        onclick={() => setTab('lodging')}
      >Lodging <span class="tab-count">{visibleLodging.length}</span></button>
    </div>
  </div>

  {#if !readonly}
    <div class="subtools" role="group" aria-label="Add or find more candidates">
      <button
        type="button"
        class="subtool"
        aria-pressed={openPanel === 'add'}
        onclick={() => { openPanel = openPanel === 'add' ? null : 'add'; }}
      >
        + Add {currentTabType === 'stop' ? 'stop' : 'lodging'}
      </button>
      <button
        type="button"
        class="subtool"
        aria-pressed={openPanel === 'find-more'}
        onclick={() => { openPanel = openPanel === 'find-more' ? null : 'find-more'; }}
      >
        Find more {currentTabType === 'stop' ? 'stops' : 'lodging'} ✨
      </button>

      {#if tab === 'stops' && (allStops?.length ?? 0) > 0 && features?.['enrich-candidates']}
        <div class="refresh-controls">
          <button
            type="button"
            class="btn-inline refresh-btn"
            disabled={refreshing || anyBlockingJobRunning}
            onclick={() => refreshMetadata({ force: false })}
            title="Fetch hours/website/phone for stops that are missing them"
          >
            {#if refreshing}Refreshing…{:else}↻ Refresh metadata{/if}
          </button>
          <button
            type="button"
            class="btn-inline kebab-btn"
            disabled={refreshing || anyBlockingJobRunning}
            onclick={() => (kebabOpen = !kebabOpen)}
            aria-label="More refresh options"
            aria-expanded={kebabOpen}
          >⌄</button>
          {#if kebabOpen}
            <div class="kebab-menu" role="menu">
              <button
                type="button"
                role="menuitem"
                class="kebab-item"
                onclick={() => refreshMetadata({ force: true })}
              >Re-fetch all (force overwrite)</button>
            </div>
          {/if}
        </div>
      {/if}
    </div>
  {/if}

  {#if refreshError}
    <div class="banner-error" role="alert">
      <span>{failureSentence(refreshError, {})}</span>
      <button type="button" class="banner-dismiss" onclick={() => { refreshError = null; }}>Dismiss</button>
    </div>
  {/if}

  {#if openPanel === 'add' && !readonly}
    <form
      class="panel panel-add"
      onsubmit={(e) => { e.preventDefault(); streamAdd(addInput); }}
    >
      <label class="panel-label">
        Place name
        <input
          type="text"
          class="panel-input"
          placeholder={currentTabType === 'stop' ? 'e.g. Mound City Group' : 'e.g. The Mill Inn'}
          bind:value={addInput}
          disabled={addRunning}
          use:focusOnMount
        />
      </label>
      <div class="panel-actions">
        <button type="submit" class="panel-submit" disabled={addRunning || !addInput.trim()}>
          {#if addRunning}
            Adding…
          {:else}
            Add {currentTabType === 'stop' ? 'stop' : 'lodging'}
          {/if}
        </button>
        <button type="button" class="panel-cancel" onclick={() => { openPanel = null; }} disabled={addRunning}>
          Close
        </button>
      </div>
      {#if addErrorCode}
        <div class="panel-error" role="alert">
          <span>{failureSentence(addErrorCode, addErrorCtx)}</span>
          <button type="button" class="banner-dismiss" onclick={() => { addErrorCode = null; }}>Dismiss</button>
        </div>
      {/if}
      {#if addLog.length}
        <details class="panel-log">
          <summary>{addLog[addLog.length - 1]}</summary>
          <ul>{#each addLog as line}<li>{line}</li>{/each}</ul>
        </details>
      {/if}
    </form>
  {/if}

  {#if openPanel === 'find-more' && !readonly}
    <form
      class="panel panel-find-more"
      onsubmit={(e) => { e.preventDefault(); submitFindMore(); }}
    >
      <label class="panel-label">
        What kind? <span class="panel-hint">(optional — e.g. "more food stops", "splurge lodging")</span>
        <textarea
          class="panel-input panel-textarea"
          rows="2"
          maxlength="300"
          bind:value={findSteering}
          disabled={findSubmitting}
        ></textarea>
      </label>
      <label class="panel-label">
        How many?
        <input
          type="number"
          class="panel-input panel-number"
          min="3"
          max="10"
          bind:value={findCount}
          disabled={findSubmitting}
        />
      </label>
      <p class="panel-note">You can navigate away while this runs — the badge will update when it's done.</p>
      <div class="panel-actions">
        <button type="submit" class="panel-submit" disabled={findSubmitting}>
          {#if findSubmitting}Starting…{:else}Find more{/if}
        </button>
        <button type="button" class="panel-cancel" onclick={() => { openPanel = null; }} disabled={findSubmitting}>
          Close
        </button>
      </div>
      {#if findErrorCode}
        <div class="panel-error" role="alert">
          <span>{failureSentence(findErrorCode, findErrorCtx)}</span>
          <button type="button" class="banner-dismiss" onclick={() => { findErrorCode = null; }}>Dismiss</button>
        </div>
      {/if}
    </form>
  {/if}

  <!-- Card list -->
  {#if tab === 'stops'}
    {#if filteredStops.length === 0 && visibleStops.length === 0}
      <p class="empty-line empty-tab">
        Research only found lodging. Re-research to surface stops, or add one manually.
      </p>
    {:else if filteredStops.length === 0}
      <p class="empty-line empty-tab">
        No stops match this filter. Clear filters to see all {visibleStops.length} stops.
      </p>
    {:else}
      <div class="list">
        {#each filteredStops as stop (stop.id)}
          <div id="candidate-{stop.id}" class="row" class:hidden-row={stop.hidden}>
            <StopCard
              {stop}
              promoted={isPromotedFn(stop.id)}
              distance={destinationCoords ? distanceMi(stop.coords, { lat: destinationCoords[0], lng: destinationCoords[1] }) : null}
              hovered={hoveredId === stop.id}
              {readonly}
              {working}
              onHover={setHover}
              onClick={scrollToCard}
              onPromote={() => { promoteFor = promoteFor === stop.id ? null : stop.id; }}
              onUnpromote={() => unPromoteStop(stop.id)}
              onHide={() => hideCandidate(stop, 'stop')}
            />
            {#if promoteFor === stop.id}
              <div class="day-picker" role="listbox" aria-label="Promote {stop.name} to which day">
                {#each dayOptionsFor(stop) as option (option.number)}
                  <button
                    type="button"
                    class="day-option"
                    onclick={() => promoteStop(stop.id, option.number)}
                    disabled={working || readonly}
                  >
                    <span class="day-primary">{option.headerPrimary}</span>
                    {#if option.headerSecondary}<span class="day-secondary">{option.headerSecondary}</span>{/if}
                    <div class="day-meta">
                      {#if option.lodgingName}<span class="day-lodging">{option.lodgingName}</span>{/if}
                      <span class="day-stops">{option.stopCount} stop{option.stopCount === 1 ? '' : 's'}</span>
                      {#if option.distance != null}<span class="day-dist">~{option.distance} mi</span>{/if}
                    </div>
                    {#if option.fitsCluster}<span class="day-fits" aria-hidden="true">fits cluster</span>{/if}
                  </button>
                {/each}
                {#if !(plan?.days?.length)}
                  <button
                    type="button"
                    class="day-option day-option--empty"
                    onclick={() => promoteStop(stop.id, null)}
                    disabled={working || readonly}
                  >
                    <span class="day-primary">+ Create Day 1</span>
                    <span class="day-meta-empty">No days in the plan yet</span>
                  </button>
                {/if}
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  {:else}
    {#if visibleLodging.length === 0}
      <p class="empty-line empty-tab">
        Research only found stops. Re-research to surface stays, or add one manually.
      </p>
    {:else}
      <div class="list">
        {#each visibleLodging as l (l.id)}
          {@const daysUsed = lodgingDays(l.id)}
          <div id="candidate-{l.id}" class="row" class:hidden-row={l.hidden}>
            <LodgingCard
              lodging={l}
              promoted={isPromotedFn(l.id)}
              {daysUsed}
              hovered={hoveredId === l.id}
              {readonly}
              {working}
              onHover={setHover}
              onClick={scrollToCard}
              onPromote={() => { promoteFor = promoteFor === l.id ? null : l.id; }}
              onHide={() => hideCandidate(l, 'lodging')}
            />
            {#if promoteFor === l.id}
              <div class="day-picker" role="listbox" aria-label="Set {l.name} as lodging for which day">
                {#if !(plan?.days?.length)}
                  <p class="picker-empty">Add a day in the Plan section first, then come back to assign lodging.</p>
                {:else}
                  {#each dayOptionsFor(l) as option (option.number)}
                    <button
                      type="button"
                      class="day-option"
                      class:currently-set={option.currentlySet}
                      onclick={() => setLodgingForDay(option.number, option.currentlySet ? null : l.id)}
                      disabled={working || readonly}
                    >
                      <span class="day-primary">{option.headerPrimary}</span>
                      {#if option.headerSecondary}<span class="day-secondary">{option.headerSecondary}</span>{/if}
                      <div class="day-meta">
                        {#if option.currentlySet}
                          <span class="day-lodging currently">Currently set. Click to clear.</span>
                        {:else if option.lodgingName}
                          <span class="day-lodging">{option.lodgingName} (will replace)</span>
                        {:else}
                          <span class="day-lodging">no lodging set</span>
                        {/if}
                        <span class="day-stops">{option.stopCount} stop{option.stopCount === 1 ? '' : 's'}</span>
                      </div>
                    </button>
                  {/each}
                {/if}
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  {/if}

  <!-- Hidden-candidates toggle. Whittle is reversible; surface the count
       so the user can see what they've discarded and reconsider. -->
  {#if hiddenCount > 0}
    <button
      type="button"
      class="hidden-toggle"
      onclick={() => (showHidden = !showHidden)}
    >
      {#if showHidden}
        Collapse {hiddenCount} hidden
      {:else}
        Show {hiddenCount} hidden
      {/if}
    </button>
  {/if}
{/if}

<!-- Hide toast — bottom-of-section pop-up with a 5s Undo window. -->
<HideToast
  open={!!hideToast}
  message={hideToast ? `Hidden ${hideToast.name}.` : ''}
  onUndo={undoHide}
  onDismiss={dismissHideToast}
/>

<style>
  /* ── Banner ──────────────────────────────────────────────────────────── */
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

  /* ── Empty states ────────────────────────────────────────────────────── */
  .empty-pre {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 1rem 0.5rem;
  }
  .ghost-preview {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .ghost-card {
    height: 56px;
    background: var(--surface-raised);
    border: 1px solid var(--border-subtle);
    border-radius: 5px;
    opacity: 0.45;
  }
  .ghost-card:nth-child(1) { opacity: 0.55; }
  .ghost-card:nth-child(2) { opacity: 0.40; }
  .ghost-card:nth-child(3) { opacity: 0.30; }
  .empty-line {
    color: var(--text-tertiary);
    font-size: 0.92rem;
    line-height: 1.55;
    font-style: italic;
    text-align: center;
    padding: 1rem 0.5rem;
    margin: 0;
  }
  .empty-tab {
    background: var(--surface-raised);
    border: 1px dashed var(--border-default);
    border-radius: 5px;
  }

  /* ── Map block ──────────────────────────────────────────────────────── */
  .map-block {
    height: 280px;
    margin-bottom: 0.85rem;
    border-radius: 5px;
    overflow: hidden;
    border: 1px solid var(--border-subtle);
  }
  @media (max-width: 768px) {
    .map-block { height: 200px; }
  }

  /* Touch: filter chips and Stops/Lodging tabs both render below the
     44px floor on desktop (chips ~18px, tabs ~20px). The filter row is
     the gate to every candidate decision — on a phone a thumb has to
     hit eight chips inline. Floor them. */
  @media (pointer: coarse) {
    .chip {
      min-height: var(--tap-min);
      padding: 0.5rem 0.75rem 0.5rem 0.65rem;
      font-size: 12.5px;
    }
    .tabs button {
      min-height: var(--tap-min);
      padding: 0.5rem 0.95rem;
      font-size: 13px;
    }
  }

  /* ── Filter strip ───────────────────────────────────────────────────── */
  .filter-strip {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    flex-wrap: wrap;
    margin-bottom: 0.75rem;
  }
  .chips {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    flex-wrap: wrap;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    background: transparent;
    border: 0.5px solid var(--border-default);
    padding: 3px 9px 3px 7px;
    border-radius: 999px;
    color: var(--text-tertiary);
    cursor: pointer;
    font-family: var(--font-sans);
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.02em;
    line-height: 1;
    transition: background-color 0.12s, color 0.12s, border-color 0.12s;
  }
  .chip:hover {
    background: var(--surface-raised);
    color: var(--text-primary);
  }
  .chip.active {
    background: color-mix(in oklab, var(--accent) 10%, transparent);
    color: var(--text-primary);
    border-color: var(--accent);
  }
  .chip-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--bone-400);
    flex-shrink: 0;
  }
  .chip[data-category="historic"]      .chip-dot { background: var(--cat-historic); }
  .chip[data-category="cultural"]      .chip-dot { background: var(--cat-cultural); }
  .chip[data-category="food"]          .chip-dot { background: var(--cat-food); }
  .chip[data-category="entertainment"] .chip-dot { background: var(--cat-entertainment); }
  .chip[data-category="outdoors"]      .chip-dot { background: var(--cat-outdoors); }
  .chip[data-category="view"]          .chip-dot { background: var(--cat-view); }
  .chip[data-category="quirky"]        .chip-dot { background: var(--cat-quirky); }
  .chip[data-category="shopping"]      .chip-dot { background: var(--cat-shopping); }
  .chip[data-category="misc"]          .chip-dot { background: var(--cat-misc); }

  .tabs {
    display: inline-flex;
    align-items: center;
    gap: 0.15rem;
    background: var(--surface-sunken);
    padding: 2px;
    border-radius: 5px;
  }
  .tabs button {
    background: transparent;
    border: none;
    padding: 4px 10px;
    color: var(--text-tertiary);
    cursor: pointer;
    border-radius: 4px;
    font-family: var(--font-sans);
    font-size: 12px;
    font-weight: 500;
    line-height: 1;
    transition: background-color 0.12s, color 0.12s;
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }
  .tabs button:hover { color: var(--text-primary); }
  .tabs button.active {
    background: var(--surface-page);
    color: var(--text-primary);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
  }
  .tab-count {
    font-size: 10px;
    font-weight: 600;
    color: var(--text-tertiary);
    background: color-mix(in oklab, var(--text-tertiary) 12%, transparent);
    padding: 0.1rem 0.35rem;
    border-radius: 999px;
    min-width: 1.4em;
    text-align: center;
  }
  .tabs button.active .tab-count {
    color: var(--text-primary);
    background: color-mix(in oklab, var(--accent) 12%, transparent);
  }

  /* ── Card list ──────────────────────────────────────────────────────── */
  .list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  /* `.row` wraps each card + its inline day-picker so they stay together
     in the list layout. Hidden candidates fade but still take space —
     the user toggled "show hidden" to see them. */
  .row {
    display: flex;
    flex-direction: column;
    gap: 0;
  }
  .hidden-row { opacity: 0.55; }

  /* ── Day picker (mini-cards) ────────────────────────────────────────── */
  .day-picker {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 0.35rem 0 0.45rem 1rem;
    padding: 0.4rem;
    background: var(--surface-sunken);
    border-radius: 5px;
    /* No side-stripe; the sunken surface + indent already signals
       "nested under this card" structurally. */
  }
  .day-option {
    position: relative;
    display: grid;
    grid-template-columns: auto auto 1fr auto;
    gap: 0.45rem 0.65rem;
    align-items: baseline;
    text-align: left;
    background: var(--surface-page);
    border: 0.5px solid var(--border-subtle);
    border-radius: 4px;
    padding: 0.45rem 0.65rem;
    cursor: pointer;
    font-family: var(--font-sans);
    color: var(--text-primary);
    transition: background-color 0.12s, border-color 0.12s;
  }
  .day-option:hover:not(:disabled) {
    background: var(--surface-raised);
    border-color: var(--border-default);
  }
  .day-option:disabled { opacity: 0.5; cursor: not-allowed; }
  .day-option.currently-set {
    background: color-mix(in oklab, var(--accent) 6%, var(--surface-page));
    border-color: color-mix(in oklab, var(--accent) 35%, var(--border-default));
  }
  .day-option.day-option--empty {
    border-style: dashed;
    color: var(--text-secondary);
  }
  /* Day-option header tier — matches PlanSection's .day-anchor +
     .move-picker-primary/.move-picker-secondary so the two sections
     describe days in the same vocabulary (Wednesday · Jul 15 / Day 1)
     when the user opens the promote-to-day picker. */
  .day-primary {
    font-size: 0.86rem;
    font-weight: 600;
    color: var(--text-primary);
  }
  .day-secondary {
    font-size: 0.74rem;
    color: var(--text-tertiary);
    letter-spacing: 0.02em;
  }
  .day-meta {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.74rem;
    color: var(--text-tertiary);
    grid-column: 3;
    flex-wrap: wrap;
  }
  .day-lodging {
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 16em;
  }
  .day-lodging.currently {
    color: var(--accent-text);
    font-style: italic;
  }
  .day-stops {
    color: var(--text-tertiary);
    flex-shrink: 0;
  }
  .day-dist {
    color: var(--text-tertiary);
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
  }
  .day-fits {
    grid-column: 4;
    grid-row: 1 / span 2;
    align-self: center;
    font-size: 0.66rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--state-success);
    background: var(--state-success-surface);
    padding: 0.18rem 0.5rem;
    border-radius: 999px;
  }
  .day-meta-empty {
    grid-column: 1 / -1;
    font-size: 0.74rem;
    color: var(--text-tertiary);
    font-style: italic;
  }
  .picker-empty {
    margin: 0;
    color: var(--text-tertiary);
    font-size: 0.85rem;
    font-style: italic;
  }

  /* ── Hidden-toggle ──────────────────────────────────────────────────── */
  .hidden-toggle {
    margin-top: 0.85rem;
    background: transparent;
    border: none;
    color: var(--text-tertiary);
    font-family: var(--font-sans);
    font-size: 0.8rem;
    font-weight: 500;
    text-align: left;
    cursor: pointer;
    padding: 0.25rem 0;
    border-bottom: 1px dotted color-mix(in oklab, var(--text-tertiary) 35%, transparent);
    align-self: flex-start;
  }
  .hidden-toggle:hover { color: var(--text-primary); border-bottom-color: var(--text-secondary); }

  /* Hide-toast chrome lives in HideToast.svelte — shared with PlanSection. */

  /* ── Subtools row ────────────────────────────────────────────────────── */
  .subtools {
    display: flex;
    gap: 0.5rem;
    margin: -0.25rem 0 0.75rem;
    flex-wrap: wrap;
  }
  .subtool {
    background: transparent;
    border: 0.5px solid var(--border-default);
    color: var(--text-secondary);
    font-family: var(--font-sans);
    font-size: 12px;
    font-weight: 500;
    padding: 5px 12px;
    border-radius: 4px;
    cursor: pointer;
    line-height: 1;
    transition: background-color 0.12s, color 0.12s, border-color 0.12s;
  }
  .subtool:hover {
    background: var(--surface-raised);
    color: var(--text-primary);
    border-color: var(--text-tertiary);
  }
  .subtool[aria-pressed="true"] {
    background: color-mix(in oklab, var(--accent) 10%, transparent);
    color: var(--text-primary);
    border-color: var(--accent);
  }
  @media (pointer: coarse) {
    .subtool { min-height: var(--tap-min); padding: 0.5rem 0.85rem; font-size: 12.5px; }
  }

  /* ── Add / find-more inline panel ──────────────────────────────────── */
  .panel {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    padding: 0.75rem;
    background: var(--surface-sunken);
    border: 0.5px solid var(--border-subtle);
    border-radius: 5px;
    margin-bottom: 0.85rem;
  }
  .panel-label {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    font-family: var(--font-sans);
    font-size: 0.78rem;
    color: var(--text-secondary);
  }
  .panel-input {
    background: var(--surface-page);
    border: 0.5px solid var(--border-default);
    color: var(--text-primary);
    font-family: var(--font-sans);
    font-size: 0.92rem;
    padding: 0.4rem 0.55rem;
    border-radius: 4px;
  }
  .panel-input:focus {
    outline: none;
    border-color: var(--accent);
  }
  .panel-actions {
    display: flex;
    gap: 0.4rem;
  }
  .panel-submit {
    background: var(--accent);
    color: var(--text-inverse);
    border: none;
    font-family: var(--font-sans);
    font-size: 0.84rem;
    font-weight: 600;
    padding: 0.45rem 0.85rem;
    border-radius: 4px;
    cursor: pointer;
  }
  .panel-submit:disabled { opacity: 0.55; cursor: not-allowed; }
  .panel-cancel {
    background: transparent;
    border: 0.5px solid var(--border-default);
    color: var(--text-secondary);
    font-family: var(--font-sans);
    font-size: 0.82rem;
    padding: 0.4rem 0.75rem;
    border-radius: 4px;
    cursor: pointer;
  }
  .panel-error {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    background: var(--state-danger-surface);
    border: 1px solid var(--state-danger);
    color: var(--text-primary);
    padding: 0.45rem 0.6rem;
    border-radius: 4px;
    font-size: 0.86rem;
  }
  .panel-error span { flex: 1; }
  .panel-log {
    font-family: var(--font-sans);
    font-size: 0.78rem;
    color: var(--text-tertiary);
  }
  .panel-log summary { cursor: pointer; }
  .panel-log ul { margin: 0.3rem 0 0; padding-left: 1.2rem; }
  .panel-textarea { resize: vertical; font-family: var(--font-sans); }
  .panel-number { width: 5em; }
  .panel-hint {
    font-weight: 400;
    color: var(--text-tertiary);
    font-size: 0.74rem;
  }
  .panel-note {
    margin: 0;
    color: var(--text-tertiary);
    font-size: 0.78rem;
    font-style: italic;
  }

  /* ── Refresh metadata controls ──────────────────────────────────────── */
  .refresh-controls {
    position: relative;
    display: flex;
    align-items: center;
    gap: 0.25rem;
    margin-left: auto;
  }
  .btn-inline {
    background: transparent;
    border: 0.5px solid var(--border-default);
    color: var(--text-secondary);
    font-family: var(--font-sans);
    font-size: 12px;
    font-weight: 500;
    padding: 5px 10px;
    border-radius: 4px;
    cursor: pointer;
    line-height: 1;
    transition: background-color 0.12s, color 0.12s, border-color 0.12s;
  }
  .btn-inline:hover:not(:disabled) {
    background: var(--surface-raised);
    color: var(--text-primary);
    border-color: var(--text-tertiary);
  }
  .btn-inline:disabled { opacity: 0.5; cursor: not-allowed; }
  .refresh-btn { white-space: nowrap; }
  .kebab-btn {
    padding: 0.2rem 0.4rem;
    font-size: 0.9rem;
  }
  .kebab-menu {
    position: absolute;
    top: 100%;
    right: 0;
    margin-top: 0.25rem;
    background: var(--surface-raised);
    border: 0.5px solid var(--border-default);
    border-radius: 4px;
    box-shadow: 0 2px 8px var(--shadow-soft, rgba(0, 0, 0, 0.08));
    z-index: 10;
    min-width: 12rem;
  }
  .kebab-item {
    display: block;
    width: 100%;
    text-align: left;
    background: transparent;
    border: 0;
    padding: 0.45rem 0.7rem;
    font-size: 0.84rem;
    color: var(--text-primary);
    font-family: var(--font-sans);
    cursor: pointer;
  }
  .kebab-item:hover { background: var(--surface-sunken); }
</style>

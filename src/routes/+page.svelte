<script>
  import OverviewMap from '$lib/components/OverviewMap.svelte';
  import TripCard from '$lib/components/TripCard.svelte';
  import DetailPanel from '$lib/components/DetailPanel.svelte';
  import ActionPanel from '$lib/components/ActionPanel.svelte';
  import Logo from '$lib/components/Logo.svelte';
  import { streamAction } from '$lib/utils/action.js';
  import { goto, invalidateAll } from '$app/navigation';
  import { browser } from '$app/environment';

  let { data } = $props();

  // Focuses the popover input on mount. Used via `use:focusOnMount` instead
  // of the HTML autofocus attribute — autofocus's a11y warning applies to
  // page-load focus, but here the element only mounts when the user has
  // explicitly opened a popover, so immediate keyboard input is expected.
  function focusOnMount(node) {
    node.focus();
  }

  // Stage filter
  let activeFilter = $state('all');
  // Sort
  let activeSort   = $state('date');
  // Detail panel
  let selectedTrip = $state(null);
  let hoveredSlug  = $state(null);
  // Extended filters
  let filterOpen   = $state(false);
  let activeDist   = $state('any');   // 'any' | 'u3' | '3-6' | '6plus'
  let activeCost   = $state('any');   // 'any' | 'budget' | 'mid' | 'splurge'
  let activeNPS      = $state(false);
  let activeStarred  = $state(false);
  // Optimistic bookmark overrides (slug → boolean) so toggles feel instant
  let bookmarkOverrides = $state({});

  function isStarred(trip) {
    if (bookmarkOverrides[trip._slug] !== undefined) return bookmarkOverrides[trip._slug];
    return trip.starred === 'true' || trip.starred === true;
  }

  async function toggleBookmark(trip, e) {
    e?.stopPropagation();
    const slug = trip._slug;
    const current = isStarred(trip);
    bookmarkOverrides[slug] = !current; // optimistic
    try {
      await fetch(`/api/bookmark/${encodeURIComponent(slug)}`, { method: 'POST' });
    } catch {
      bookmarkOverrides[slug] = current; // revert
    }
  }

  const attrFilterCount = $derived(
    (activeDist !== 'any' ? 1 : 0) +
    (activeCost !== 'any' ? 1 : 0) +
    (activeNPS ? 1 : 0) +
    (activeStarred ? 1 : 0)
  );

  // ── Mobile map toggle + header measurement ──
  let mapVisible = $state(true);
  let headerEl  = $state(null);

  $effect(() => {
    if (!browser || !headerEl) return;
    const set = () =>
      document.documentElement.style.setProperty('--header-h', `${headerEl.offsetHeight}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(headerEl);
    return () => ro.disconnect();
  });

  // ── Mobile scroll-focus ──
  let isMobile = $state(false);
  let scrollFocusedSlug = $state(null);
  // Default the map closed on mobile; user can toggle it open. Only flipped
  // once on initial detection so a viewport resize doesn't override choice.
  let mapDefaulted = false;

  // Track viewport class
  $effect(() => {
    if (!browser) return;
    const mq = window.matchMedia('(max-width: 768px)');
    isMobile = mq.matches;
    if (!mapDefaulted) { mapVisible = !mq.matches; mapDefaulted = true; }
    const onChange = e => { isMobile = e.matches; if (!e.matches) scrollFocusedSlug = null; };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  });

  // IntersectionObserver-driven focus. Fires reliably during iOS momentum
  // scroll (unlike scroll events) and runs off the main thread. We exclude
  // the sticky map area via rootMargin so a card hidden behind the map
  // doesn't win just because it's technically intersecting.
  $effect(() => {
    if (!browser || !isMobile) return;
    // Re-read these reactives so the effect tears down + re-runs when they change
    const _trips = trips;
    const _mapVisible = mapVisible;

    const mapEl = document.querySelector('.map-col');
    const mapH = mapVisible ? Math.round(mapEl?.getBoundingClientRect().height ?? 0) : 0;

    const visibility = new Map();
    const observer = new IntersectionObserver(
      entries => {
        for (const e of entries) {
          if (e.isIntersecting) visibility.set(e.target.id, e.intersectionRatio);
          else visibility.delete(e.target.id);
        }
        if (visibility.size === 0) return; // keep last focus rather than blanking
        let best = null, bestRatio = 0;
        for (const [id, ratio] of visibility) {
          if (ratio > bestRatio) { bestRatio = ratio; best = id.replace('card-', ''); }
        }
        if (best) scrollFocusedSlug = best;
      },
      {
        rootMargin: `-${mapH}px 0px -10% 0px`,
        threshold: [0, 0.1, 0.25, 0.5, 0.75, 1],
      }
    );

    // Observe all cards present right now. _trips dependency above causes
    // the effect to re-run (and re-observe) when the trip list changes.
    for (const el of document.querySelectorAll('[id^="card-"]')) observer.observe(el);
    return () => observer.disconnect();
  });

  // On mobile use scroll position to drive map focus; mouse hover wins on desktop
  const effectiveHovered = $derived(hoveredSlug || (isMobile ? scrollFocusedSlug : null));

  // ── In-browser actions ──
  let actionVisible  = $state(false);
  let actionRunning  = $state(false);
  let actionMessages = $state([]);
  let actionDone     = $state(false);
  let actionAborter  = $state(null); // AbortController for the running action, null if none cancellable

  function cancelAction() {
    if (actionAborter) {
      actionAborter.abort();
      actionPush('Cancelled by user.', true);
    }
  }

  // Seed prompt form (the + button opens this instead of running immediately
  // — gives the user a chance to steer the batch and is its own confirmation).
  let seedFormOpen = $state(false);
  let seedPrompt   = $state('');

  // Pin form — add one specific destination
  let pinFormOpen = $state(false);
  let pinDest     = $state('');

  function actionPush(msg, done = false) {
    actionMessages = [...actionMessages, msg];
    if (done) { actionDone = true; actionRunning = false; }
  }

  async function runSeed() {
    if (actionRunning) return;
    const prompt = seedPrompt.trim();
    seedFormOpen = false;
    seedPrompt   = '';
    actionVisible = true;
    actionRunning = true;
    actionDone    = false;
    actionMessages = [];
    try {
      await streamAction('/api/actions/seed', ({ msg, done }) => {
        actionPush(msg, done);
        if (done) invalidateAll();
      }, { prompt });
    } catch (e) {
      actionPush(`Error: ${e.message}`, true);
    }
  }

  async function runPin() {
    if (actionRunning) return;
    const dest = pinDest.trim();
    if (!dest) return;
    pinFormOpen = false;
    pinDest     = '';
    actionVisible = true;
    actionRunning = true;
    actionDone    = false;
    actionMessages = [];
    try {
      await streamAction('/api/actions/add', ({ msg, done }) => {
        actionPush(msg, done);
        if (done) invalidateAll();
      }, { destination: dest });
    } catch (e) {
      actionPush(`Error: ${e.message}`, true);
    }
  }

  async function runDeepen(trip) {
    if (actionRunning) return;
    if (!confirm(`Look into "${trip.title || trip._slug}" with web search? It usually takes about a minute.`)) return;
    actionVisible = true;
    actionRunning = true;
    actionDone    = false;
    actionMessages = [];
    actionAborter = new AbortController();
    try {
      await streamAction(`/api/actions/deepen/${encodeURIComponent(trip._slug)}`, ({ msg, done }) => {
        actionPush(msg, done);
        if (done) invalidateAll();
      }, null, actionAborter.signal);
      // If the loop returned without a `done: true` (i.e. aborted mid-stream),
      // make sure the panel reflects the cancelled state.
      if (!actionDone) actionPush('Cancelled.', true);
    } catch (e) {
      actionPush(`Error: ${e.message}`, true);
    } finally {
      actionAborter = null;
    }
  }

  async function archiveTrip(trip, e) {
    e?.stopPropagation?.();
    if (!trip) return;
    const label = trip.title || trip._slug;
    if (!confirm(`Archive "${label}"? It'll vanish from view but stay on disk, so the seeder won't suggest it again.`)) return;
    try {
      const res = await fetch(`/api/archive/${encodeURIComponent(trip._slug)}`, { method: 'POST' });
      if (!res.ok) throw new Error(`Archive failed: ${res.status}`);
      selectedTrip = null;
      await invalidateAll();
    } catch (err) {
      console.error(err);
      alert("Couldn't archive that one. The server log may have more detail.");
    }
  }

  async function promoteToPlanning(trip, e) {
    e?.stopPropagation?.();
    if (!confirm(`Move "${trip.title || trip._slug}" into planning?`)) return;
    const slug = trip._slug;
    try {
      const res = await fetch(`/api/promote/${encodeURIComponent(slug)}`, { method: 'POST' });
      if (!res.ok) throw new Error(`Promote failed: ${res.status}`);
      // Close any open detail panel and navigate to the dedicated planning page
      selectedTrip = null;
      await goto(`/trips/${encodeURIComponent(slug)}`, { invalidateAll: true });
    } catch (err) {
      console.error(err);
      alert("Couldn't move that one into planning. The server log may have more detail.");
    }
  }

  function openTrip(trip) {
    const stage = trip._stage || trip.status;
    if (stage === 'planning') {
      goto(`/trips/${encodeURIComponent(trip._slug)}`);
    } else {
      selectedTrip = trip;
    }
  }

  function clearAttrs() {
    activeDist    = 'any';
    activeCost    = 'any';
    activeNPS     = false;
    activeStarred = false;
  }

  function costLow(str) {
    const m = str?.match(/\$([0-9,]+)/);
    return m ? parseInt(m[1].replace(/,/g, '')) : Infinity;
  }

  const filtered = $derived(
    data.trips.filter(t => {
      if (activeFilter !== 'all' && t.status !== activeFilter && t._stage !== activeFilter) return false;
      if (activeDist !== 'any') {
        const h = t._drive_hours;
        if (activeDist === 'u3'    && !(h != null && h <= 3))          return false;
        if (activeDist === '3-6'   && !(h != null && h > 3 && h <= 6)) return false;
        if (activeDist === '6plus' && !(h != null && h > 6))           return false;
      }
      if (activeCost !== 'any') {
        const low = costLow(t._cost);
        if (activeCost === 'budget'  && !(low < 700))              return false;
        if (activeCost === 'mid'     && !(low >= 700 && low < 1500)) return false;
        if (activeCost === 'splurge' && !(low >= 1500))            return false;
      }
      if (activeNPS && !t.national_park) return false;
      if (activeStarred && !isStarred(t)) return false;
      return true;
    })
  );

  const trips = $derived(sorted(filtered, activeSort));

  function sorted(list, by) {
    const arr = [...list];
    if (by === 'time') return arr.sort((a, b) => (a._drive_hours ?? 999) - (b._drive_hours ?? 999));
    if (by === 'cost') return arr.sort((a, b) => costLow(a._cost) - costLow(b._cost));
    if (by === 'az')   return arr.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    return arr;
  }
</script>

<div class="page">
  {#if actionVisible}
    <ActionPanel
      messages={actionMessages}
      running={actionRunning}
      done={actionDone}
      onclose={() => actionVisible = false}
      oncancel={actionAborter ? cancelAction : null}
    />
  {/if}

  <header bind:this={headerEl}>
    <div class="wordmark">
      <Logo variant="inverse" size={28} />
      <h1>Traverse</h1>
    </div>
    <button
      class="map-toggle"
      class:map-showing={mapVisible}
      onclick={() => mapVisible = !mapVisible}
      aria-label={mapVisible ? 'Hide map' : 'Show map'}
    >
      <svg width="15" height="13" viewBox="0 0 15 13" aria-hidden="true">
        <path d="M0 0l5 2 5-2 5 2v11l-5-2-5 2-5-2V0z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
        <path d="M5 2v11M10 0v11" stroke="currentColor" stroke-width="1.3"/>
      </svg>
      {mapVisible ? 'Map' : 'Map'}
    </button>

    <div class="header-right">
      <div class="header-count">
        {#if attrFilterCount > 0 || activeFilter !== 'all'}
          <span class="count-num">{trips.length}</span>
          <span class="count-label">of {data.trips.length}</span>
        {:else}
          <span class="count-num">{data.trips.length}</span>
          <span class="count-label">destination{data.trips.length !== 1 ? 's' : ''}</span>
        {/if}
      </div>
      <button
        class="seed-btn"
        class:open={seedFormOpen}
        onclick={() => { seedFormOpen = !seedFormOpen; pinFormOpen = false; }}
        disabled={actionRunning || !data.features?.seed}
        title={data.features?.seed ? 'Add 5 new trip ideas' : 'No default model configured — edit your .env to enable this'}
        aria-label="Add trips"
        aria-expanded={seedFormOpen}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <path d="M7 1v12M1 7h12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
        </svg>
      </button>
      <button
        class="seed-btn pin-btn"
        class:open={pinFormOpen}
        onclick={() => { pinFormOpen = !pinFormOpen; seedFormOpen = false; }}
        disabled={actionRunning || !data.features?.add}
        title={data.features?.add ? 'Add a specific destination' : 'No default model configured — edit your .env to enable this'}
        aria-label="Add destination"
        aria-expanded={pinFormOpen}
      >
        <svg width="12" height="15" viewBox="0 0 12 15" aria-hidden="true">
          <path d="M6 0C3.24 0 1 2.24 1 5c0 3.75 5 9 5 9s5-5.25 5-9c0-2.76-2.24-5-5-5z" fill="currentColor" opacity="0.85"/>
          <circle cx="6" cy="5" r="1.8" fill="var(--surface-raised)"/>
        </svg>
      </button>
    </div>
  </header>

  {#if seedFormOpen}
    <div class="seed-backdrop" onclick={() => seedFormOpen = false} role="presentation"></div>
    <div class="seed-popover" role="dialog" aria-label="Generate trip ideas">
      <label class="seed-label" for="seed-prompt">
        Generate 5 new ideas
        <span class="seed-hint">— optional steering, leave blank for general suggestions</span>
      </label>
      <textarea
        id="seed-prompt"
        bind:value={seedPrompt}
        placeholder="e.g. fall colors within 4 hours, or scenic byways with quirky small towns"
        rows="3"
        use:focusOnMount
        onkeydown={e => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); runSeed(); }
          if (e.key === 'Escape') { seedFormOpen = false; }
        }}
      ></textarea>
      <div class="seed-actions">
        <button class="btn btn-tertiary btn-compact" onclick={() => { seedFormOpen = false; seedPrompt = ''; }}>Cancel</button>
        <button class="btn btn-primary btn-compact" onclick={runSeed}>Generate 5 →</button>
      </div>
    </div>
  {/if}

  {#if pinFormOpen}
    <div class="seed-backdrop" onclick={() => pinFormOpen = false} role="presentation"></div>
    <div class="seed-popover" role="dialog" aria-label="Add specific destination">
      <label class="seed-label" for="pin-dest">
        Add a destination
        <span class="seed-hint">— name a specific place to add as an idea</span>
      </label>
      <input
        id="pin-dest"
        type="text"
        class="pin-input"
        bind:value={pinDest}
        placeholder="e.g. Marfa, TX or Boundary Waters, MN"
        use:focusOnMount
        onkeydown={e => {
          if (e.key === 'Enter') { e.preventDefault(); runPin(); }
          if (e.key === 'Escape') { pinFormOpen = false; }
        }}
      />
      <div class="seed-actions">
        <button class="btn btn-tertiary btn-compact" onclick={() => { pinFormOpen = false; pinDest = ''; }}>Cancel</button>
        <button class="btn btn-primary btn-compact" onclick={runPin}>Add →</button>
      </div>
    </div>
  {/if}

  <div class="layout">
    <div class="map-col" class:map-hidden={!mapVisible}>
      <OverviewMap {trips} home={data.home} hoveredSlug={effectiveHovered}
        selectedSlug={selectedTrip?._slug}
        onTripClick={t => openTrip(t)} />
    </div>

    <div class="cards-col">
      <!-- Stage tabs + filter toggle + sort -->
      <div class="controls-wrap">
        <div class="controls">
          {#each ['all','idea','exploring','planning','completed'] as f}
            <button class="tab" class:active={activeFilter === f} onclick={() => activeFilter = f}>
              {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          {/each}

          <button
            class="tab star-tab"
            class:active={activeStarred}
            onclick={() => activeStarred = !activeStarred}
            aria-label={activeStarred ? 'Show all trips' : 'Show bookmarked trips'}
            title="Bookmarked"
          >
            <svg width="11" height="13" viewBox="0 0 10 13" aria-hidden="true">
              {#if activeStarred}
                <path d="M1 1h8v11L5 9 1 12z" fill="currentColor"/>
              {:else}
                <path d="M1 1h8v11L5 9 1 12z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="miter"/>
              {/if}
            </svg>
          </button>

          <div class="divider"></div>

          <button
            class="filter-toggle"
            class:active={filterOpen}
            class:has-filters={attrFilterCount > 0}
            onclick={() => filterOpen = !filterOpen}
            aria-expanded={filterOpen}
          >
            Filters{attrFilterCount > 0 ? ` (${attrFilterCount})` : ''}
            <svg class="chevron" class:open={filterOpen} width="8" height="5" viewBox="0 0 8 5" aria-hidden="true">
              <path d="M0 0l4 5 4-5z" fill="currentColor"/>
            </svg>
          </button>

          <select class="sort-select" bind:value={activeSort} aria-label="Sort trips">
            <option value="date">Date added</option>
            <option value="time">Trip time</option>
            <option value="cost">Cost</option>
            <option value="az">A–Z</option>
          </select>
        </div>

        <!-- Extended filter panel -->
        <div class="filter-panel" class:open={filterOpen} aria-hidden={!filterOpen}>
          <div class="filter-groups">

            <div class="filter-group">
              <div class="group-label">Drive time</div>
              <div class="chips">
                {#each [['any','Any'],['u3','≤3hr'],['3-6','3–6hr'],['6plus','6hr+']] as [val, label]}
                  <button class="chip" class:active={activeDist === val} onclick={() => activeDist = val}>{label}</button>
                {/each}
              </div>
            </div>

            <div class="filter-group">
              <div class="group-label">Budget</div>
              <div class="chips">
                {#each [['any','Any'],['budget','Budget'],['mid','Mid'],['splurge','Splurge']] as [val, label]}
                  <button class="chip" class:active={activeCost === val} onclick={() => activeCost = val}>{label}</button>
                {/each}
              </div>
            </div>

            <div class="filter-group">
              <div class="group-label">Parks</div>
              <div class="chips">
                <button class="chip" class:active={activeNPS} onclick={() => activeNPS = !activeNPS}>NPS only</button>
              </div>
            </div>

            <div class="filter-group">
              <div class="group-label">Saved</div>
              <div class="chips">
                <button class="chip" class:active={activeStarred} onclick={() => activeStarred = !activeStarred}>Bookmarked</button>
              </div>
            </div>

            {#if attrFilterCount > 0}
              <button class="clear-all" onclick={clearAttrs}>Clear all</button>
            {/if}

          </div>
        </div>
      </div>

      <div class="scroll-area">
        <div class="grid">
          {#each trips as trip (trip._slug)}
            <TripCard {trip}
              starred={isStarred(trip)}
              onclick={() => openTrip(trip)}
              onhover={() => hoveredSlug = trip._slug}
              onleave={() => hoveredSlug = null}
              onbookmark={(e) => toggleBookmark(trip, e)}
              ondeepen={data.features?.deepen ? (e) => { e?.stopPropagation(); runDeepen(trip); } : null}
              onpromote={(e) => promoteToPlanning(trip, e)}
            />
          {:else}
            <div class="empty">
              <p>No trips match these filters.</p>
              {#if attrFilterCount > 0}
                <button class="btn btn-tertiary btn-compact" onclick={clearAttrs}>Clear filters</button>
              {/if}
            </div>
          {/each}
        </div>
      </div>
    </div>
  </div>
</div>

<DetailPanel
  trip={selectedTrip}
  starred={selectedTrip ? isStarred(selectedTrip) : false}
  onbookmark={(e) => selectedTrip && toggleBookmark(selectedTrip, e)}
  onpromote={(e) => selectedTrip && promoteToPlanning(selectedTrip, e)}
  onarchive={(e) => selectedTrip && archiveTrip(selectedTrip, e)}
  onclose={() => selectedTrip = null}
/>

<style>
  :global(html, body) { height: 100%; overflow: hidden; }

  .page {
    height: 100vh;
    display: grid;
    grid-template-rows: auto 1fr;
    overflow: hidden;
  }

  header {
    background: var(--surface-invert);
    color: var(--text-inverse);
    padding: 1.1rem 1.75rem;
    display: flex;
    align-items: center;
    gap: 1.5rem;
    flex-shrink: 0;
  }

  .wordmark {
    display: flex;
    align-items: center;
    gap: 0.55rem;
  }

  .header-right {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .seed-btn {
    background: none;
    border: 1.5px solid var(--forest-600);
    border-radius: 50%;
    width: 28px; height: 28px;
    display: flex; align-items: center; justify-content: center;
    cursor: pointer;
    color: var(--bone-600);
    transition: border-color 0.15s, color 0.15s, background 0.15s;
    flex-shrink: 0;
  }
  .seed-btn:hover:not(:disabled) {
    border-color: var(--forest-400);
    color: var(--bone-400);
    background: var(--forest-800);
  }
  .seed-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .seed-btn.open {
    background: var(--forest-800);
    border-color: var(--forest-400);
    color: var(--bone-400);
  }
  .seed-btn.open svg { transform: rotate(45deg); }
  .seed-btn svg { transition: transform 0.18s; }
  .pin-btn svg { transform: none !important; }
  .pin-btn { color: var(--sunset-600); border-color: var(--sunset-800); }
  .pin-btn:hover:not(:disabled) { border-color: var(--sunset-600); color: var(--sunset-200); background: var(--sunset-800); }
  .pin-btn.open { background: var(--sunset-800); border-color: var(--sunset-600); color: var(--sunset-200); }

  /* ── Seed prompt popover ── */
  .seed-backdrop {
    position: fixed; inset: 0;
    background: rgba(20, 20, 20, 0.25);
    z-index: 50;
  }
  .seed-popover {
    position: fixed;
    top: calc(var(--header-h, 64px) + 0.5rem);
    right: 1.25rem;
    width: 360px;
    max-width: calc(100vw - 1rem);
    background: var(--surface-raised);
    border: 1px solid var(--bone-400);
    border-radius: 8px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18), 0 2px 6px rgba(0, 0, 0, 0.08);
    padding: 0.9rem 1rem 0.85rem;
    z-index: 51;
    display: flex; flex-direction: column; gap: 0.55rem;
  }
  .seed-label {
    font-size: 0.78rem;
    font-weight: 700;
    color: var(--text-primary);
    line-height: 1.3;
  }
  .seed-hint {
    font-weight: 400;
    color: var(--text-tertiary);
    font-size: 0.74rem;
  }
  .seed-popover textarea {
    width: 100%;
    border: 1px solid var(--bone-400);
    border-radius: 4px;
    padding: 0.55rem 0.7rem;
    font-family: var(--font-sans);
    font-size: 0.84rem;
    line-height: 1.45;
    color: var(--text-primary);
    background: var(--surface-page);
    resize: vertical;
    min-height: 60px;
  }
  .seed-popover textarea:focus { outline: 2px solid var(--forest-200); outline-offset: 1px; }
  .pin-input {
    width: 100%;
    border: 1px solid var(--bone-400);
    border-radius: 4px;
    padding: 0.55rem 0.7rem;
    font-family: var(--font-sans);
    font-size: 0.84rem;
    color: var(--text-primary);
    background: var(--surface-page);
  }
  .pin-input:focus { outline: 2px solid var(--forest-200); outline-offset: 1px; }
  .seed-actions {
    display: flex; gap: 0.5rem; justify-content: flex-end;
  }

  header h1 {
    font-family: var(--font-serif);
    font-size: 1.6rem;
    font-weight: 500;
    letter-spacing: 0.005em;
    line-height: 1;
  }

  .header-count {
    margin-left: auto;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 0.06rem;
  }
  .count-num {
    font-size: 1.75rem;
    font-weight: 800;
    line-height: 1;
    letter-spacing: -0.04em;
    color: var(--bone-400);
  }
  .count-label {
    font-size: 0.58rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--bone-600);
  }

  .layout {
    display: grid;
    grid-template-columns: 42% 1fr;
    overflow: hidden;
    height: 100%;
  }

  .map-col { height: 100%; overflow: hidden; }

  .cards-col {
    display: flex; flex-direction: column;
    height: 100%; overflow: hidden;
    box-shadow: -6px 0 24px rgba(0, 0, 0, 0.07);
    background: var(--surface-page);
  }

  /* ── Controls wrap (tabs + filter panel) ── */
  .controls-wrap {
    flex-shrink: 0;
    background: var(--surface-raised);
    border-bottom: 1px solid var(--bone-400);
    position: relative;
  }

  .controls {
    padding: 0 1.5rem;
    display: flex;
    align-items: stretch;
  }

  .tab {
    border: none;
    background: none;
    padding: 0.75rem 0.85rem 0.7rem;
    font-size: 0.76rem;
    font-weight: 500;
    cursor: pointer;
    color: var(--text-tertiary);
    font-family: var(--font-sans);
    border-bottom: 2px solid transparent;
    transition: color 0.12s, border-color 0.12s;
    white-space: nowrap;
  }
  .tab:hover  { color: var(--text-primary); }
  .tab:active { color: var(--forest-800); background: var(--forest-50); }
  .tab.active {
    color: var(--forest-800);
    border-bottom-color: var(--forest-800);
    font-weight: 600;
  }

  .star-tab {
    padding-left: 0.6rem;
    padding-right: 0.6rem;
    display: flex;
    align-items: center;
  }

  .divider { width: 1px; background: var(--bone-400); margin: 0.65rem 0.35rem; flex-shrink: 0; }

  .filter-toggle {
    border: none;
    background: none;
    padding: 0.75rem 0.75rem 0.7rem;
    font-size: 0.76rem;
    font-weight: 500;
    cursor: pointer;
    color: var(--text-tertiary);
    font-family: var(--font-sans);
    display: flex;
    align-items: center;
    gap: 0.3rem;
    transition: color 0.12s;
    white-space: nowrap;
    border-bottom: 2px solid transparent;
  }
  .filter-toggle:hover { color: var(--text-primary); }
  .filter-toggle.active {
    color: var(--forest-800);
    border-bottom-color: var(--forest-800);
  }
  .filter-toggle.has-filters { color: var(--forest-800); font-weight: 600; }

  .chevron {
    transition: transform 0.18s cubic-bezier(0.22, 1, 0.36, 1);
    flex-shrink: 0;
  }
  .chevron.open { transform: rotate(180deg); }

  .sort-select {
    font-size: 0.73rem;
    font-weight: 500;
    color: var(--text-tertiary);
    border: none;
    background: none;
    padding: 0.75rem 1.4rem 0.7rem 0.3rem;
    cursor: pointer;
    outline: none;
    appearance: none;
    font-family: var(--font-sans);
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='5'%3E%3Cpath d='M0 0l4 5 4-5z' fill='%23999'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 0.2rem center;
    margin-left: auto;
  }
  .sort-select:focus { outline: none; }

  /* ── Extended filter panel ── */
  .filter-panel {
    max-height: 0;
    overflow: hidden;
    transition: max-height 0.22s cubic-bezier(0.22, 1, 0.36, 1);
  }
  .filter-panel.open { max-height: 80px; }

  .filter-groups {
    padding: 0.7rem 1.5rem 0.8rem;
    border-top: 1px solid var(--bone-200);
    display: flex;
    align-items: flex-end;
    gap: 1.75rem;
    flex-wrap: wrap;
  }

  .filter-group {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  .group-label {
    font-size: 0.6rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.09em;
    color: var(--text-tertiary);
  }

  .chips { display: flex; gap: 0.2rem; }

  .chip {
    border: 1.5px solid var(--bone-400);
    background: none;
    padding: 0.2rem 0.55rem;
    border-radius: 3px;
    font-size: 0.71rem;
    font-weight: 500;
    cursor: pointer;
    color: var(--text-secondary);
    font-family: var(--font-sans);
    transition: border-color 0.1s, background 0.1s, color 0.1s;
    white-space: nowrap;
  }
  .chip:hover  { border-color: var(--forest-200); color: var(--forest-800); }
  .chip:active { background: var(--forest-50); border-color: var(--forest-800); color: var(--forest-800); }
  .chip.active {
    background: var(--forest-800);
    border-color: var(--forest-800);
    color: var(--bone-50);
  }

  .clear-all {
    border: none;
    background: none;
    font-size: 0.71rem;
    font-weight: 500;
    color: var(--text-tertiary);
    cursor: pointer;
    font-family: var(--font-sans);
    padding: 0.2rem 0;
    margin-left: auto;
    align-self: flex-end;
    text-decoration: underline;
    text-underline-offset: 2px;
    transition: color 0.12s;
  }
  .clear-all:hover { color: var(--text-primary); }

  /* ── Cards ── */
  .scroll-area { flex: 1; min-height: 0; overflow-y: auto; }

  .grid {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
    padding: 1.25rem 1.25rem 2rem;
  }

  .empty {
    text-align: center;
    padding: 4rem 2rem;
    color: var(--text-tertiary);
    font-size: 0.875rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
  }
  /* ── Mobile map toggle button — hidden on desktop ── */
  .map-toggle { display: none; }

  @media (max-width: 768px) {
    :global(html, body) { overflow: auto; }
    .page { height: auto; }

    /* Map toggle button visible on mobile */
    .map-toggle {
      display: flex;
      align-items: center;
      gap: 0.35rem;
      background: none;
      border: 1px solid var(--forest-600);
      border-radius: 4px;
      color: var(--bone-600);
      font-family: var(--font-sans);
      font-size: 0.72rem;
      font-weight: 600;
      letter-spacing: 0.04em;
      padding: 0.3rem 0.6rem;
      cursor: pointer;
      min-height: var(--tap-min);
      transition: background 0.12s, color 0.12s;
    }
    .map-toggle:hover { background: var(--forest-800); color: var(--bone-400); }

    /* Seed button larger tap target on mobile */
    .seed-btn { width: var(--tap-min); height: var(--tap-min); }

    /* ── Header ── */
    header {
      padding: 0.75rem 1rem;
      position: sticky;
      top: 0;
      z-index: 30;
    }
    header h1 { font-size: 1.15rem; }
    /* Count takes too much space on narrow screens — hide it */
    .header-count { display: none; }

    /* ── Page / layout ── */
    /* overflow:clip clips visually WITHOUT creating a scroll container, so sticky still works.
       Must override BOTH axes — the desktop rule sets `overflow: hidden` shorthand, and leaving
       overflow-y as hidden makes .page a scroll container, which traps position:sticky inside
       .page (height:auto = no scroll room) instead of letting it stick to the body scroll. */
    .page { height: auto; overflow: clip; grid-template-rows: auto auto; }
    /* Stacked single column */
    .layout { grid-template-columns: 1fr; overflow: visible; height: auto; }

    /* Cards column: simple block flow, no desktop flex/shadow */
    .cards-col {
      height: auto;
      display: block;
      overflow-x: clip;
      box-shadow: none;
    }

    /* ── Sticky map just below the header ── */
    .map-col {
      height: var(--map-h-mobile);
      overflow: hidden;
      position: sticky;
      top: var(--header-h, 70px);
      z-index: 20;
      transition: height 0.25s cubic-bezier(0.22, 1, 0.36, 1);
    }
    .map-col.map-hidden { height: 0; }

    /* ── Controls ── */
    /* Clip horizontal overflow at the bar without hiding the filter panel below */
    .controls-wrap { overflow-x: clip; }
    /* Fade the right edge as a hint that the bar scrolls horizontally.
       The fade sits above the controls row and ignores pointer events. */
    .controls-wrap::after {
      content: '';
      position: absolute;
      top: 0; right: 0;
      width: 28px; height: var(--tap-min);
      background: linear-gradient(to right, rgba(252, 250, 245, 0), var(--surface-raised));
      pointer-events: none;
      z-index: 1;
    }
    .controls { overflow-x: auto; -webkit-overflow-scrolling: touch; flex-wrap: nowrap; }
    .tab, .filter-toggle, .sort-select { min-height: var(--tap-min); white-space: nowrap; }

    /* Filter panel */
    .filter-panel.open { max-height: 200px; }
    .chip { min-height: 36px; padding: 0.35rem 0.7rem; font-size: 0.74rem; }
    .filter-groups { gap: 1.25rem; padding: 0.8rem 1rem; }

    /* ── Cards ── */
    /* scroll-area is now just a plain block; body handles scrolling */
    .scroll-area { flex: none; overflow-y: visible; }
    .grid { padding: 1rem 0.85rem 3rem; gap: 0.75rem; }
    .empty { padding: 3rem 1rem; }

    /* ── Seed button ── */
    .seed-btn { width: var(--tap-min); height: var(--tap-min); }

    /* ── Map toggle active state ── */
    .map-toggle.map-showing {
      background: var(--forest-800);
      border-color: var(--forest-400);
      color: var(--bone-200);
    }

    /* Seed popover spans most of the viewport on phones */
    .seed-popover {
      right: 0.5rem;
      left: 0.5rem;
      width: auto;
      max-width: none;
    }
  }
</style>

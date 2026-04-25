<script>
  import OverviewMap from '$lib/components/OverviewMap.svelte';
  import TripCard from '$lib/components/TripCard.svelte';
  import DetailPanel from '$lib/components/DetailPanel.svelte';
  import ActionPanel from '$lib/components/ActionPanel.svelte';
  import { streamAction } from '$lib/utils/action.js';
  import { invalidateAll } from '$app/navigation';
  import { browser } from '$app/environment';

  let { data } = $props();

  // Stage filter
  let activeFilter = $state('all');
  // Sort
  let activeSort   = $state('date');
  // Detail panel
  let selectedTrip = $state(null);
  let hoveredSlug  = $state(null);
  // Extended filters
  let filterOpen   = $state(false);
  let activeMode   = $state('all');   // 'all' | 'drive' | 'fly'
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

  // Reset distance when fly is selected
  $effect(() => { if (activeMode === 'fly') activeDist = 'any'; });

  const attrFilterCount = $derived(
    (activeMode !== 'all' ? 1 : 0) +
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
  let scrollRaf = null;

  $effect(() => {
    if (!browser) return;
    const mq = window.matchMedia('(max-width: 768px)');
    isMobile = mq.matches;
    const onChange = e => { isMobile = e.matches; if (!e.matches) scrollFocusedSlug = null; };
    mq.addEventListener('change', onChange);

    function onScroll() {
      if (!isMobile) return;
      if (scrollRaf) return;
      scrollRaf = requestAnimationFrame(() => {
        scrollRaf = null;
        // Aim for 65% down the viewport — below the sticky 45vh map
        const target = window.innerHeight * 0.65;
        let best = null, bestDist = Infinity;
        for (const el of document.querySelectorAll('[id^="card-"]')) {
          const r = el.getBoundingClientRect();
          if (r.bottom < 0 || r.top > window.innerHeight) continue;
          const dist = Math.abs((r.top + r.height / 2) - target);
          if (dist < bestDist) { bestDist = dist; best = el.id.replace('card-', ''); }
        }
        scrollFocusedSlug = best;
      });
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      mq.removeEventListener('change', onChange);
      window.removeEventListener('scroll', onScroll);
    };
  });

  // On mobile use scroll position to drive map focus; mouse hover wins on desktop
  const effectiveHovered = $derived(hoveredSlug || (isMobile ? scrollFocusedSlug : null));

  // ── In-browser actions ──
  let actionVisible  = $state(false);
  let actionRunning  = $state(false);
  let actionMessages = $state([]);
  let actionDone     = $state(false);

  function actionPush(msg, done = false) {
    actionMessages = [...actionMessages, msg];
    if (done) { actionDone = true; actionRunning = false; }
  }

  async function runSeed() {
    if (actionRunning) return;
    actionVisible = true;
    actionRunning = true;
    actionDone    = false;
    actionMessages = [];
    try {
      await streamAction('/api/actions/seed', ({ msg, done }) => {
        actionPush(msg, done);
        if (done) invalidateAll();
      });
    } catch (e) {
      actionPush(`Error: ${e.message}`, true);
    }
  }

  async function runDeepen(slug) {
    if (actionRunning) return;
    actionVisible = true;
    actionRunning = true;
    actionDone    = false;
    actionMessages = [];
    try {
      await streamAction(`/api/actions/deepen/${encodeURIComponent(slug)}`, ({ msg, done }) => {
        actionPush(msg, done);
        if (done) invalidateAll();
      });
    } catch (e) {
      actionPush(`Error: ${e.message}`, true);
    }
  }

  function clearAttrs() {
    activeMode    = 'all';
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
      if (activeMode === 'drive' && t.fly_in === 'true') return false;
      if (activeMode === 'fly'   && t.fly_in !== 'true') return false;
      if (activeDist !== 'any' && t.fly_in !== 'true') {
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
    />
  {/if}

  <header bind:this={headerEl}>
    <div class="wordmark">
      <svg class="logo" width="18" height="26" viewBox="0 0 9 13" aria-hidden="true">
        <!-- Compass needle: solid north, muted south -->
        <path d="M4.5 0L1 6.5h7L4.5 0z" fill="currentColor"/>
        <path d="M4.5 13L8 6.5H1L4.5 13z" fill="currentColor" opacity="0.3"/>
      </svg>
      <h1>Atlas</h1>
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
        onclick={runSeed}
        disabled={actionRunning}
        title="Add 5 new trip ideas"
        aria-label="Add trips"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <path d="M7 1v12M1 7h12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
        </svg>
      </button>
    </div>
  </header>

  <div class="layout">
    <div class="map-col" class:map-hidden={!mapVisible}>
      <OverviewMap {trips} home={data.home} hoveredSlug={effectiveHovered}
        selectedSlug={selectedTrip?._slug}
        onTripClick={t => selectedTrip = t} />
    </div>

    <div class="cards-col">
      <!-- Stage tabs + filter toggle + sort -->
      <div class="controls-wrap">
        <div class="controls">
          {#each ['all','idea','exploring','planned','completed'] as f}
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
                <path d="M1 1h8v11L5 9 1 11V1z" fill="currentColor"/>
              {:else}
                <path d="M1 1h8v11L5 9 1 11V1z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="miter"/>
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
              <div class="group-label">Mode</div>
              <div class="chips">
                {#each [['all','All'],['drive','Drive'],['fly','Fly']] as [val, label]}
                  <button class="chip" class:active={activeMode === val} onclick={() => activeMode = val}>{label}</button>
                {/each}
              </div>
            </div>

            {#if activeMode !== 'fly'}
              <div class="filter-group">
                <div class="group-label">Drive time</div>
                <div class="chips">
                  {#each [['any','Any'],['u3','≤3hr'],['3-6','3–6hr'],['6plus','6hr+']] as [val, label]}
                    <button class="chip" class:active={activeDist === val} onclick={() => activeDist = val}>{label}</button>
                  {/each}
                </div>
              </div>
            {/if}

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
              onclick={() => selectedTrip = trip}
              onhover={() => hoveredSlug = trip._slug}
              onleave={() => hoveredSlug = null}
              onbookmark={(e) => toggleBookmark(trip, e)}
              ondeepen={(e) => { e?.stopPropagation(); runDeepen(trip._slug); }}
            />
          {:else}
            <div class="empty">
              <p>No trips match these filters.</p>
              {#if attrFilterCount > 0}
                <button class="empty-clear" onclick={clearAttrs}>Clear filters</button>
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
    background: var(--header-bg);
    color: var(--header-text);
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
    border: 1.5px solid oklch(36% 0.06 155);
    border-radius: 50%;
    width: 28px; height: 28px;
    display: flex; align-items: center; justify-content: center;
    cursor: pointer;
    color: oklch(62% 0.022 155);
    transition: border-color 0.15s, color 0.15s, background 0.15s;
    flex-shrink: 0;
  }
  .seed-btn:hover:not(:disabled) {
    border-color: oklch(62% 0.08 155);
    color: oklch(82% 0.025 155);
    background: oklch(28% 0.03 155);
  }
  .seed-btn:disabled { opacity: 0.4; cursor: not-allowed; }

  .logo {
    flex-shrink: 0;
    color: var(--header-text);
    display: block;
  }

  header h1 {
    font-size: 1.6rem;
    font-weight: 800;
    letter-spacing: -0.02em;
    text-transform: uppercase;
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
    color: oklch(80% 0.03 155);
  }
  .count-label {
    font-size: 0.58rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: oklch(54% 0.024 155);
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
    box-shadow: -6px 0 24px oklch(0% 0 0 / 0.07);
    background: var(--bg);
  }

  /* ── Controls wrap (tabs + filter panel) ── */
  .controls-wrap {
    flex-shrink: 0;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
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
    color: var(--text-3);
    font-family: var(--font);
    border-bottom: 2px solid transparent;
    transition: color 0.12s, border-color 0.12s;
    white-space: nowrap;
  }
  .tab:hover { color: var(--text); }
  .tab.active {
    color: var(--accent);
    border-bottom-color: var(--accent);
    font-weight: 600;
  }

  .star-tab {
    padding-left: 0.6rem;
    padding-right: 0.6rem;
    display: flex;
    align-items: center;
  }

  .divider { width: 1px; background: var(--border); margin: 0.65rem 0.35rem; flex-shrink: 0; }

  .filter-toggle {
    border: none;
    background: none;
    padding: 0.75rem 0.75rem 0.7rem;
    font-size: 0.76rem;
    font-weight: 500;
    cursor: pointer;
    color: var(--text-3);
    font-family: var(--font);
    display: flex;
    align-items: center;
    gap: 0.3rem;
    transition: color 0.12s;
    white-space: nowrap;
    border-bottom: 2px solid transparent;
  }
  .filter-toggle:hover { color: var(--text); }
  .filter-toggle.active {
    color: var(--accent);
    border-bottom-color: var(--accent);
  }
  .filter-toggle.has-filters { color: var(--accent); font-weight: 600; }

  .chevron {
    transition: transform 0.18s cubic-bezier(0.22, 1, 0.36, 1);
    flex-shrink: 0;
  }
  .chevron.open { transform: rotate(180deg); }

  .sort-select {
    font-size: 0.73rem;
    font-weight: 500;
    color: var(--text-3);
    border: none;
    background: none;
    padding: 0.75rem 1.4rem 0.7rem 0.3rem;
    cursor: pointer;
    outline: none;
    appearance: none;
    font-family: var(--font);
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
    border-top: 1px solid var(--border-subtle);
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
    color: var(--text-3);
  }

  .chips { display: flex; gap: 0.2rem; }

  .chip {
    border: 1.5px solid var(--border);
    background: none;
    padding: 0.2rem 0.55rem;
    border-radius: 3px;
    font-size: 0.71rem;
    font-weight: 500;
    cursor: pointer;
    color: var(--text-2);
    font-family: var(--font);
    transition: border-color 0.1s, background 0.1s, color 0.1s;
    white-space: nowrap;
  }
  .chip:hover { border-color: var(--accent-border); color: var(--accent); }
  .chip.active {
    background: var(--accent);
    border-color: var(--accent);
    color: oklch(97% 0.012 80);
  }

  .clear-all {
    border: none;
    background: none;
    font-size: 0.71rem;
    font-weight: 500;
    color: var(--text-3);
    cursor: pointer;
    font-family: var(--font);
    padding: 0.2rem 0;
    margin-left: auto;
    align-self: flex-end;
    text-decoration: underline;
    text-underline-offset: 2px;
    transition: color 0.12s;
  }
  .clear-all:hover { color: var(--text); }

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
    color: var(--text-3);
    font-size: 0.875rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
  }
  .empty-clear {
    border: 1.5px solid var(--border);
    background: none;
    padding: 0.35rem 0.9rem;
    border-radius: 3px;
    font-size: 0.76rem;
    font-weight: 500;
    cursor: pointer;
    color: var(--text-2);
    font-family: var(--font);
    transition: border-color 0.12s, color 0.12s;
  }
  .empty-clear:hover { border-color: var(--accent-border); color: var(--accent); }

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
      border: 1px solid oklch(36% 0.06 155);
      border-radius: 4px;
      color: oklch(62% 0.022 155);
      font-family: var(--font);
      font-size: 0.72rem;
      font-weight: 600;
      letter-spacing: 0.04em;
      padding: 0.3rem 0.6rem;
      cursor: pointer;
      min-height: var(--tap-min);
      transition: background 0.12s, color 0.12s;
    }
    .map-toggle:hover { background: oklch(28% 0.03 155); color: oklch(82% 0.02 155); }

    /* Seed button larger tap target on mobile */
    .seed-btn { width: var(--tap-min); height: var(--tap-min); }

    /* Header tighter on mobile */
    header { padding: 0.8rem 1.1rem; }
    header h1 { font-size: 1.2rem; }
    .count-num { font-size: 1.3rem; }

    /* Stacked layout — must override desktop overflow:hidden or sticky breaks */
    .layout { grid-template-columns: 1fr; overflow: visible; height: auto; }

    /* overflow:clip clips visually WITHOUT creating a BFC, so sticky still works */
    .page { overflow-x: clip; }
    .cards-col { height: auto; overflow-x: clip; overflow-y: visible; }

    /* Sticky header — keeps Atlas bar visible while scrolling */
    header {
      position: sticky;
      top: 0;
      z-index: 30;
    }

    /* Map sticks just below the header */
    .map-col {
      height: var(--map-h-mobile);
      overflow: hidden;
      position: sticky;
      top: var(--header-h, 56px);
      z-index: 20;
      transition: height 0.25s cubic-bezier(0.22, 1, 0.36, 1);
    }
    .map-col.map-hidden { height: 0; }

    /* Controls: clip overflow at the wrapper, scroll inside */
    .controls-wrap { overflow: hidden; }
    .controls { overflow-x: auto; -webkit-overflow-scrolling: touch; flex-wrap: nowrap; }
    .tab, .filter-toggle, .sort-select { min-height: var(--tap-min); white-space: nowrap; }

    /* Filter panel needs more vertical room for larger targets */
    .filter-panel.open { max-height: 200px; }
    .chip { min-height: 36px; padding: 0.35rem 0.7rem; font-size: 0.74rem; }
    .filter-groups { gap: 1.25rem; padding: 0.8rem 1.1rem; }

    /* Body scrolls on mobile — scroll-area doesn't need its own container */
    .scroll-area { overflow-y: visible; min-height: 0; }
    .grid { padding: 1rem 0.85rem 3rem; gap: 0.75rem; }

    .empty { padding: 3rem 1rem; }

    /* Map toggle active state — filled when map is showing */
    .map-toggle.map-showing {
      background: oklch(30% 0.035 155);
      border-color: oklch(52% 0.08 155);
      color: oklch(84% 0.025 155);
    }
  }
</style>

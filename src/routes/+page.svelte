<script>
  import OverviewMap from '$lib/components/OverviewMap.svelte';
  import TripCard from '$lib/components/TripCard.svelte';
  import TripJobBadge from '$lib/components/TripJobBadge.svelte';
  import DetailPanel from '$lib/components/DetailPanel.svelte';
  import PromiseTooltip from '$lib/components/PromiseTooltip.svelte';
  import ConfirmModal from '$lib/components/ConfirmModal.svelte';
  import Logo from '$lib/components/Logo.svelte';
  import { streamAction } from '$lib/utils/action.js';
  import { goto, invalidateAll } from '$app/navigation';
  import { browser } from '$app/environment';
  import { filterJobsForSlug } from '$lib/utils/jobLabels.js';
  import { failureSentence } from '$lib/errors-registry.js';
  import { formatTokens } from '$lib/utils/formatTokens.js';
  import { focusTrap } from '$lib/actions/focusTrap.js';

  let { data } = $props();

  // Mirror of src/routes/api/actions/add/+server.js _promise export, used
  // as a synchronous fallback when `data.promises` isn't populated (e.g.
  // older client builds rehydrating against a fresh server). When
  // telemetry overrides are available the server delivers them via
  // `data.promises` keyed by `chat()` label (see src/lib/server/promises.js).
  const ADD_FALLBACK = {
    verb: 'Add destination',
    produces: 'One new trip idea file for the named destination, after checking for duplicates and road-trip viability.',
    time_seconds: 12,
    tokens_range: [400, 800],
  };
  const SEED_FALLBACK = {
    verb: 'Generate ideas',
    produces: 'Five new road-trip idea files tailored to your taste profile and steering prompt.',
    time_seconds: 20,
    tokens_range: [1500, 3000],
  };
  const ADD_PROMISE = $derived(data.promises?.add ?? ADD_FALLBACK);
  const SEED_PROMISE = $derived(data.promises?.seed ?? SEED_FALLBACK);

  // ── Background jobs polling (10s interval) ──
  // Fetches GET /api/jobs once and distributes the filtered subset to each
  // card via filterJobsForSlug(). Stops/starts cleanly with the component.
  let allJobs = $state([]);

  $effect(() => {
    if (!browser) return;
    let cancelled = false;
    async function fetchJobs() {
      try {
        const res = await fetch('/api/jobs');
        if (!cancelled && res.ok) {
          const body = await res.json();
          allJobs = body.jobs ?? [];
        }
      } catch { /* network blip — keep stale state */ }
    }
    fetchJobs();
    const timer = setInterval(fetchJobs, 10_000);
    return () => { cancelled = true; clearInterval(timer); };
  });

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

  // ── Confirm modal ──
  let confirmOpen  = $state(false);
  let confirmOpts  = $state({});
  let confirmResolve = null;

  function showConfirm(opts) {
    if (confirmResolve) confirmResolve(false); // resolve any stranded caller
    return new Promise(resolve => {
      confirmResolve = resolve;
      confirmOpts    = opts;
      confirmOpen    = true;
    });
  }

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

  // Active-filter pills: render only attribute filters that diverge from
  // their default. Stage tabs aren't included because there's always a
  // stage selected; the tab strip already shows which one is active.
  const distLabels = { u3: '≤3hr', '3-6': '3–6hr', '6plus': '6hr+' };
  const costLabels = { budget: 'Budget', mid: 'Mid', splurge: 'Splurge' };
  const activePills = $derived.by(() => {
    const pills = [];
    if (activeDist !== 'any')
      pills.push({ key: 'dist', label: `Drive: ${distLabels[activeDist]}`, clear: () => activeDist = 'any' });
    if (activeCost !== 'any')
      pills.push({ key: 'cost', label: `Budget: ${costLabels[activeCost]}`, clear: () => activeCost = 'any' });
    if (activeNPS)
      pills.push({ key: 'nps', label: 'NPS only', clear: () => activeNPS = false });
    if (activeStarred)
      pills.push({ key: 'starred', label: 'Bookmarked', clear: () => activeStarred = false });
    return pills;
  });

  // Mobile-only count + stage status row text. Computed here so the markup
  // stays a single derived check. (#239)
  const stageLabels = { idea: 'Ideas', planning: 'Planning', completed: 'Completed' };
  const mobileStatusText = $derived.by(() => {
    const total = data.trips.length;
    const shown = trips.length;
    const stageActive = activeFilter !== 'all';
    const filtered = stageActive || attrFilterCount > 0;
    if (!filtered) {
      return `${total} destination${total !== 1 ? 's' : ''}`;
    }
    const head = `${shown} of ${total} trip${total !== 1 ? 's' : ''}`;
    return stageActive ? `${head} · ${stageLabels[activeFilter]}` : head;
  });

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

  // ── Seed — Instant Inline (docs/ai-workflow-ux.md §2.1) ──────────────────
  // Status drives both the header button spinner and the popover submit button.
  let seedStatus     = $state('idle');   // 'idle' | 'in_progress' | 'success' | 'failure'
  let seedErrorCode  = $state(null);
  let seedTokens     = $state(null);
  let seedLog        = $state([]);       // SSE messages for the <details> disclosure
  let seedToastTimer = $state(null);     // setTimeout handle for success auto-dismiss

  // ── Add destination — Instant Inline (docs/ai-workflow-ux.md §2.1) ────────
  let addStatus     = $state('idle');   // 'idle' | 'in_progress' | 'success' | 'failure'
  let addErrorCode  = $state(null);
  let addTokens     = $state(null);
  let addLog        = $state([]);       // SSE messages for the <details> disclosure
  let addToastTimer = $state(null);     // setTimeout handle for success auto-dismiss

  // Seed prompt form (the + button opens this instead of running immediately
  // — gives the user a chance to steer the batch and is its own confirmation).
  let seedFormOpen = $state(false);
  let seedPrompt   = $state('');

  // Pin form — add one specific destination
  let pinFormOpen = $state(false);
  let pinDest     = $state('');

  // Action error toast — used by archive / deepen and any handler that
  // doesn't have its own popover envelope to render failure into.
  // Shape: { code: string, ctx?: object } or null.
  let actionError = $state(null);

  function dismissActionError() {
    actionError = null;
  }

  async function runSeed() {
    if (seedStatus === 'in_progress') return;
    const prompt = seedPrompt.trim();
    seedFormOpen = false;
    seedPrompt   = '';

    // Clear any pending toast auto-dismiss timer from a previous run
    if (seedToastTimer) { clearTimeout(seedToastTimer); seedToastTimer = null; }

    seedStatus    = 'in_progress';
    seedErrorCode = null;
    seedTokens    = null;
    seedLog       = [];

    try {
      await streamAction('/api/actions/seed', (event) => {
        const { msg, done, tokens } = event;
        seedLog = [...seedLog, msg];

        if (done) {
          const isErr = typeof msg === 'string' && msg.toLowerCase().startsWith('error');
          if (isErr) {
            seedStatus    = 'failure';
            seedErrorCode = 'network_error';
          } else {
            seedStatus = 'success';
            seedTokens = tokens ?? null;
            invalidateAll();
            // Auto-dismiss the success state after 4s
            seedToastTimer = setTimeout(() => {
              seedStatus     = 'idle';
              seedToastTimer = null;
            }, 4000);
          }
        }
      }, { prompt });
    } catch {
      // Don't leak err.message into the user-visible log — the failureSentence
      // for `network_error` is rendered separately (#269).
      seedLog       = [...seedLog, 'Network error.'];
      seedStatus    = 'failure';
      seedErrorCode = 'network_error';
    }
  }

  function retrySeed() {
    runSeed();
  }

  function dismissSeedError() {
    seedStatus    = 'idle';
    seedErrorCode = null;
  }

  async function runPin() {
    if (addStatus === 'in_progress') return;
    const dest = pinDest.trim();
    if (!dest) return;

    // Clear any pending toast auto-dismiss timer from a previous run
    if (addToastTimer) { clearTimeout(addToastTimer); addToastTimer = null; }

    addStatus    = 'in_progress';
    addErrorCode = null;
    addTokens    = null;
    addLog       = [];

    try {
      await streamAction('/api/actions/add', (event) => {
        const { msg, done, tokens } = event;
        addLog = [...addLog, msg];

        if (done) {
          const isErr = typeof msg === 'string' && msg.toLowerCase().startsWith('error');
          if (isErr) {
            addStatus    = 'failure';
            addErrorCode = 'network_error';
          } else {
            addStatus = 'success';
            addTokens = tokens ?? null;
            invalidateAll();
            // Close the form and reset input on success
            pinFormOpen = false;
            pinDest     = '';
            // Auto-dismiss the success state after 4s
            addToastTimer = setTimeout(() => {
              addStatus     = 'idle';
              addToastTimer = null;
            }, 4000);
          }
        }
      }, { destination: dest });
    } catch {
      // Don't leak err.message into the user-visible log — the failureSentence
      // for `network_error` is rendered separately (#269).
      addLog       = [...addLog, 'Network error.'];
      addStatus    = 'failure';
      addErrorCode = 'network_error';
    }
  }

  function retryAdd() {
    runPin();
  }

  function dismissAddError() {
    addStatus    = 'idle';
    addErrorCode = null;
  }

  async function runDeepen(trip) {
    const ok = await showConfirm({
      title:        `Research "${trip.title || trip._slug}"?`,
      body:         'Searches the web for hours, prices, lodging, and route highlights. Runs in the background; you can navigate away.',
      confirmLabel: 'Start research',
      danger:       false,
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/actions/deepen/${encodeURIComponent(trip._slug)}`, { method: 'POST' });
      if (res.status === 409) {
        actionError = { code: 'already_running' };
        return;
      }
      if (!res.ok) {
        console.error(`deepen failed: ${res.status}`);
        actionError = { code: 'action_failed', ctx: { action: 'start research' } };
        return;
      }
      // 202 accepted, so the card flips to "Researching…" immediately.
      await invalidateAll();
    } catch (e) {
      console.error(e);
      actionError = { code: 'network_error' };
    }
  }

  async function archiveTrip(trip, e) {
    e?.stopPropagation?.();
    if (!trip) return;
    const label = trip.title || trip._slug;
    const ok = await showConfirm({
      title:        `Archive "${label}"?`,
      body:         "It'll vanish from view but stay on disk, so the seeder won't suggest it again.",
      confirmLabel: 'Archive',
      danger:       true,
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/archive/${encodeURIComponent(trip._slug)}`, { method: 'POST' });
      if (!res.ok) throw new Error(`Archive failed: ${res.status}`);
      selectedTrip = null;
      await invalidateAll();
    } catch (err) {
      console.error(err);
      actionError = { code: 'action_failed', ctx: { action: 'archive that trip' } };
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
    // All comparators use slug as a stable secondary key to prevent re-ordering
    // between renders when the primary values are equal.
    if (by === 'time') return arr.sort((a, b) =>
      ((a._drive_hours ?? 999) - (b._drive_hours ?? 999)) ||
      (a.slug || '').localeCompare(b.slug || ''));
    if (by === 'cost') return arr.sort((a, b) =>
      (costLow(a._cost) - costLow(b._cost)) ||
      (a.slug || '').localeCompare(b.slug || ''));
    if (by === 'az')   return arr.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    return arr;
  }
</script>

<div class="page">
  {#if data.features?.pexelsConfigured === false}
    <div class="pexels-banner" role="status">
      <span class="pexels-banner-text">
        Hero photos aren't loading because Pexels isn't configured.
      </span>
      <a class="pexels-banner-cta" href="/settings#server-config">Open settings →</a>
    </div>
  {/if}

  <div class="toast-stack">
    {#if seedStatus === 'success'}
      <div class="seed-toast" role="status" aria-live="polite">
        ✓ 5 ideas added{seedTokens ? ` · ${formatTokens(seedTokens)}` : ''}
      </div>
    {/if}

    {#if addStatus === 'success'}
      <div class="seed-toast" role="status" aria-live="polite">
        ✓ Idea added{addTokens ? ` · ${formatTokens(addTokens)}` : ''}
      </div>
    {/if}

    {#if actionError}
      <div class="action-error-toast" role="alert" aria-live="polite">
        <p class="action-error-sentence">{failureSentence(actionError.code, actionError.ctx ?? {})}</p>
        <button class="action-error-dismiss" onclick={dismissActionError} aria-label="Dismiss">Dismiss</button>
      </div>
    {/if}
  </div>


  <header bind:this={headerEl}>
    <a href="/" class="wordmark" aria-label="Traverse home">
      <Logo variant="inverse" size={28} aria-hidden="true" />
      <h1>Traverse</h1>
    </a>
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
      {mapVisible ? 'Hide map' : 'Show map'}
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
      {#if data.features?.homeMdReady === false}
        <a href="/onboarding" class="home-setup-cta" title="Set up your home base to enable AI features">
          Set up home base
        </a>
      {:else if !data.features?.seed && !data.features?.add}
        <a class="ai-setup-cta" href="/settings#server-config">
          Configure AI →
        </a>
      {:else}
        <PromiseTooltip promise={SEED_PROMISE}>
          <button
            class="seed-btn labeled"
            class:open={seedFormOpen}
            class:seed-running={seedStatus === 'in_progress'}
            onclick={() => { seedFormOpen = !seedFormOpen; pinFormOpen = false; }}
            disabled={seedStatus === 'in_progress' || !data.features?.seed}
            aria-label={seedStatus === 'in_progress' ? 'Generating ideas…' : 'Generate ideas'}
            aria-expanded={seedFormOpen}
            aria-busy={seedStatus === 'in_progress'}
          >
            {#if seedStatus === 'in_progress'}
              <span class="seed-spinner" aria-hidden="true"></span>
            {:else}
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                <path d="M7 1v12M1 7h12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
              </svg>
            {/if}
            <span class="action-label">{seedStatus === 'in_progress' ? 'Generating…' : 'New ideas'}</span>
          </button>
        </PromiseTooltip>
        <PromiseTooltip promise={ADD_PROMISE}>
          <button
            class="seed-btn pin-btn labeled"
            class:open={pinFormOpen}
            class:add-running={addStatus === 'in_progress'}
            onclick={() => { if (addStatus !== 'in_progress') { pinFormOpen = !pinFormOpen; seedFormOpen = false; } }}
            disabled={addStatus === 'in_progress' || !data.features?.add}
            aria-label={addStatus === 'in_progress' ? 'Adding…' : 'Add destination'}
            aria-expanded={pinFormOpen}
            aria-busy={addStatus === 'in_progress'}
          >
            {#if addStatus === 'in_progress'}
              <span class="seed-spinner" aria-hidden="true"></span>
            {:else}
              <svg width="12" height="15" viewBox="0 0 12 15" aria-hidden="true">
                <path d="M6 0C3.24 0 1 2.24 1 5c0 3.75 5 9 5 9s5-5.25 5-9c0-2.76-2.24-5-5-5z" fill="currentColor" opacity="0.85"/>
                <circle cx="6" cy="5" r="1.8" fill="var(--surface-raised)"/>
              </svg>
            {/if}
            <span class="action-label">{addStatus === 'in_progress' ? 'Adding…' : 'Add place'}</span>
          </button>
        </PromiseTooltip>
        {#if !data.features?.seed || !data.features?.add}
          <a class="ai-partial-cta" href="/settings#server-config" title="Some AI features are unavailable until configured">
            Configure AI →
          </a>
        {/if}
      {/if}
    </div>
  </header>

  {#if seedFormOpen}
    <div class="seed-backdrop" onclick={() => seedFormOpen = false} role="presentation"></div>
    <div
      class="seed-popover"
      role="dialog"
      aria-label="Generate trip ideas"
      use:focusTrap={{ onEscape: () => { seedFormOpen = false; seedPrompt = ''; } }}
    >
      <label class="seed-label" for="seed-prompt">
        Generate 5 new ideas
        <span class="seed-hint">Optional steering. Leave blank for general suggestions.</span>
      </label>
      <textarea
        id="seed-prompt"
        bind:value={seedPrompt}
        placeholder="e.g. fall colors within 4 hours, or scenic byways with quirky small towns"
        rows="3"
        disabled={seedStatus === 'in_progress'}
        use:focusOnMount
        onkeydown={e => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); runSeed(); }
          if (e.key === 'Escape') { seedFormOpen = false; }
        }}
      ></textarea>
      <div class="seed-actions">
        <button
          class="btn btn-tertiary btn-compact"
          onclick={() => { seedFormOpen = false; seedPrompt = ''; }}
          disabled={seedStatus === 'in_progress'}
        >Cancel</button>
        <button
          class="btn btn-primary btn-compact"
          class:is-busy={seedStatus === 'in_progress'}
          onclick={runSeed}
          disabled={seedStatus === 'in_progress'}
          aria-busy={seedStatus === 'in_progress'}
        >
          {#if seedStatus === 'in_progress'}
            <span class="btn-spinner" aria-hidden="true"></span>
            Generating…
          {:else}
            Generate 5 →
          {/if}
        </button>
      </div>

      {#if seedLog.length > 0}
        <details class="seed-log-disclosure">
          <summary>Details</summary>
          <div class="seed-log">
            {#each seedLog as line}
              <div class="seed-log-line">{line}</div>
            {/each}
          </div>
        </details>
      {/if}

      {#if seedStatus === 'failure'}
        <div class="seed-error" role="alert">
          <p class="seed-error-sentence">{failureSentence(seedErrorCode)}</p>
          <div class="seed-error-actions">
            <button class="btn btn-primary btn-compact" onclick={retrySeed}>Retry</button>
            <button class="btn btn-tertiary btn-compact" onclick={dismissSeedError}>Dismiss</button>
          </div>
        </div>
      {/if}
    </div>
  {/if}

  {#if pinFormOpen}
    <div class="seed-backdrop" onclick={() => { if (addStatus !== 'in_progress') pinFormOpen = false; }} role="presentation"></div>
    <div
      class="seed-popover"
      role="dialog"
      aria-label="Add specific destination"
      use:focusTrap={{ onEscape: () => { if (addStatus !== 'in_progress') { pinFormOpen = false; pinDest = ''; } } }}
    >
      <label class="seed-label" for="pin-dest">
        Add a destination
        <span class="seed-hint">Name a specific place to add as an idea.</span>
      </label>
      <input
        id="pin-dest"
        type="text"
        class="pin-input"
        bind:value={pinDest}
        placeholder="e.g. Marfa, TX or Boundary Waters, MN"
        disabled={addStatus === 'in_progress'}
        use:focusOnMount
        onkeydown={e => {
          if (e.key === 'Enter') { e.preventDefault(); runPin(); }
          if (e.key === 'Escape') { if (addStatus !== 'in_progress') pinFormOpen = false; }
        }}
      />
      <div class="seed-actions">
        <button
          class="btn btn-tertiary btn-compact"
          onclick={() => { pinFormOpen = false; pinDest = ''; }}
          disabled={addStatus === 'in_progress'}
        >Cancel</button>
        <button
          class="btn btn-primary btn-compact"
          class:is-busy={addStatus === 'in_progress'}
          onclick={runPin}
          disabled={addStatus === 'in_progress'}
          aria-busy={addStatus === 'in_progress'}
        >
          {#if addStatus === 'in_progress'}
            <span class="btn-spinner" aria-hidden="true"></span>
            Adding…
          {:else}
            Add →
          {/if}
        </button>
      </div>

      {#if addLog.length > 0}
        <details class="seed-log-disclosure">
          <summary>Details</summary>
          <div class="seed-log">
            {#each addLog as line}
              <div class="seed-log-line">{line}</div>
            {/each}
          </div>
        </details>
      {/if}

      {#if addStatus === 'failure'}
        <div class="seed-error" role="alert">
          <p class="seed-error-sentence">{failureSentence(addErrorCode)}</p>
          <div class="seed-error-actions">
            <button class="btn btn-primary btn-compact" onclick={retryAdd}>Retry</button>
            <button class="btn btn-tertiary btn-compact" onclick={dismissAddError}>Dismiss</button>
          </div>
        </div>
      {/if}
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
          {#each ['all','idea','planning','completed'] as f}
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

        <!-- Mobile-only count + stage status. Replaces the desktop
             .header-count which is hidden at the mobile breakpoint. Shows
             "12 of 30 trips · Planning" when filtered, or "30 destinations"
             when not, so the user keeps track of which slice they're viewing.
             (#239) -->
        {#if mobileStatusText}
          <div class="mobile-count" aria-live="polite">
            {mobileStatusText}
          </div>
        {/if}

        <!-- Active-filter pills: visible whenever attribute filters diverge
             from defaults, so the user can see and clear individual filters
             without re-opening the panel. -->
        {#if activePills.length > 0}
          <div class="active-pills" aria-label="Active filters">
            {#each activePills as pill (pill.key)}
              <button
                type="button"
                class="active-pill"
                onclick={pill.clear}
                aria-label="Remove {pill.label} filter"
              >
                <span class="active-pill-label">{pill.label}</span>
                <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true">
                  <path d="M1 1l6 6M7 1l-6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                </svg>
              </button>
            {/each}
            {#if activePills.length > 1}
              <button type="button" class="active-pill-clear" onclick={clearAttrs}>Clear all</button>
            {/if}
          </div>
        {/if}

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
              jobs={filterJobsForSlug(allJobs, trip._slug)}
              onclick={() => openTrip(trip)}
              onhover={() => hoveredSlug = trip._slug}
              onleave={() => hoveredSlug = null}
              onbookmark={(e) => toggleBookmark(trip, e)}
              ondeepen={data.features?.deepen ? (e) => { e?.stopPropagation(); runDeepen(trip); } : null}
              oncancel={null}
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

      <!-- Quiet utility footer. Settings used to live as a gear icon in the
           header cluster; moving it here gets it out of the primary-action
           cluster and matches the "rare nav" register it deserves. -->
      <footer class="page-footer">
        <a href="/settings" class="footer-link">Settings</a>
      </footer>
    </div>
  </div>
</div>

<DetailPanel
  trip={selectedTrip}
  starred={selectedTrip ? isStarred(selectedTrip) : false}
  onbookmark={(e) => selectedTrip && toggleBookmark(selectedTrip, e)}
  onarchive={(e) => selectedTrip && archiveTrip(selectedTrip, e)}
  onclose={() => selectedTrip = null}
/>

<ConfirmModal
  bind:open={confirmOpen}
  title={confirmOpts.title ?? ''}
  body={confirmOpts.body ?? ''}
  confirmLabel={confirmOpts.confirmLabel ?? 'Confirm'}
  danger={confirmOpts.danger ?? false}
  onconfirm={() => { confirmResolve?.(true);  confirmResolve = null; }}
  oncancel={() =>  { confirmResolve?.(false); confirmResolve = null; }}
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
    background: var(--forest-800);
    border-bottom: 1px solid var(--border-default);
    color: var(--bone-200);
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
    color: inherit;
    text-decoration: none;
    border-radius: 4px;
  }
  .wordmark:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 3px;
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
  /* Hover and open backgrounds use --forest-600 (one stop lighter than the
     header's --forest-800) so the fill is actually visible. Using
     --forest-800 here would equal the header bg and produce a no-op. */
  .seed-btn:hover:not(:disabled) {
    border-color: var(--forest-400);
    color: var(--bone-400);
    background: var(--forest-600);
  }
  .seed-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .seed-btn.open {
    background: var(--forest-600);
    border-color: var(--forest-400);
    color: var(--bone-400);
  }
  .seed-btn.open svg { transform: rotate(45deg); }
  .seed-btn svg { transition: transform 0.18s; }

  /* Instant Inline: spinner inside the header seed button while running */
  @keyframes seed-spin { to { transform: rotate(360deg); } }
  .seed-spinner {
    width: 12px; height: 12px;
    border: 1.5px solid var(--forest-600);
    border-top-color: var(--bone-400);
    border-radius: 50%;
    animation: seed-spin 0.8s linear infinite;
    display: block;
    flex-shrink: 0;
  }
  .seed-btn.seed-running { border-color: var(--forest-400); opacity: 1; }

  .pin-btn svg { transform: none !important; }
  /* Sunset-400 sits at ~5.7:1 on the forest-800 header in both themes;
     --accent-text was tuned for small text and only reads ~2.5:1 here. */
  .pin-btn { color: var(--sunset-400); border-color: var(--sunset-800); }
  .pin-btn:hover:not(:disabled) { border-color: var(--sunset-600); color: var(--sunset-200); background: var(--sunset-800); }
  .pin-btn.open { background: var(--sunset-800); border-color: var(--sunset-600); color: var(--sunset-200); }
  .pin-btn.add-running { border-color: var(--sunset-600); opacity: 1; }

  /* Pexels missing-key banner (#284) — self-resolves once a key is added,
     so non-dismissible. Quiet sunset palette so it reads as informational,
     not as an error. */
  .pexels-banner {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    flex-wrap: wrap;
    padding: 0.55rem 1rem;
    background: var(--sunset-900);
    border-bottom: 1px solid var(--sunset-800);
    color: var(--sunset-100);
    font-size: 0.82rem;
    line-height: 1.3;
  }
  .pexels-banner-cta {
    color: var(--sunset-200);
    text-decoration: underline;
    text-underline-offset: 2px;
    white-space: nowrap;
  }
  .pexels-banner-cta:hover {
    color: var(--sunset-100);
  }

  .home-setup-cta {
    font-size: 0.75rem;
    padding: 0.3rem 0.65rem;
    border-radius: 6px;
    border: 1px solid var(--forest-600);
    color: var(--forest-200);
    background: var(--forest-900);
    text-decoration: none;
    white-space: nowrap;
  }
  .home-setup-cta:hover {
    background: var(--forest-800);
    border-color: var(--forest-400);
    color: var(--forest-100);
  }

  /* Labeled variant of seed/add — pill shape with visible text. (#234) */
  .seed-btn.labeled {
    border-radius: 999px;
    width: auto;
    height: auto;
    padding: 0.3rem 0.7rem 0.3rem 0.55rem;
    gap: 0.35rem;
  }
  .action-label {
    font-size: 0.78rem;
    line-height: 1;
    white-space: nowrap;
    font-weight: 500;
    letter-spacing: 0.01em;
  }

  /* Inline recovery link surfaced when seed/add are unavailable. (#234) */
  .ai-setup-cta,
  .ai-partial-cta {
    font-size: 0.75rem;
    padding: 0.3rem 0.65rem;
    border-radius: 6px;
    border: 1px dashed var(--sunset-600);
    color: var(--sunset-200);
    background: transparent;
    text-decoration: none;
    white-space: nowrap;
  }
  .ai-setup-cta:hover,
  .ai-partial-cta:hover {
    border-style: solid;
    background: var(--sunset-800);
    color: var(--sunset-100);
  }
  .ai-partial-cta {
    /* Quieter than the standalone CTA — it sits next to working buttons. */
    border-color: var(--surface-border, var(--forest-700));
    color: var(--text-muted, var(--bone-600));
  }

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
    border: 1px solid var(--border-default);
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
    display: block;
    margin-top: 0.2rem;
    font-weight: 400;
    color: var(--text-tertiary);
    font-size: 0.74rem;
  }
  .seed-popover textarea {
    width: 100%;
    border: 1px solid var(--border-default);
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
    border: 1px solid var(--border-default);
    border-radius: 4px;
    padding: 0.55rem 0.7rem;
    font-family: var(--font-sans);
    font-size: 0.84rem;
    color: var(--text-primary);
    background: var(--surface-page);
  }
  .pin-input:focus { outline: 2px solid var(--forest-200); outline-offset: 1px; }
  .seed-actions {
    display: flex; gap: 0.5rem; justify-content: flex-end; align-items: center;
  }

  /* Instant Inline: spinner inside the Generate 5 button. Inherits from
     currentColor so it tracks .btn-primary's text in both themes (light:
     near-white on forest, dark: near-black on bone). */
  .btn-spinner {
    display: inline-block;
    width: 10px; height: 10px;
    border: 1.5px solid color-mix(in srgb, currentColor 40%, transparent);
    border-top-color: currentColor;
    border-radius: 50%;
    animation: seed-spin 0.8s linear infinite;
    vertical-align: middle;
    margin-right: 0.2rem;
    flex-shrink: 0;
  }
  .btn.is-busy { opacity: 0.75; cursor: not-allowed; }

  /* SSE log disclosure — power-user details, collapsed by default */
  .seed-log-disclosure {
    margin-top: 0.35rem;
    font-size: 0.74rem;
    color: var(--text-tertiary);
  }
  .seed-log-disclosure summary {
    cursor: pointer;
    font-weight: 600;
    font-size: 0.72rem;
    color: var(--text-tertiary);
    list-style: none;
    padding: 0.15rem 0;
    user-select: none;
  }
  .seed-log-disclosure summary::-webkit-details-marker { display: none; }
  .seed-log {
    margin-top: 0.3rem;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    max-height: 140px;
    overflow-y: auto;
    padding: 0.35rem 0.5rem;
    background: var(--surface-page);
    border: 1px solid var(--border-default);
    border-radius: 4px;
  }
  .seed-log-line { line-height: 1.45; }

  /* Inline failure envelope */
  .seed-error {
    margin-top: 0.4rem;
    padding: 0.5rem 0.65rem;
    background: var(--state-danger-surface);
    border: 1px solid var(--state-danger);
    border-radius: 4px;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .seed-error-sentence {
    margin: 0;
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--text-primary);
    line-height: 1.4;
  }
  .seed-error-actions {
    display: flex;
    gap: 0.4rem;
  }

  /* Toast stack — fixed top-right column. Children handle their own colors
     and pointer-events; the container handles position and stacking gap. */
  .toast-stack {
    position: fixed;
    top: calc(var(--header-h, 4.5rem) + 0.75rem);
    right: 1.5rem;
    z-index: 200;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 0.5rem;
    pointer-events: none;
  }

  /* Success toast — auto-dismisses after 4s; no buttons, so non-interactive. */
  .seed-toast {
    background: var(--forest-800);
    color: var(--bone-200);
    padding: 0.6rem 1rem;
    border-radius: 6px;
    font-size: 0.82rem;
    font-weight: 600;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
    animation: toast-in 0.18s ease;
  }

  /* Error toast — sticks until dismissed. Embers ramp for danger affordance. */
  .action-error-toast {
    pointer-events: auto;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    max-width: 22rem;
    padding: 0.6rem 0.7rem 0.6rem 0.95rem;
    background: var(--state-danger-surface);
    color: var(--text-primary);
    border: 1px solid var(--state-danger);
    border-radius: 6px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
    animation: toast-in 0.18s ease;
  }
  .action-error-sentence {
    flex: 1;
    font-size: 0.82rem;
    font-weight: 500;
    line-height: 1.35;
  }
  .action-error-dismiss {
    flex-shrink: 0;
    background: transparent;
    border: 1px solid transparent;
    color: var(--state-danger);
    font-family: var(--font-sans);
    font-size: 0.74rem;
    font-weight: 600;
    letter-spacing: 0.02em;
    padding: 0.3rem 0.55rem;
    border-radius: 4px;
    cursor: pointer;
  }
  .action-error-dismiss:hover {
    background: rgba(168, 47, 31, 0.08);
    border-color: var(--state-danger);
  }
  .action-error-dismiss:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }

  @keyframes toast-in {
    from { opacity: 0; transform: translateY(-6px); }
    to   { opacity: 1; transform: translateY(0); }
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
    font-weight: 600;
    line-height: 1;
    letter-spacing: -0.04em;
    color: var(--bone-400);
  }
  .count-label {
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--bone-400);
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
    border-bottom: 1px solid var(--border-default);
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
  .tab:active { color: var(--text-secondary); background: var(--forest-50); }
  .tab.active {
    color: var(--text-secondary);
    border-bottom-color: var(--forest-800);
    font-weight: 600;
  }

  .star-tab {
    padding-left: 0.6rem;
    padding-right: 0.6rem;
    display: flex;
    align-items: center;
  }

  .divider { width: 1px; background: var(--border-default); margin: 0.65rem 0.35rem; flex-shrink: 0; }

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
    color: var(--text-secondary);
    border-bottom-color: var(--forest-800);
  }
  .filter-toggle.has-filters { color: var(--text-secondary); font-weight: 600; }

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
    color: var(--text-tertiary);
  }

  .chips { display: flex; gap: 0.2rem; }

  .chip {
    border: 1.5px solid var(--border-default);
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
  .chip:hover  { border-color: var(--forest-200); color: var(--text-secondary); }
  .chip:active { background: var(--forest-50); border-color: var(--forest-800); color: var(--text-secondary); }
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

  /* Mobile-only count + stage status row. Sits above the active-pills row
     and is hidden on desktop where .header-count provides the same signal.
     (#239) */
  .mobile-count { display: none; }

  /* Active-filter pills row — sits between the controls row and the filter
     panel. Visible whenever the user has applied attribute filters, so they
     can see what's active and remove individual filters without re-opening
     the panel. */
  .active-pills {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    padding: 0.5rem 1.5rem 0.6rem;
    border-top: 1px solid var(--border-subtle);
  }
  .active-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.22rem 0.45rem 0.22rem 0.6rem;
    background: var(--forest-800);
    border: 1px solid var(--forest-800);
    border-radius: 3px;
    font-family: var(--font-sans);
    font-size: 0.71rem;
    font-weight: 500;
    color: var(--bone-50);
    cursor: pointer;
    transition: background 0.12s, border-color 0.12s, color 0.12s;
  }
  .active-pill:hover {
    background: var(--state-danger);
    border-color: var(--state-danger);
  }
  .active-pill:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }
  .active-pill svg { display: block; opacity: 0.85; }
  .active-pill-label { letter-spacing: 0.01em; }

  .active-pill-clear {
    border: none;
    background: none;
    font-family: var(--font-sans);
    font-size: 0.71rem;
    font-weight: 500;
    color: var(--text-tertiary);
    cursor: pointer;
    padding: 0.22rem 0.4rem;
    text-decoration: underline;
    text-underline-offset: 2px;
    align-self: center;
    transition: color 0.12s;
  }
  .active-pill-clear:hover { color: var(--text-primary); }

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

  /* Quiet utility footer at the bottom of the cards column. On desktop it
     sits below the scroll area as a fixed-height strip; on mobile the
     surrounding layout already flows in document order, so the footer
     lands at the natural end of the page. */
  .page-footer {
    flex-shrink: 0;
    display: flex;
    justify-content: flex-end;
    padding: 0.55rem 1.5rem 0.7rem;
    border-top: 1px solid var(--border-subtle);
  }
  .footer-link {
    font-family: var(--font-sans);
    font-size: 0.78rem;
    color: var(--text-tertiary);
    text-decoration: none;
    padding: 0.35rem 0.55rem;
    border-radius: 4px;
    transition: color 0.15s, background 0.15s;
  }
  .footer-link:hover { color: var(--text-primary); background: var(--surface-sunken); }
  .footer-link:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
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
    /* Labeled variant stays a pill on mobile, just guarantees tap height. */
    .seed-btn.labeled { width: auto; min-height: var(--tap-min); padding-left: 0.65rem; padding-right: 0.85rem; }

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
      background: linear-gradient(to right, rgba(var(--surface-raised-rgb), 0), var(--surface-raised));
      pointer-events: none;
      z-index: 1;
    }
    .controls { overflow-x: auto; -webkit-overflow-scrolling: touch; flex-wrap: nowrap; }
    .tab, .filter-toggle, .sort-select { min-height: var(--tap-min); white-space: nowrap; }

    /* Filter panel */
    .filter-panel.open { max-height: 200px; }
    .chip { min-height: 36px; padding: 0.35rem 0.7rem; font-size: 0.74rem; }
    .filter-groups { gap: 1.25rem; padding: 0.8rem 1rem; }

    /* Active filter pills wrap below the (scrollable) controls row on mobile;
       give them generous tap targets and edge padding that matches the panel. */
    .active-pills { padding: 0.5rem 1rem 0.65rem; gap: 0.5rem; }
    .active-pill { min-height: 32px; padding: 0.35rem 0.55rem 0.35rem 0.7rem; font-size: 0.74rem; }

    /* ── Cards ── */
    /* scroll-area is now just a plain block; body handles scrolling */
    .scroll-area { flex: none; overflow-y: visible; }
    .grid { padding: 1rem 0.85rem 3rem; gap: 0.75rem; }
    .empty { padding: 3rem 1rem; }

    /* Footer at mobile: pull padding back to match the rest of the body. */
    .page-footer { padding: 0.6rem 1rem 0.8rem; }
    .footer-link { padding: 0.5rem 0.7rem; font-size: 0.82rem; }

    /* ── Seed button ── */
    .seed-btn { width: var(--tap-min); height: var(--tap-min); }
    /* Labeled variant stays a pill on mobile, just guarantees tap height. */
    .seed-btn.labeled { width: auto; min-height: var(--tap-min); padding-left: 0.65rem; padding-right: 0.85rem; }

    /* Mobile count/stage row — sits above active-pills, below the controls
       strip. Visible only at this breakpoint since desktop has .header-count.
       (#239) */
    .mobile-count {
      display: block;
      padding: 0.4rem 1rem 0.5rem;
      font-size: 0.78rem;
      color: var(--text-muted, var(--bone-600));
      letter-spacing: 0.01em;
    }

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

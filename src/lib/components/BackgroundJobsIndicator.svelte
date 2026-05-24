<script>
  // Global Ambient Background indicator: a top-right pill + drawer + toasts.
  // See docs/ai-workflow-ux.md §6.
  //
  // Mounted in src/routes/+layout.svelte so it renders on every page. State
  // lives in createJobsClient() in $lib/utils/jobs-store.js; this component
  // is purely presentational + glue.

  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import { afterNavigate, goto } from '$app/navigation';
  import { page } from '$app/state';
  import { failureSentence } from '$lib/errors-registry.js';
  import { createJobsClient, keyFor, onJobsNudge } from '$lib/utils/jobs-store.js';

  /** Workflow → user-facing label. Bare slug → friendly capital. Used in the
   *  drawer rows and toast bodies. Falls back to title-cased workflow.
   *
   *  Multi-instance workflows arrive as '<workflow>:<discriminator>' (e.g.
   *  'deepen-section:stops'); we strip the suffix before lookup so they map
   *  to the bare-workflow label. See src/lib/server/jobs.js header. */
  const WORKFLOW_LABELS = {
    deepen: 'Deepen',
    'deepen-section': 'Deepen section',
    'find-more': 'Find more',
    lock: 'Lock',
    research: 'Research',
  };

  function bareWorkflow(w) {
    return typeof w === 'string' ? w.split(':')[0] : w;
  }

  function labelForWorkflow(w) {
    const bare = bareWorkflow(w);
    return WORKFLOW_LABELS[bare] ?? (bare?.[0]?.toUpperCase() + bare?.slice(1)) ?? bare;
  }

  function fmtElapsed(ms) {
    if (ms < 0) ms = 0;
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
  }

  // Hand-calibrated p50 estimates per workflow. Used purely to compute
  // "estimated remaining" in the drawer row. Conservative — better to
  // undershoot than to make the UI feel late.
  const ESTIMATES_S = {
    deepen: 90,
    'deepen-section': 35,
    'find-more': 30,
    lock: 30,
    research: 60,
  };

  function fmtRemaining(workflow, elapsedMs) {
    // Multi-instance workflows look up by bare workflow ('deepen-section')
    // rather than the discriminator-tagged form ('deepen-section:stops').
    const est = ESTIMATES_S[bareWorkflow(workflow)];
    if (!est) return null;
    const remaining = est * 1000 - elapsedMs;
    if (remaining <= 0) return 'wrapping up…';
    return `~${fmtElapsed(remaining)} left`;
  }

  // ── Reactive mirror of the JS client ───────────────────────────────────────
  // The store itself uses subscribe/notify; we mirror its snapshot into a
  // single `$state` field so Svelte's reactivity picks up downstream computes.

  /** @type {ReturnType<typeof createJobsClient> | null} */
  let client = null;
  let mirror = $state(null);
  let nowTick = $state(Date.now()); // ticks every 1s for elapsed timers

  // Home page has a "Home base" link pinned to the bottom-right of the cards
  // column on desktop — the pill at right: 0.9rem would overlap it. Shift the
  // pill leftward when we're on /. Other pages have no bottom-right chrome
  // conflict, so they keep the default corner anchor.
  const isHomePage = $derived(page.url?.pathname === '/');

  const pillState = $derived(
    mirror
      ? mirror.jobs.length > 0
        ? { variant: 'running', count: mirror.jobs.length }
        : (() => {
            const live = mirror.failures.filter(
              (f) => !mirror.dismissedKeys.has(keyFor(f.workflow, f.slug)),
            );
            return live.length > 0
              ? { variant: 'failed', count: live.length }
              : { variant: 'hidden', count: 0 };
          })()
      : { variant: 'hidden', count: 0 },
  );

  const visibleFailures = $derived(
    mirror
      ? mirror.failures.filter(
          (f) => !mirror.dismissedKeys.has(keyFor(f.workflow, f.slug)),
        )
      : [],
  );

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  onMount(() => {
    if (!browser) return;
    client = createJobsClient({ fetch: window.fetch.bind(window) });
    const unsub = client.subscribe((s) => {
      mirror = s;
    });
    client.start();

    // Prune stale success toasts every second; also drives the elapsed-time
    // ticker in the drawer.
    const tickHandle = setInterval(() => {
      client?.pruneStale();
      nowTick = Date.now();
    }, 1000);

    // Listen for nudges from call sites that just started a background job
    // (e.g. /api/actions/deepen). Skip waiting for the next 10s poll.
    const unsubNudge = onJobsNudge(() => client?.refresh());

    return () => {
      unsub();
      unsubNudge();
      client?.stop();
      clearInterval(tickHandle);
    };
  });

  // Re-poll on every navigation so the indicator is always fresh when the
  // user lands on a new page (e.g. an external link they clicked).
  afterNavigate(() => {
    client?.refresh();
  });

  // ── Handlers ───────────────────────────────────────────────────────────────

  function togglePill() {
    if (!client) return;
    if (pillState.variant === 'running') {
      client.toggleDrawer();
      return;
    }
    if (pillState.variant === 'failed') {
      // Click on the red pill opens the drawer too — it'll be empty of jobs
      // but list the failures. (Keeps the user from being stuck with a red
      // pill they can't act on.)
      client.toggleDrawer();
    }
  }

  function onCancel(workflow, slug) {
    client?.cancel(workflow, slug);
  }

  function onOpenAffected(slug) {
    if (!slug) return;
    goto(`/trips/${slug}`);
  }

  function onDismissFailure(workflow, slug) {
    client?.dismissFailure(keyFor(workflow, slug));
  }

  function onDismissSuccess(workflow, slug) {
    client?.dismissSuccess(keyFor(workflow, slug));
  }
</script>

{#if mirror}
  <!-- Pill + drawer container, top-right, fixed above page chrome. -->
  <div class="indicator-root" class:home-page={isHomePage} aria-live="polite">
    {#if pillState.variant !== 'hidden'}
      <button
        type="button"
        class="pill"
        class:running={pillState.variant === 'running'}
        class:failed={pillState.variant === 'failed'}
        onclick={togglePill}
        aria-label={
          pillState.variant === 'running'
            ? `${pillState.count} background job${pillState.count !== 1 ? 's' : ''} running — open drawer`
            : `${pillState.count} background job${pillState.count !== 1 ? 's' : ''} failed — open drawer`
        }
        aria-expanded={mirror.drawerOpen}
      >
        <span class="dot" aria-hidden="true"></span>
        <span class="pill-text">
          {#if pillState.variant === 'running'}
            {pillState.count} running
          {:else}
            {pillState.count} failed
          {/if}
        </span>
      </button>
    {/if}

    {#if mirror.drawerOpen}
      <div
        class="drawer"
        role="dialog"
        aria-modal="false"
        aria-label="Background jobs"
      >
        <header class="drawer-head">
          <span>Background jobs</span>
          <button
            type="button"
            class="drawer-close"
            onclick={() => client?.closeDrawer()}
            aria-label="Close drawer"
          >✕</button>
        </header>

        {#if mirror.jobs.length === 0 && visibleFailures.length === 0}
          <div class="drawer-empty">No background jobs.</div>
        {:else}
          <ul class="job-list">
            {#each mirror.jobs as job (keyFor(job.workflow, job.slug))}
              {@const elapsed = nowTick - job.startedAt}
              {@const remaining = fmtRemaining(job.workflow, elapsed)}
              <li class="job-row running">
                <div class="job-row-main">
                  <div class="job-title">
                    <span class="trip-name">{job.title ?? job.slug}</span>
                    <span class="workflow-name">· {labelForWorkflow(job.workflow)}</span>
                  </div>
                  <div class="job-meta">
                    {fmtElapsed(elapsed)} elapsed
                    {#if remaining}<span class="meta-sep">·</span>{remaining}{/if}
                  </div>
                </div>
                <button
                  type="button"
                  class="job-cancel"
                  onclick={() => onCancel(job.workflow, job.slug)}
                >Cancel</button>
              </li>
            {/each}
            {#each visibleFailures as failure (keyFor(failure.workflow, failure.slug))}
              <li class="job-row failed">
                <div class="job-row-main">
                  <div class="job-title">
                    <span class="trip-name">{failure.title ?? failure.slug}</span>
                    <span class="workflow-name">· {labelForWorkflow(failure.workflow)}</span>
                  </div>
                  <div class="job-meta failure-sentence">
                    {failureSentence(failure.code, failure)}
                  </div>
                </div>
                <div class="job-actions">
                  {#if failure.slug}
                    <button
                      type="button"
                      class="job-secondary"
                      onclick={() => onOpenAffected(failure.slug)}
                    >Open</button>
                  {/if}
                  <button
                    type="button"
                    class="job-cancel"
                    onclick={() => onDismissFailure(failure.workflow, failure.slug)}
                  >Dismiss</button>
                </div>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    {/if}

    <!-- Toasts (success only — failures are rendered into the drawer + pill). -->
    {#if mirror.successes.length > 0}
      <ul class="toast-stack" aria-live="polite">
        {#each mirror.successes as toast (keyFor(toast.workflow, toast.slug))}
          <li class="toast success">
            <span class="toast-icon" aria-hidden="true">✓</span>
            <span class="toast-body">
              <span class="toast-title">
                {labelForWorkflow(toast.workflow)} ready
              </span>
              <span class="toast-sub">
                {toast.title ?? toast.slug}{#if toast.tokens}{` · ${(toast.tokens / 1000).toFixed(1)}k tokens`}{/if}
              </span>
            </span>
            <span class="toast-actions">
              {#if toast.slug}
                <button
                  type="button"
                  class="toast-action"
                  onclick={() => {
                    onOpenAffected(toast.slug);
                    onDismissSuccess(toast.workflow, toast.slug);
                  }}
                >Open</button>
              {/if}
              <button
                type="button"
                class="toast-dismiss"
                onclick={() => onDismissSuccess(toast.workflow, toast.slug)}
                aria-label="Dismiss"
              >✕</button>
            </span>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
{/if}

<style>
  /* Bottom-right so the indicator never collides with page header chrome
     (e.g. the home page's seed/pin buttons in the top-right). `column-reverse`
     keeps the pill anchored at the corner and stacks drawer + toasts upward
     above it. */
  .indicator-root {
    position: fixed;
    bottom: 0.7rem;
    right: 0.9rem;
    z-index: 1100;
    display: flex;
    flex-direction: column-reverse;
    align-items: flex-end;
    gap: 0.5rem;
    pointer-events: none;
  }
  .indicator-root > * { pointer-events: auto; }

  /* Home page only, desktop only: clear the bottom-right "Home base" footer
     link (mobile has the footer in normal document flow, so no overlap). */
  @media (min-width: 769px) {
    .indicator-root.home-page {
      right: 8rem;
    }
  }

  /* When the Field guide palette is open on a phone, both surfaces want
     the bottom edge — the palette is a bottom sheet (`bottom: 0`) and
     the global jobs pill is `bottom: 0.7rem; right: 0.9rem` with a
     higher z-index. Without this rule the pill floats on top of the
     palette's Send button. The :global() wrappers are required because
     `.palette` is scoped to FieldGuidePalette; the body selector also
     has to escape this component's scope. */
  @media (max-width: 640px) {
    :global(body:has(.palette)) .indicator-root {
      display: none;
    }
  }

  /* ── Pill ──────────────────────────────────────────────────────────────── */
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.32rem 0.7rem;
    border-radius: 999px;
    border: 1px solid transparent;
    cursor: pointer;
    font-size: 0.78rem;
    font-weight: 500;
    font-family: var(--font-sans, system-ui);
    box-shadow: 0 4px 10px rgba(0, 0, 0, 0.18);
  }
  .pill.running {
    background: var(--state-warning-surface);
    color: var(--state-warning);
    border-color: var(--state-warning);
  }
  .pill.failed {
    background: var(--state-danger-surface);
    color: var(--state-danger);
    border-color: var(--state-danger);
  }
  .pill .dot {
    width: 8px; height: 8px; border-radius: 50%;
    display: inline-block;
  }
  .pill.running .dot {
    background: var(--state-warning);
    animation: pulse 1.2s ease-in-out infinite;
  }
  .pill.failed .dot {
    background: var(--state-danger);
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50%      { opacity: 0.45; transform: scale(0.85); }
  }

  /* ── Drawer ────────────────────────────────────────────────────────────── */
  .drawer {
    width: min(360px, calc(100vw - 1.8rem));
    background: var(--surface-overlay);
    color: var(--text-primary);
    border-radius: 10px;
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.22);
    overflow: hidden;
    font-family: var(--font-sans, system-ui);
  }
  .drawer-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.65rem 0.85rem;
    background: var(--state-success-surface);
    color: var(--text-primary);
    font-size: 0.82rem;
    font-weight: 500;
  }
  .drawer-close {
    background: none;
    border: none;
    color: inherit;
    font-size: 0.95rem;
    cursor: pointer;
    line-height: 1;
    padding: 0.15rem 0.35rem;
  }
  .drawer-empty {
    padding: 0.95rem 1rem;
    color: var(--text-secondary);
    font-size: 0.82rem;
  }
  .job-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .job-row {
    display: flex;
    align-items: flex-start;
    gap: 0.7rem;
    padding: 0.7rem 0.85rem;
    border-top: 1px solid rgba(0, 0, 0, 0.06);
  }
  .job-row:first-child { border-top: none; }
  .job-row.failed { background: var(--state-danger-surface); }
  .job-row-main { flex: 1; min-width: 0; }
  .job-title {
    font-size: 0.86rem;
    font-weight: 500;
    color: var(--text-primary);
  }
  .workflow-name {
    color: var(--text-secondary);
    font-weight: 400;
  }
  .job-meta {
    margin-top: 0.18rem;
    font-size: 0.74rem;
    color: var(--text-secondary);
  }
  .failure-sentence { color: var(--state-danger); }
  .meta-sep { margin: 0 0.3rem; }
  .job-actions {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .job-cancel, .job-secondary {
    background: none;
    border: 1px solid rgba(0, 0, 0, 0.18);
    border-radius: 4px;
    padding: 0.22rem 0.55rem;
    font-size: 0.72rem;
    color: inherit;
    cursor: pointer;
    font-family: inherit;
  }
  .job-cancel:hover, .job-secondary:hover {
    background: rgba(0, 0, 0, 0.05);
  }

  /* ── Toasts ────────────────────────────────────────────────────────────── */
  .toast-stack {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }
  .toast {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    padding: 0.5rem 0.6rem 0.5rem 0.7rem;
    border-radius: 8px;
    background: var(--surface-overlay);
    color: var(--text-primary);
    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.18);
    font-size: 0.78rem;
    min-width: 220px;
    max-width: min(360px, calc(100vw - 1.8rem));
  }
  /* The success-state icon (and its color) carries the tone signal; no
     side stripe needed and none allowed per the shared design laws. */
  .toast.success { border: 1px solid color-mix(in oklab, var(--state-success) 35%, var(--border-default)); }
  .toast-icon {
    color: var(--state-success);
    font-weight: 600;
  }
  .toast-body {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
  }
  .toast-title { font-weight: 500; }
  .toast-sub {
    color: var(--text-secondary);
    font-size: 0.72rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .toast-actions {
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }
  .toast-action {
    background: none;
    border: 1px solid rgba(0, 0, 0, 0.18);
    border-radius: 4px;
    padding: 0.18rem 0.45rem;
    font-size: 0.72rem;
    cursor: pointer;
    color: inherit;
    font-family: inherit;
  }
  .toast-action:hover { background: rgba(0, 0, 0, 0.05); }
  .toast-dismiss {
    background: none;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 0.9rem;
    line-height: 1;
    padding: 0 0.2rem;
  }
</style>

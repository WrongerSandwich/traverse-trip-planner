<script>
  // TripJobBadge — renders inline "Preparing brochure…" / "Researching…" labels
  // when ≥1 Ambient Background job is running for the given trip.
  //
  // Strategy: the parent (home page or detail page) polls GET /api/jobs on a
  // 10-second interval, filters the full job list for this slug, and passes the
  // filtered subset here as `jobs`. This avoids N independent fetches across N
  // visible cards.
  //
  // Multi-instance workflows (deepen-section, etc.) encode their discriminator
  // in the workflow string, not the slug — so the parent's exact-match filter
  // (filterJobsForSlug in $lib/utils/jobLabels.js) still surfaces every
  // concurrent job for one trip. See src/lib/server/jobs.js header.
  //
  // When the parent passes `oncancel`, the badge becomes a button that toggles
  // a small popover with elapsed/remaining time and a Cancel button per job —
  // the same affordance as the global BackgroundJobsIndicator drawer, scoped
  // to this trip. Without `oncancel` (e.g. the home-page TripCard usage) the
  // badge stays passive: a click-through label.
  //
  // See docs/ai-workflow-ux.md §6.2 and §2.3.

  import { jobLabel } from '$lib/utils/jobLabels.js';

  /**
   * @type {{
   *   jobs?: { workflow: string, slug: string, startedAt: number }[],
   *   oncancel?: ((workflow: string, slug: string) => void) | null,
   * }}
   * `jobs` is pre-filtered to only jobs for this trip's slug — parent filters
   * via filterJobsForSlug(). `oncancel` (when provided) makes the badge
   * interactive and is called after a successful cancel POST so the parent
   * can refresh its jobs poll.
   */
  let { jobs = [], oncancel = null } = $props();

  const interactive = $derived(typeof oncancel === 'function');
  let open = $state(false);
  let nowTick = $state(Date.now());
  let triggerEl = $state(null);
  let panelEl = $state(null);

  // Hand-calibrated p50 estimates per workflow. Mirrored from
  // BackgroundJobsIndicator so the two surfaces agree on "remaining" math.
  const ESTIMATES_S = {
    brochure: 45,
    'brochure-prepare': 45,
    deepen: 90,
    'deepen-section': 35,
  };

  function bareWorkflow(w) {
    return typeof w === 'string' ? w.split(':')[0] : w;
  }

  function fmtElapsed(ms) {
    if (ms < 0) ms = 0;
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
  }

  function fmtRemaining(workflow, elapsedMs) {
    const est = ESTIMATES_S[bareWorkflow(workflow)];
    if (!est) return null;
    const remaining = est * 1000 - elapsedMs;
    if (remaining <= 0) return 'wrapping up…';
    return `~${fmtElapsed(remaining)} left`;
  }

  // Tick once a second while the popover is open so the elapsed timer ticks.
  $effect(() => {
    if (!open || jobs.length === 0) return;
    const t = setInterval(() => { nowTick = Date.now(); }, 1000);
    return () => clearInterval(t);
  });

  // Auto-close when the trip has no more jobs (e.g. after the user cancels
  // the last one and the parent's poll catches up).
  $effect(() => {
    if (jobs.length === 0) open = false;
  });

  // Click-outside + ESC close, only wired when open.
  $effect(() => {
    if (!open) return;
    function onPointer(e) {
      if (triggerEl?.contains(e.target)) return;
      if (panelEl?.contains(e.target)) return;
      open = false;
    }
    function onKey(e) {
      if (e.key === 'Escape') {
        open = false;
        triggerEl?.focus();
      }
    }
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  });

  async function cancelJob(workflow, slug) {
    try {
      await fetch('/api/jobs/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflow, slug }),
      });
    } catch { /* network blip — the next poll reconciles */ }
    oncancel?.(workflow, slug);
  }
</script>

{#if jobs.length > 0}
  {#if interactive}
    <div class="job-badge-wrap">
      <button
        bind:this={triggerEl}
        type="button"
        class="job-badge-stack interactive"
        onclick={() => (open = !open)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${jobs.length} background job${jobs.length === 1 ? '' : 's'} for this trip — ${open ? 'close' : 'open'} details`}
      >
        {#each jobs as job (job.workflow + ':' + job.startedAt)}
          <span class="job-badge">
            <span class="job-dot" aria-hidden="true"></span>
            {jobLabel(job.workflow)}
          </span>
        {/each}
      </button>
      {#if open}
        <div
          bind:this={panelEl}
          class="job-popover"
          role="dialog"
          aria-label="Background jobs running for this trip"
        >
          <header class="popover-head">
            <span>Running jobs</span>
            <button
              type="button"
              class="popover-close"
              onclick={() => (open = false)}
              aria-label="Close"
            >✕</button>
          </header>
          <ul class="popover-list">
            {#each jobs as job (job.workflow + ':' + job.startedAt)}
              {@const elapsed = nowTick - job.startedAt}
              {@const remaining = fmtRemaining(job.workflow, elapsed)}
              <li class="popover-row">
                <div class="popover-row-main">
                  <div class="popover-title">{jobLabel(job.workflow)}</div>
                  <div class="popover-meta">
                    {fmtElapsed(elapsed)} elapsed{#if remaining} · {remaining}{/if}
                  </div>
                </div>
                <button
                  type="button"
                  class="popover-cancel"
                  onclick={() => cancelJob(job.workflow, job.slug)}
                >Cancel</button>
              </li>
            {/each}
          </ul>
        </div>
      {/if}
    </div>
  {:else}
    <div class="job-badge-stack" aria-live="polite" aria-label="Background jobs running for this trip">
      {#each jobs as job (job.workflow + ':' + job.startedAt)}
        <span class="job-badge">
          <span class="job-dot" aria-hidden="true"></span>
          {jobLabel(job.workflow)}
        </span>
      {/each}
    </div>
  {/if}
{/if}

<style>
  .job-badge-wrap {
    position: relative;
    display: inline-flex;
    align-items: center;
  }

  .job-badge-stack {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .job-badge-stack.interactive {
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    font-family: inherit;
  }
  .job-badge-stack.interactive:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
    border-radius: 4px;
  }

  .job-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-family: var(--font-mono);
    font-size: 0.68rem;
    font-weight: 500;
    letter-spacing: 0.04em;
    color: var(--state-warning);
    background: var(--state-warning-surface);
    border: 1px solid var(--state-warning);
    border-radius: 3px;
    padding: 0.18rem 0.5rem;
    white-space: nowrap;
  }

  .job-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
    flex-shrink: 0;
    animation: pulse 1.4s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0.35; }
  }

  /* ── Popover (interactive variant only) ───────────────────────────────── */
  .job-popover {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    min-width: 240px;
    max-width: 320px;
    background: var(--surface-overlay);
    color: var(--text-primary);
    border: 1px solid var(--border-default);
    border-radius: 6px;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.18);
    z-index: 60;
    font-family: var(--font-sans);
  }

  .popover-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.55rem 0.85rem;
    border-bottom: 1px solid var(--border-subtle);
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-tertiary);
  }
  .popover-close {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 0.9rem;
    line-height: 1;
    color: var(--text-tertiary);
    padding: 0.15rem 0.35rem;
    border-radius: 3px;
    transition: background 0.1s, color 0.1s;
  }
  .popover-close:hover {
    background: var(--surface-raised);
    color: var(--text-primary);
  }

  .popover-list {
    list-style: none;
    margin: 0;
    padding: 0.25rem 0;
    display: flex;
    flex-direction: column;
  }
  .popover-row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.5rem 0.85rem;
  }
  .popover-row + .popover-row {
    border-top: 1px solid var(--border-subtle);
  }
  .popover-row-main { flex: 1; min-width: 0; }
  .popover-title {
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--text-primary);
    line-height: 1.3;
  }
  .popover-meta {
    font-family: var(--font-mono);
    font-size: 0.7rem;
    color: var(--text-tertiary);
    margin-top: 0.15rem;
  }
  .popover-cancel {
    background: none;
    border: 1px solid var(--border-default);
    color: var(--text-secondary);
    font-family: var(--font-sans);
    font-size: 0.72rem;
    font-weight: 600;
    padding: 0.3rem 0.6rem;
    border-radius: 3px;
    cursor: pointer;
    transition: background 0.1s, border-color 0.1s, color 0.1s;
  }
  .popover-cancel:hover {
    background: var(--state-danger-surface);
    border-color: var(--state-danger);
    color: var(--state-danger);
  }
</style>

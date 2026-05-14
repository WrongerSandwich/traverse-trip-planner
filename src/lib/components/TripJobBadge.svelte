<script>
  // TripJobBadge — renders inline "Preparing brochure…" / "Researching…" labels
  // when ≥1 Ambient Background job is running for the given trip.
  //
  // Strategy: the parent (home page or detail page) polls GET /api/jobs on a
  // 10-second interval, filters the full job list for this slug, and passes the
  // filtered subset here as `jobs`. This avoids N independent fetches across N
  // visible cards.
  //
  // See docs/ai-workflow-ux.md §6.2 and §2.3.

  import { jobLabel } from '$lib/utils/jobLabels.js';

  /**
   * @type {{ workflow: string, slug: string, startedAt: number }[]}
   * Pre-filtered to only jobs for this trip's slug — parent is responsible
   * for filtering via filterJobsForSlug().
   */
  let { jobs = [] } = $props();
</script>

{#if jobs.length > 0}
  <div class="job-badge-stack" aria-live="polite" aria-label="Background jobs running for this trip">
    {#each jobs as job (job.workflow + ':' + job.startedAt)}
      <span class="job-badge">
        <span class="job-dot" aria-hidden="true"></span>
        {jobLabel(job.workflow)}
      </span>
    {/each}
  </div>
{/if}

<style>
  .job-badge-stack {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .job-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-family: var(--font-mono);
    font-size: 0.68rem;
    font-weight: 500;
    letter-spacing: 0.04em;
    color: var(--amber-700, #b45309);
    background: var(--amber-50, #fffbeb);
    border: 1px solid var(--amber-200, #fde68a);
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
</style>

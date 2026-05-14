// Pure helpers for per-trip job badge rendering.
// Extracted here so they can be unit-tested without a DOM/Svelte environment.
//
// See docs/ai-workflow-ux.md §6.2 (per-trip badge).

/** @type {Record<string, string>} */
const WORKFLOW_LABELS = {
  brochure:      'Preparing brochure…',
  deepen:        'Researching…',
  'deepen-section': 'Deepening stops…',
};

/**
 * Map a workflow type to its human-readable badge label.
 * Falls back to `"{workflow}…"` for unknown types.
 *
 * @param {string} workflow
 * @returns {string}
 */
export function jobLabel(workflow) {
  return WORKFLOW_LABELS[workflow] ?? `${workflow}…`;
}

/**
 * Return the subset of jobs whose slug matches the given trip slug.
 *
 * @param {Array<{workflow: string, slug: string, startedAt: number}>} jobs
 * @param {string} slug
 * @returns {Array<{workflow: string, slug: string, startedAt: number}>}
 */
export function filterJobsForSlug(jobs, slug) {
  return jobs.filter(j => j.slug === slug);
}

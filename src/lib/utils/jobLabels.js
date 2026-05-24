// Pure helpers for per-trip job badge rendering.
// Extracted here so they can be unit-tested without a DOM/Svelte environment.
//
// See docs/ai-workflow-ux.md §6.2 (per-trip badge) and §6.4 (job-key convention).

/** @type {Record<string, string>} */
const WORKFLOW_LABELS = {
  deepen:        'Researching…',
  'deepen-section': 'Deepening stops…',
  'find-more':   'Finding more candidates…',
};

/**
 * Map a workflow type to its human-readable badge label.
 *
 * Multi-instance workflows pass their discriminator in the workflow string as
 * '<workflow>:<discriminator>' (see src/lib/server/jobs.js header). Strip the
 * suffix before lookup so 'deepen-section:stops' resolves to the same label
 * as 'deepen-section'. Falls back to `"{bare-workflow}…"` for unknown types.
 *
 * @param {string} workflow
 * @returns {string}
 */
export function jobLabel(workflow) {
  const bare = typeof workflow === 'string' ? workflow.split(':')[0] : workflow;
  return WORKFLOW_LABELS[bare] ?? `${bare}…`;
}

/**
 * Return the subset of jobs whose slug matches the given trip slug.
 *
 * The slug arg is treated as a clean trip slug. Multi-instance workflows
 * encode their discriminator in the workflow string, not the slug, so an
 * exact-match here surfaces every concurrent job for a trip. See
 * src/lib/server/jobs.js header for the full convention.
 *
 * @param {Array<{workflow: string, slug: string, startedAt: number}>} jobs
 * @param {string} slug
 * @returns {Array<{workflow: string, slug: string, startedAt: number}>}
 */
export function filterJobsForSlug(jobs, slug) {
  return jobs.filter(j => j.slug === slug);
}

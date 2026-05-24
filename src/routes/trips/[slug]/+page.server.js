import { existsSync } from 'fs';
import { join } from 'path';
import { error } from '@sveltejs/kit';
import { enrichTrips, getHome, getTripFiles, isValidSlug, ROOT } from '$lib/server/data.js';
import { readPlan, findDanglingCandidateIds } from '$lib/server/plan.js';
import { readCandidates } from '$lib/server/candidates.js';

export async function load({ params, depends }) {
  depends('app:trip');
  const { slug } = params;
  if (!isValidSlug(slug)) throw error(404);

  const [trips, home] = await Promise.all([enrichTrips(), Promise.resolve(getHome())]);
  const trip = trips.find(t => t._slug === slug);
  if (!trip) throw error(404, `Trip "${slug}" not found`);

  const files = getTripFiles(slug);
  const resolvedStage = files?.stage || trip._stage;
  // Idea-stage trips have no plan.yaml or candidates.yaml — skip the FS probes.
  const hasPlanFiles = resolvedStage === 'planning' || resolvedStage === 'completed';

  const plan = hasPlanFiles ? readPlan(slug) : null;

  // Detect extract-only recovery state: planning trip where the research leg
  // succeeded (overview.md exists) but the extract leg never wrote plan.yaml
  // (or legacy plan.md). The deepen endpoint handles this automatically
  // (skips research, runs only extract), but we surface it with a distinct
  // banner so the user knows the retry is cheap and doesn't need Re-research.
  const planExtractionFailed =
    resolvedStage === 'planning' &&
    existsSync(join(ROOT, 'planning', slug, 'overview.md')) &&
    !existsSync(join(ROOT, 'planning', slug, 'plan.yaml')) &&
    !existsSync(join(ROOT, 'planning', slug, 'plan.md'));

  return {
    trip,
    home,
    files: files?.files || {},
    stage: resolvedStage,
    plan,
    candidates: hasPlanFiles ? readCandidates(slug) : null,
    dangling: hasPlanFiles ? findDanglingCandidateIds(slug) : [],
    planExtractionFailed,
    extractRenames: Array.isArray(trip.last_extract_renames) ? trip.last_extract_renames : [],
  };
}

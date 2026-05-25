import { error } from '@sveltejs/kit';
import { enrichTrips, getHome, getTripFiles, isValidSlug } from '$lib/server/data.js';
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

  // Note: the prior `planExtractionFailed` flag and its companion
  // "extract-recovery-banner" UI were retired alongside the deepen+extract
  // consolidation (issue #380). The unified envelope means there's no
  // mid-pipeline "Leg 1 succeeded, Leg 2 failed" state to recover from — a
  // failed deepen leaves no half-written planning folder, and re-running it
  // is the only recovery path.

  return {
    trip,
    home,
    files: files?.files || {},
    stage: resolvedStage,
    plan,
    candidates: hasPlanFiles ? readCandidates(slug) : null,
    dangling: hasPlanFiles ? findDanglingCandidateIds(slug) : [],
    extractRenames: Array.isArray(trip.last_extract_renames) ? trip.last_extract_renames : [],
  };
}

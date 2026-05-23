import { error } from '@sveltejs/kit';
import { enrichTrips, getHome, getTripFiles, isValidSlug } from '$lib/server/data.js';
import { readPlan, findDanglingCandidateIds } from '$lib/server/plan.js';
import { readCandidates } from '$lib/server/candidates.js';

export async function load({ params }) {
  const { slug } = params;
  if (!isValidSlug(slug)) throw error(404);

  const [trips, home] = await Promise.all([enrichTrips(), Promise.resolve(getHome())]);
  const trip = trips.find(t => t._slug === slug);
  if (!trip) throw error(404, `Trip "${slug}" not found`);

  const files = getTripFiles(slug);
  const resolvedStage = files?.stage || trip._stage;

  return {
    trip,
    home,
    files: files?.files || {},
    stage: resolvedStage,
    plan: readPlan(slug),
    candidates: readCandidates(slug),
    dangling: findDanglingCandidateIds(slug),
  };
}

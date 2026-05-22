import { join } from 'path';
import { error } from '@sveltejs/kit';
import { enrichTrips, getHome, getTripFiles, isBrochureStale, isValidSlug, ROOT } from '$lib/server/data.js';
import { readBrochure } from '$lib/server/brochure.js';
import { readPlan } from '$lib/server/plan.js';
import { readCandidates } from '$lib/server/candidates.js';

export async function load({ params }) {
  const { slug } = params;
  if (!isValidSlug(slug)) throw error(404);

  const [trips, home] = await Promise.all([enrichTrips(), Promise.resolve(getHome())]);
  const trip = trips.find(t => t._slug === slug);
  if (!trip) throw error(404, `Trip "${slug}" not found`);

  const files = getTripFiles(slug);
  const resolvedStage = files?.stage || trip._stage;

  // Compute staleness for planning/completed trips that have generated artifacts.
  let brochureStale = false;
  if (resolvedStage === 'planning' || resolvedStage === 'completed') {
    const tripDir = join(ROOT, resolvedStage, slug);
    brochureStale = isBrochureStale(tripDir);
  }

  // Load brochure structured data so the detail page can render brochure.days
  // in the itinerary slot when available. Returns null when brochure.md is
  // absent or the YAML is invalid — the legacy itinerary.md fallback handles
  // both cases gracefully.
  let brochureData = null;
  try {
    const parsed = readBrochure(slug);
    brochureData = parsed?.data ?? null;
  } catch {
    // Malformed brochure.md — fall through to itinerary.md legacy rendering.
  }

  return {
    trip,
    home,
    files: files?.files || {},
    stage: resolvedStage,
    brochureStale,
    brochureData,
    plan: readPlan(slug),
    candidates: readCandidates(slug),
  };
}

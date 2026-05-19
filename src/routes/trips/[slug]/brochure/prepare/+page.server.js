import { join } from 'path';
import { error } from '@sveltejs/kit';
import { enrichTrips, isBrochureStale, isValidSlug, ROOT } from '$lib/server/data.js';
import { readBrochure } from '$lib/server/brochure.js';

export async function load({ params }) {
  const { slug } = params;
  if (!isValidSlug(slug)) throw error(404);

  const trips = await enrichTrips();
  const trip = trips.find(t => t._slug === slug);
  if (!trip) throw error(404, `Trip "${slug}" not found`);

  // Existing brochure.md is the basis for the review form. When absent,
  // the page renders a "Generate proposal" CTA instead.
  let brochureData = null;
  try {
    const b = readBrochure(slug);
    if (b) brochureData = b.data;
  } catch (err) {
    console.warn(`brochure.md present but unreadable for ${slug}:`, err.message);
  }

  // Surface staleness so the prepare form can warn when sections were edited
  // after the brochure was last prepared.
  const stage = trip._stage;
  let brochureStale = false;
  if (stage === 'planning' || stage === 'completed') {
    brochureStale = isBrochureStale(join(ROOT, stage, slug));
  }

  return { trip, brochureData, brochureStale };
}

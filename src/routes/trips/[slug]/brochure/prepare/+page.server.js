import { error } from '@sveltejs/kit';
import { enrichTrips } from '$lib/server/data.js';
import { readBrochure } from '$lib/server/brochure.js';

export async function load({ params }) {
  const { slug } = params;

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

  return { trip, brochureData };
}

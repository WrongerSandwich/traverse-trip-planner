import { error } from '@sveltejs/kit';
import { enrichTrips, getTripFiles } from '$lib/server/data.js';
import { verifyShareToken, shareEnabled, projectTripForShare } from '$lib/server/share.js';
import { brochurePath } from '$lib/server/brochure.js';
import { existsSync } from 'fs';

export async function load({ params }) {
  if (!shareEnabled()) throw error(404, 'Sharing not configured');

  const slug = verifyShareToken(params.token);
  if (!slug) throw error(404, 'Invalid share link');

  const trips = await enrichTrips();
  const trip = trips.find(t => t._slug === slug);
  if (!trip) throw error(404, 'Trip not found');
  if (trip.shared !== 'true') throw error(404, 'Trip not shared');

  const files = getTripFiles(slug);
  const bPath = brochurePath(slug);
  const hasBrochure = !!(bPath && existsSync(bPath));
  return {
    trip: projectTripForShare(trip),
    files: files?.files || {},
    stage: files?.stage || trip._stage,
    hasBrochure,
  };
}

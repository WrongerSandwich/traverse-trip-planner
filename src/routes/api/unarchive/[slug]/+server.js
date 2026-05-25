import { json } from '@sveltejs/kit';
import { existsSync, mkdirSync, renameSync } from 'fs';
import { join } from 'path';
import { ROOT, findArchivedTripLocation, invalidateEnrichCache, rejectInvalidSlug } from '$lib/server/data.js';

export function POST({ params }) {
  const invalid = rejectInvalidSlug(params.slug);
  if (invalid) return invalid;
  const { slug } = params;

  const trip = findArchivedTripLocation(slug);
  if (!trip) return new Response('Not in archive', { status: 404 });

  const destDir = join(ROOT, trip.stage);
  const dest = trip.kind === 'file'
    ? join(destDir, `${slug}.md`)
    : join(destDir, slug);

  if (existsSync(dest)) return new Response('Already exists', { status: 409 });

  try {
    mkdirSync(destDir, { recursive: true });
    renameSync(trip.path, dest);
  } catch (err) {
    return new Response(`Failed to unarchive trip: ${err.message}`, { status: 500 });
  }

  invalidateEnrichCache();
  return json({ ok: true, slug, toStage: trip.stage });
}

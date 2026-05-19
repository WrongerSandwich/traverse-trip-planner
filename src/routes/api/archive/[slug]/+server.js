import { json } from '@sveltejs/kit';
import { existsSync, mkdirSync, renameSync } from 'fs';
import { join } from 'path';
import { ROOT, findTripLocation, invalidateEnrichCache, rejectInvalidSlug } from '$lib/server/data.js';

export function POST({ params }) {
  const invalid = rejectInvalidSlug(params.slug);
  if (invalid) return invalid;
  const { slug } = params;
  const trip = findTripLocation(slug);
  if (!trip) return new Response('Trip not found', { status: 404 });

  // Mirror the source stage under archived/ so an unarchive could restore it later.
  const archiveStageDir = join(ROOT, 'archived', trip.stage);
  mkdirSync(archiveStageDir, { recursive: true });

  const dest = trip.kind === 'file'
    ? join(archiveStageDir, `${slug}.md`)
    : join(archiveStageDir, slug);

  if (existsSync(dest)) return new Response('Already archived', { status: 409 });

  try {
    renameSync(trip.path, dest);
  } catch (err) {
    return new Response(`Failed to archive trip: ${err.message}`, { status: 500 });
  }

  invalidateEnrichCache();

  // TODO: ideas are single .md files while multi-stage trips are directories,
  // so archive can't reuse moveTrip() from data.js without teaching it about
  // the file/dir distinction. Extend moveTrip() if unarchive support is added.
  return json({ ok: true, slug, fromStage: trip.stage });
}

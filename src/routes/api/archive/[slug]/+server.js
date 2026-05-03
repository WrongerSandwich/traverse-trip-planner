import { json } from '@sveltejs/kit';
import { existsSync, mkdirSync, renameSync, statSync } from 'fs';
import { join } from 'path';
import { ROOT } from '$lib/server/data.js';

// Find the trip's current location across all live stages.
// Ideas live as single .md files; later stages are folders with overview.md.
function findTrip(slug) {
  const ideaPath = join(ROOT, 'ideas', `${slug}.md`);
  if (existsSync(ideaPath)) return { kind: 'file', path: ideaPath, stage: 'ideas' };
  for (const stage of ['exploring', 'planning', 'completed']) {
    const dir = join(ROOT, stage, slug);
    if (existsSync(dir) && statSync(dir).isDirectory()) {
      return { kind: 'dir', path: dir, stage };
    }
  }
  return null;
}

export function POST({ params }) {
  const { slug } = params;
  const trip = findTrip(slug);
  if (!trip) return new Response('Trip not found', { status: 404 });

  // Mirror the source stage under archived/ so an unarchive could restore it later.
  const archiveStageDir = join(ROOT, 'archived', trip.stage);
  mkdirSync(archiveStageDir, { recursive: true });

  const dest = trip.kind === 'file'
    ? join(archiveStageDir, `${slug}.md`)
    : join(archiveStageDir, slug);

  if (existsSync(dest)) return new Response('Already archived', { status: 409 });

  renameSync(trip.path, dest);
  return json({ ok: true, slug, fromStage: trip.stage });
}

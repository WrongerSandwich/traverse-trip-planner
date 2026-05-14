// GET /api/jobs — snapshot of in-flight Ambient Background jobs.
//
// Consumed by the global pill + jobs drawer (BackgroundJobsIndicator) and the
// per-trip badge (TripJobBadge). Reads only the in-memory map — for survival
// across restart, see the sweep wired into src/hooks.server.js.

import { json } from '@sveltejs/kit';
import { listJobs } from '$lib/server/jobs.js';

export function GET() {
  return json({ jobs: listJobs() });
}

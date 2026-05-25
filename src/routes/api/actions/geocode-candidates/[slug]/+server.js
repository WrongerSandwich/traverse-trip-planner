// Ambient Background: geocode-candidates follow-on job (issue #382).
//
// This endpoint exists so the deepen handler can fire-and-forget the
// geocoding loop and have it appear as its own pill in the indicator. It
// has no user-triggerable POST surface — the only caller is the deepen
// handler, which invokes _startGeocodeCandidatesJob() right after
// realizePlan() returns.
//
// DELETE is a thin shim that calls cancelJob('geocode-candidates', slug).
// The job's loop checks signal.aborted at the top of each iteration so
// cancellation is clean — no half-written candidates.yaml.

import { rejectInvalidSlug } from '$lib/server/data.js';
import {
  assertNotRunning,
  startJob,
  completeJob,
  failJob,
  cancelJob,
} from '$lib/server/jobs.js';
import { geocodeCandidatesJob } from '$lib/server/geocode-job.js';
import { TraverseError } from '$lib/server/errors.js';
import { HAND_DEFAULTS } from '$lib/server/promises.js';
import { isAbort } from '$lib/utils/abort.js';

export const _promise = HAND_DEFAULTS['geocode-candidates'];

/**
 * Fire-and-forget kickoff of the geocode-candidates job for `slug`. Returns
 * the job handle from startJob() (or null if a job is already running for
 * this slug — the caller should treat that as a no-op, not an error). The
 * deepen handler invokes this immediately after realizePlan() returns.
 *
 * @param {string} slug
 * @returns {ReturnType<typeof startJob> | null}
 */
export function _startGeocodeCandidatesJob(slug) {
  try {
    assertNotRunning('geocode-candidates', slug);
  } catch (err) {
    if (err instanceof TraverseError && err.code === 'already_running') {
      return null;
    }
    throw err;
  }

  const job = startJob('geocode-candidates', slug, { est_seconds: _promise.time_seconds });

  (async () => {
    try {
      await geocodeCandidatesJob(slug, { signal: job.controller.signal });
      try {
        completeJob('geocode-candidates', slug);
      } catch (e) {
        console.error(`[geocode-candidates] ${slug}: completeJob threw after success:`, e?.message ?? e);
      }
    } catch (err) {
      if (isAbort(err)) return; // cancelJob owns the failure event
      const code = err instanceof TraverseError ? err.code : 'unknown';
      console.error(`[geocode-candidates] ${slug}: failed (${code}):`, err?.message ?? err);
      const publicMessage = err instanceof TraverseError ? err.message : 'Geocoding failed — try again.';
      try {
        failJob('geocode-candidates', slug, { code, message: publicMessage });
      } catch (e) {
        console.error(`[geocode-candidates] ${slug}: failJob threw after failure:`, e?.message ?? e);
      }
    }
  })();

  return job;
}

export async function DELETE({ params }) {
  const invalid = rejectInvalidSlug(params.slug);
  if (invalid) return invalid;
  cancelJob('geocode-candidates', params.slug);
  return new Response(null, { status: 200 });
}

// Ambient Background: stop-prep follow-on job.
//
// Two entry points:
//   - User-triggered POST  → generate per-stop tips + todos for candidate stops.
//   - Enrich-candidates job's auto-trigger via _startStopPrepJob(slug) (wired here).
//
// POST body: optional { force?: boolean }. When force is true, the job
// re-preps every visible stop instead of skipping ones with tips already set.
//
// DELETE cancels the in-flight job via cancelJob('stop-prep', slug).

import { json } from '@sveltejs/kit';
import { rejectInvalidSlug } from '$lib/server/data.js';
import {
  assertNotRunning,
  startJob,
  completeJob,
  failJob,
  cancelJob,
} from '$lib/server/jobs.js';
import { stopPrepJob } from '$lib/server/stop-prep-job.js';
import { TraverseError } from '$lib/server/errors.js';
import { HAND_DEFAULTS } from '$lib/server/promises.js';
import { isAbort } from '$lib/utils/abort.js';
import { rateLimitResponse } from '$lib/server/rate-limit.js';
import { getFeatureAvailability } from '$lib/server/config.js';

export const _promise = HAND_DEFAULTS['stop-prep'];

/**
 * Fire-and-forget kickoff of the stop-prep job for `slug`. Returns
 * the job handle from startJob() (or null if a job is already running for
 * this slug — the caller should treat that as a no-op, not an error). The
 * enrich-candidates handler invokes this automatically after enrichment completes.
 *
 * @param {string} slug
 * @param {{ force?: boolean }} [opts]
 * @returns {ReturnType<typeof startJob> | null}
 */
export function _startStopPrepJob(slug, opts = {}) {
  try {
    assertNotRunning('stop-prep', slug);
  } catch (err) {
    if (err instanceof TraverseError && err.code === 'already_running') {
      return null;
    }
    throw err;
  }

  const job = startJob('stop-prep', slug, { est_seconds: _promise.time_seconds });

  (async () => {
    try {
      const result = await stopPrepJob(slug, {
        signal: job.controller.signal,
        force: opts.force === true,
      });
      try {
        completeJob('stop-prep', slug, { tokens: result?.tokens ?? 0 });
      } catch (e) {
        console.error(`[stop-prep] ${slug}: completeJob threw after success:`, e?.message ?? e);
      }
    } catch (err) {
      if (isAbort(err)) return; // cancelJob owns the failure event
      const code = err instanceof TraverseError ? err.code : 'unknown';
      console.error(`[stop-prep] ${slug}: failed (${code}):`, err?.message ?? err);
      const publicMessage = err instanceof TraverseError ? err.message : 'Stop prep failed — try again.';
      try {
        failJob('stop-prep', slug, { code, message: publicMessage });
      } catch (e) {
        console.error(`[stop-prep] ${slug}: failJob threw after failure:`, e?.message ?? e);
      }
    }
  })();

  return job;
}

export async function POST(event) {
  if (!getFeatureAvailability().homeMdReady) {
    return json({ ok: false, code: 'home_not_configured' }, { status: 412 });
  }

  const invalid = rejectInvalidSlug(event.params.slug);
  if (invalid) return invalid;
  const { slug } = event.params;

  const limited = rateLimitResponse({ event, endpoint: 'stop-prep', slugKey: slug });
  if (limited) return limited;

  // Block while upstream jobs in the chain are still running on this trip.
  for (const blocker of ['deepen', 'geocode-candidates', 'enrich-candidates', 'stop-prep']) {
    try {
      assertNotRunning(blocker, slug);
    } catch (e) {
      if (e instanceof TraverseError && e.code === 'already_running') {
        return json({ ok: false, code: 'already_running' }, { status: 409 });
      }
      throw e;
    }
  }

  let body = {};
  try { body = await event.request.json(); } catch { /* empty body is fine */ }

  const job = _startStopPrepJob(slug, { force: body.force === true });
  if (!job) {
    // Shouldn't reach here (loop above guards it), but be safe.
    return json({ ok: false, code: 'already_running' }, { status: 409 });
  }

  return json({
    ok: true,
    workflow: 'stop-prep',
    slug,
    est_seconds: _promise.time_seconds,
  }, { status: 202 });
}

export async function DELETE({ params }) {
  const invalid = rejectInvalidSlug(params.slug);
  if (invalid) return invalid;
  cancelJob('stop-prep', params.slug);
  return new Response(null, { status: 200 });
}

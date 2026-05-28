// Ambient Background: enrich-candidates follow-on job (#403).
//
// Two entry points:
//   - User-triggered POST  → fill hours/website/phone gaps in candidates.yaml
//   - Geocode-job's auto-trigger via _startEnrichCandidatesJob(slug) (wired in Task 9)
//
// POST body: optional { force?: boolean }. When force is true, the job
// re-runs every visible stop instead of skipping ones with all three
// fields already set.
//
// DELETE cancels the in-flight job via cancelJob('enrich-candidates', slug).

import { json } from '@sveltejs/kit';
import { rejectInvalidSlug } from '$lib/server/data.js';
import {
  assertNotRunning,
  startJob,
  completeJob,
  failJob,
  cancelJob,
} from '$lib/server/jobs.js';
import { enrichCandidatesJob } from '$lib/server/enrich-job.js';
import { TraverseError } from '$lib/server/errors.js';
import { HAND_DEFAULTS } from '$lib/server/promises.js';
import { isAbort } from '$lib/utils/abort.js';
import { rateLimitResponse } from '$lib/server/rate-limit.js';
import { getFeatureAvailability } from '$lib/server/config.js';

export const _promise = HAND_DEFAULTS['enrich-candidates'];

/**
 * Fire-and-forget kickoff of the enrich-candidates job for `slug`. Returns
 * the job handle from startJob() (or null if a job is already running for
 * this slug — the caller should treat that as a no-op, not an error). The
 * geocode handler invokes this automatically after geocoding completes (Task 9).
 *
 * @param {string} slug
 * @param {{ force?: boolean }} [opts]
 * @returns {ReturnType<typeof startJob> | null}
 */
export function _startEnrichCandidatesJob(slug, opts = {}) {
  try {
    assertNotRunning('enrich-candidates', slug);
  } catch (err) {
    if (err instanceof TraverseError && err.code === 'already_running') {
      return null;
    }
    throw err;
  }

  const job = startJob('enrich-candidates', slug, { est_seconds: _promise.time_seconds });

  (async () => {
    try {
      const result = await enrichCandidatesJob(slug, {
        signal: job.controller.signal,
        force: opts.force === true,
      });
      try {
        completeJob('enrich-candidates', slug, { tokens: result?.tokens ?? 0 });
      } catch (e) {
        console.error(`[enrich-candidates] ${slug}: completeJob threw after success:`, e?.message ?? e);
      }
    } catch (err) {
      if (isAbort(err)) return; // cancelJob owns the failure event
      const code = err instanceof TraverseError ? err.code : 'unknown';
      console.error(`[enrich-candidates] ${slug}: failed (${code}):`, err?.message ?? err);
      const publicMessage = err instanceof TraverseError ? err.message : 'Enrichment failed — try again.';
      try {
        failJob('enrich-candidates', slug, { code, message: publicMessage });
      } catch (e) {
        console.error(`[enrich-candidates] ${slug}: failJob threw after failure:`, e?.message ?? e);
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

  const limited = rateLimitResponse({ event, endpoint: 'enrich-candidates', slugKey: slug });
  if (limited) return limited;

  // Block while deepen or geocode-candidates is still running on this trip.
  for (const blocker of ['deepen', 'geocode-candidates', 'enrich-candidates']) {
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

  const job = _startEnrichCandidatesJob(slug, { force: body.force === true });
  if (!job) {
    // Shouldn't reach here (loop above guards it), but be safe.
    return json({ ok: false, code: 'already_running' }, { status: 409 });
  }

  return json({
    ok: true,
    workflow: 'enrich-candidates',
    slug,
    est_seconds: _promise.time_seconds,
  }, { status: 202 });
}

export async function DELETE({ params }) {
  const invalid = rejectInvalidSlug(params.slug);
  if (invalid) return invalid;
  cancelJob('enrich-candidates', params.slug);
  return new Response(null, { status: 200 });
}

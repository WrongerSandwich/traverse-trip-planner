// Ambient Background workflow: Brochure prepare.
//
// Contract (docs/ai-workflow-ux.md §2.3, §6):
// - assertNotRunning('brochure', slug) → 409 Conflict if a job is already
//   in flight for this trip + workflow.
// - startJob('brochure', slug) registers the in-flight entry and writes
//   `running: 'brochure'` to the trip's frontmatter (per-trip badge picks
//   this up automatically).
// - POST returns 202 Accepted immediately. The user is free to navigate
//   away — the global indicator surfaces progress, success toast, and
//   failure toast.
// - The background worker forwards the registry's AbortController.signal
//   into prepareBrochure() so /api/jobs/cancel can interrupt the model
//   call. On AbortError we don't double-record the failure (cancelJob
//   already did that).
// - On success: completeJob('brochure', slug, { tokens }) with the actual
//   token count. The brochure draft is written to disk by prepareBrochure
//   at planning/<slug>/brochure.md — the existing review form reads from
//   that same path, so no separate review URL is needed.

import { json } from '@sveltejs/kit';
import { prepareBrochure } from '$lib/server/brochure.js';
import { assertNotRunning, startJob, completeJob, failJob } from '$lib/server/jobs.js';
import { TraverseError } from '$lib/server/errors.js';
import { rejectInvalidSlug } from '$lib/server/data.js';
import { HAND_DEFAULTS } from '$lib/server/promises.js';
import { rateLimitResponse } from '$lib/server/rate-limit.js';
import { isAbort } from '$lib/utils/abort.js';
import { usageToTokens } from '$lib/utils/formatTokens.js';

export const _promise = HAND_DEFAULTS['brochure-prepare'];

export async function POST(event) {
  const { params } = event;
  const invalid = rejectInvalidSlug(params.slug);
  if (invalid) return invalid;
  const { slug } = params;

  // Rate-limit before hitting the job registry — a burst across many slugs
  // would bypass the per-slug already_running check and burn AI quota freely.
  const limited = rateLimitResponse({ event, endpoint: 'brochure', slugKey: slug });
  if (limited) return limited;

  // Already running? Fail fast with 409 so the trigger UI can react.
  try {
    assertNotRunning('brochure', slug);
  } catch (err) {
    if (err instanceof TraverseError && err.code === 'already_running') {
      return json({ code: 'already_running', message: err.message }, { status: 409 });
    }
    throw err;
  }

  // Register the in-flight job. The AbortController signal flows into
  // prepareBrochure → chat(); cancelJob() trips the controller to interrupt
  // mid-run.
  const job = startJob('brochure', slug, { est_seconds: _promise.time_seconds });

  // Fire-and-forget. Use the two-callback form of .then() so that a throw
  // inside completeJob (e.g. disk I/O failure in clearRunningFlag/atomicWrite)
  // routes to the rejection handler rather than producing an unhandled rejection
  // that would kill the server under Node 15+. An AbortError means cancelJob()
  // already wrote the failure event and we must not record a second one.
  prepareBrochure(slug, { signal: job.controller.signal })
    .then(
      (result) => {
        try {
          completeJob('brochure', slug, { tokens: usageToTokens(result?.usage) });
        } catch (e) {
          console.error(`[brochure] ${slug}: completeJob threw after success:`, e?.message ?? e);
        }
      },
      (err) => {
        if (isAbort(err)) return; // cancelJob() owns the failure event
        const code = err instanceof TraverseError ? err.code : 'unknown';
        try {
          failJob('brochure', slug, { code, message: err?.message ?? 'Unknown error' });
        } catch (e) {
          console.error(`[brochure] ${slug}: failJob threw after failure:`, e?.message ?? e);
        }
      },
    );

  return json({ ok: true, workflow: 'brochure', slug }, { status: 202 });
}

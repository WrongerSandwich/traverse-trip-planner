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

export const _promise = {
  verb: 'Prepare brochure',
  produces: 'A structured brochure draft — stops with map pins, lodging, field guide notes, and gotchas — ready to review before saving.',
  time_seconds: 45,
  tokens_range: [2000, 5000],
};

function tokensFromUsage(usage) {
  if (!usage) return 0;
  const input = usage.input_tokens ?? usage.input ?? 0;
  const output = usage.output_tokens ?? usage.output ?? 0;
  return input + output;
}

function isAbort(err) {
  if (!err) return false;
  return err.name === 'AbortError' || err.code === 'ABORT_ERR';
}

export async function POST({ params }) {
  const { slug } = params;

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

  // Fire-and-forget. Errors that aren't AbortError are recorded via failJob;
  // an AbortError means cancelJob() already wrote the failure event and we
  // must not record a second one.
  prepareBrochure(slug, { signal: job.controller.signal })
    .then((result) => {
      completeJob('brochure', slug, { tokens: tokensFromUsage(result?.usage) });
    })
    .catch((err) => {
      if (isAbort(err)) return; // cancelJob() owns the failure event
      const code = err instanceof TraverseError ? err.code : 'unknown';
      failJob('brochure', slug, { code, message: err?.message ?? 'Unknown error' });
    });

  return json({ ok: true, workflow: 'brochure', slug }, { status: 202 });
}

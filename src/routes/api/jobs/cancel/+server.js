// POST /api/jobs/cancel — cancel an in-flight Ambient Background job.
//
// Body: { workflow: string, slug: string }
//
// Idempotent. Returns 200 even when the (workflow, slug) tuple has no live
// entry — the registry's cancelJob() is itself a no-op in that case, and the
// client should be able to dismiss its local optimistic state without worrying
// about a race against the registry actually noticing the cancel.

import { json } from '@sveltejs/kit';
import { cancelJob } from '$lib/server/jobs.js';

export async function POST({ request }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_input' }, { status: 400 });
  }

  const { workflow, slug } = body ?? {};
  if (typeof workflow !== 'string' || !workflow.trim()) {
    return json({ error: 'missing_workflow' }, { status: 400 });
  }
  if (typeof slug !== 'string' || !slug.trim()) {
    return json({ error: 'missing_slug' }, { status: 400 });
  }

  cancelJob(workflow, slug);
  return json({ ok: true });
}

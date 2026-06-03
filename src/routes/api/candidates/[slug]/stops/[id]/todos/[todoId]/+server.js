import { json } from '@sveltejs/kit';
import { setTodoDone } from '$lib/server/candidates.js';
import { invalidateEnrichCache, rejectInvalidSlug } from '$lib/server/data.js';

/**
 * PATCH toggles the `done` flag for a single todo on a stop candidate. Body shape:
 *   { done: boolean }
 * Returns 404 if the stop or todo id doesn't match; 200 with the updated
 * candidate stop on success.
 */
export async function PATCH({ params, request }) {
  const invalid = rejectInvalidSlug(params.slug);
  if (invalid) return invalid;
  let body;
  try { body = await request.json(); } catch { body = {}; }
  if (typeof body?.done !== 'boolean') {
    return json({ error: 'Body must be { done: boolean }' }, { status: 400 });
  }
  try {
    const updated = setTodoDone(params.slug, params.id, params.todoId, body.done);
    if (!updated) return json({ error: 'Candidate not found' }, { status: 404 });
    invalidateEnrichCache();
    return json({ ok: true, candidate: updated });
  } catch (err) {
    return json({ error: String(err.message ?? err) }, { status: 400 });
  }
}

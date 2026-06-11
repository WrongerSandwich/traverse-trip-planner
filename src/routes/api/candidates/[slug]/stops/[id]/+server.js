import { json } from '@sveltejs/kit';
import { deleteCandidateStop, setCandidateHidden } from '$lib/server/candidates.js';
import { invalidateEnrichCache, rejectInvalidSlug, rejectInvalidId } from '$lib/server/data.js';

export async function DELETE({ params }) {
  const invalid = rejectInvalidSlug(params.slug);
  if (invalid) return invalid;
  const invalidId = rejectInvalidId(params.id);
  if (invalidId) return invalidId;
  try {
    deleteCandidateStop(params.slug, params.id);
    invalidateEnrichCache();
    return json({ ok: true });
  } catch (err) {
    return json({ error: String(err.message ?? err) }, { status: 400 });
  }
}

/**
 * PATCH toggles the `hidden` flag for a stop candidate. Body shape:
 *   { hidden: boolean }
 * Returns 404 if the id doesn't match any stop; 200 with the updated
 * candidate on success. Hiding a promoted candidate also un-promotes it
 * (see setCandidateHidden in candidates.js).
 */
export async function PATCH({ params, request }) {
  const invalid = rejectInvalidSlug(params.slug);
  if (invalid) return invalid;
  const invalidId = rejectInvalidId(params.id);
  if (invalidId) return invalidId;
  let body;
  try { body = await request.json(); } catch { body = {}; }
  if (typeof body?.hidden !== 'boolean') {
    return json({ error: 'Body must be { hidden: boolean }' }, { status: 400 });
  }
  try {
    const updated = setCandidateHidden(params.slug, params.id, body.hidden);
    if (!updated) return json({ error: 'Candidate not found' }, { status: 404 });
    invalidateEnrichCache();
    return json({ ok: true, candidate: updated });
  } catch (err) {
    return json({ error: String(err.message ?? err) }, { status: 400 });
  }
}

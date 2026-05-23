import { json } from '@sveltejs/kit';
import { deleteCandidateStop } from '$lib/server/candidates.js';
import { invalidateEnrichCache, rejectInvalidSlug } from '$lib/server/data.js';

export async function DELETE({ params }) {
  const invalid = rejectInvalidSlug(params.slug);
  if (invalid) return invalid;
  try {
    deleteCandidateStop(params.slug, params.id);
    invalidateEnrichCache();
    return json({ ok: true });
  } catch (err) {
    return json({ error: String(err.message ?? err) }, { status: 400 });
  }
}

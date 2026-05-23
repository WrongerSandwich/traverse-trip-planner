import { json } from '@sveltejs/kit';
import { addCandidateLodging } from '$lib/server/candidates.js';
import { invalidateEnrichCache, rejectInvalidSlug } from '$lib/server/data.js';

export async function POST({ params, request }) {
  const invalid = rejectInvalidSlug(params.slug);
  if (invalid) return invalid;
  const body = await request.json().catch(() => ({}));
  if (!body?.name) return json({ error: 'name required' }, { status: 400 });
  try {
    const id = addCandidateLodging(params.slug, body);
    invalidateEnrichCache();
    return json({ id, ok: true });
  } catch (err) {
    return json({ error: String(err.message ?? err) }, { status: 400 });
  }
}

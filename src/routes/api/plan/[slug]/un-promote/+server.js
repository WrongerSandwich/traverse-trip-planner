import { json } from '@sveltejs/kit';
import { unPromoteCandidate } from '$lib/server/plan.js';
import { invalidateEnrichCache } from '$lib/server/data.js';

export async function POST({ params, request }) {
  const body = await request.json().catch(() => ({}));
  if (!body?.id) return json({ error: 'id required' }, { status: 400 });
  try {
    unPromoteCandidate(params.slug, body.id);
    invalidateEnrichCache();
    return json({ ok: true });
  } catch (err) {
    return json({ error: String(err.message ?? err) }, { status: 400 });
  }
}

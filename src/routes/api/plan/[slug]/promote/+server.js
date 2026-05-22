import { json } from '@sveltejs/kit';
import { promoteCandidateToDay } from '$lib/server/plan.js';
import { invalidateEnrichCache } from '$lib/server/data.js';

export async function POST({ params, request }) {
  const body = await request.json().catch(() => ({}));
  if (!body?.id) return json({ error: 'id required' }, { status: 400 });
  try {
    // day is nullable: null/undefined → creates/uses day 1.
    const day = body.day == null ? null : Number(body.day);
    promoteCandidateToDay(params.slug, body.id, day);
    invalidateEnrichCache();
    return json({ ok: true });
  } catch (err) {
    return json({ error: String(err.message ?? err) }, { status: 400 });
  }
}

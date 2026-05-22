import { json } from '@sveltejs/kit';
import { removeStopFromDay, moveStopToDay } from '$lib/server/plan.js';
import { invalidateEnrichCache } from '$lib/server/data.js';

export async function DELETE({ params }) {
  try {
    removeStopFromDay(params.slug, Number(params.number), params.id);
    invalidateEnrichCache();
    return json({ ok: true });
  } catch (err) {
    return json({ error: String(err.message ?? err) }, { status: 400 });
  }
}

export async function PATCH({ params, request }) {
  const body = await request.json().catch(() => ({}));
  if (body?.toDay == null) return json({ error: 'toDay required' }, { status: 400 });
  try {
    moveStopToDay(params.slug, Number(params.number), Number(body.toDay), params.id);
    invalidateEnrichCache();
    return json({ ok: true });
  } catch (err) {
    return json({ error: String(err.message ?? err) }, { status: 400 });
  }
}

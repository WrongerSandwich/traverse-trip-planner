import { json } from '@sveltejs/kit';
import { removeDay, setDayMetadata } from '$lib/server/plan.js';
import { invalidateEnrichCache } from '$lib/server/data.js';

export async function DELETE({ params }) {
  try {
    removeDay(params.slug, Number(params.number));
    invalidateEnrichCache();
    return json({ ok: true });
  } catch (err) {
    return json({ error: String(err.message ?? err) }, { status: 400 });
  }
}

export async function PATCH({ params, request }) {
  const body = await request.json().catch(() => ({}));
  try {
    setDayMetadata(params.slug, Number(params.number), body);
    invalidateEnrichCache();
    return json({ ok: true });
  } catch (err) {
    return json({ error: String(err.message ?? err) }, { status: 400 });
  }
}

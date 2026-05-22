import { json } from '@sveltejs/kit';
import { setLodgingForDay } from '$lib/server/plan.js';
import { invalidateEnrichCache, rejectInvalidSlug } from '$lib/server/data.js';

export async function PUT({ params, request }) {
  const invalid = rejectInvalidSlug(params.slug);
  if (invalid) return invalid;
  const body = await request.json().catch(() => ({}));
  // body.id may be null to clear; absence is treated as invalid.
  if (!('id' in (body ?? {}))) return json({ error: 'id required (null clears)' }, { status: 400 });
  try {
    setLodgingForDay(params.slug, Number(params.number), body.id);
    invalidateEnrichCache();
    return json({ ok: true });
  } catch (err) {
    return json({ error: String(err.message ?? err) }, { status: 400 });
  }
}

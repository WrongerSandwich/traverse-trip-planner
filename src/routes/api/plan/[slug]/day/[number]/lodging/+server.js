import { json } from '@sveltejs/kit';
import { setLodgingForDay } from '$lib/server/plan.js';
import { invalidateEnrichCache, rejectInvalidSlug } from '$lib/server/data.js';

function parseDayNumber(raw) {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

export async function PUT({ params, request }) {
  const invalid = rejectInvalidSlug(params.slug);
  if (invalid) return invalid;
  const dayNumber = parseDayNumber(params.number);
  if (dayNumber === null) return json({ error: 'invalid day number' }, { status: 400 });
  const body = await request.json().catch(() => ({}));
  // body.id may be null to clear; absence is treated as invalid.
  if (!('id' in (body ?? {}))) return json({ error: 'id required (null clears)' }, { status: 400 });
  try {
    setLodgingForDay(params.slug, dayNumber, body.id);
    invalidateEnrichCache();
    return json({ ok: true });
  } catch (err) {
    return json({ error: String(err.message ?? err) }, { status: 400 });
  }
}

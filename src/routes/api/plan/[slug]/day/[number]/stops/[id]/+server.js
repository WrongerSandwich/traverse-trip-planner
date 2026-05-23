import { json } from '@sveltejs/kit';
import { removeStopFromDay, moveStopToDay } from '$lib/server/plan.js';
import { invalidateEnrichCache, rejectInvalidSlug } from '$lib/server/data.js';

function parseDayNumber(raw) {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

export async function DELETE({ params }) {
  const invalid = rejectInvalidSlug(params.slug);
  if (invalid) return invalid;
  const dayNumber = parseDayNumber(params.number);
  if (dayNumber === null) return json({ error: 'invalid day number' }, { status: 400 });
  try {
    removeStopFromDay(params.slug, dayNumber, params.id);
    invalidateEnrichCache();
    return json({ ok: true });
  } catch (err) {
    return json({ error: String(err.message ?? err) }, { status: 400 });
  }
}

export async function PATCH({ params, request }) {
  const invalid = rejectInvalidSlug(params.slug);
  if (invalid) return invalid;
  const dayNumber = parseDayNumber(params.number);
  if (dayNumber === null) return json({ error: 'invalid day number' }, { status: 400 });
  const body = await request.json().catch(() => ({}));
  if (body?.toDay == null) return json({ error: 'toDay required' }, { status: 400 });
  const toDay = parseDayNumber(body.toDay);
  if (toDay === null) return json({ error: 'invalid day number' }, { status: 400 });
  try {
    moveStopToDay(params.slug, dayNumber, toDay, params.id);
    invalidateEnrichCache();
    return json({ ok: true });
  } catch (err) {
    return json({ error: String(err.message ?? err) }, { status: 400 });
  }
}

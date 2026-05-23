import { json } from '@sveltejs/kit';
import { addStopToDay, reorderStops } from '$lib/server/plan.js';
import { invalidateEnrichCache, rejectInvalidSlug } from '$lib/server/data.js';

function parseDayNumber(raw) {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

export async function POST({ params, request }) {
  const invalid = rejectInvalidSlug(params.slug);
  if (invalid) return invalid;
  const dayNumber = parseDayNumber(params.number);
  if (dayNumber === null) return json({ error: 'invalid day number' }, { status: 400 });
  const body = await request.json().catch(() => ({}));
  if (!body?.id) return json({ error: 'id required' }, { status: 400 });
  try {
    addStopToDay(params.slug, dayNumber, body.id);
    invalidateEnrichCache();
    return json({ ok: true });
  } catch (err) {
    return json({ error: String(err.message ?? err) }, { status: 400 });
  }
}

export async function PUT({ params, request }) {
  const invalid = rejectInvalidSlug(params.slug);
  if (invalid) return invalid;
  const dayNumber = parseDayNumber(params.number);
  if (dayNumber === null) return json({ error: 'invalid day number' }, { status: 400 });
  const body = await request.json().catch(() => ({}));
  if (!Array.isArray(body?.order)) return json({ error: 'order required' }, { status: 400 });
  try {
    reorderStops(params.slug, dayNumber, body.order);
    invalidateEnrichCache();
    return json({ ok: true });
  } catch (err) {
    return json({ error: String(err.message ?? err) }, { status: 400 });
  }
}

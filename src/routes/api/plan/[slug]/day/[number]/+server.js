import { json } from '@sveltejs/kit';
import { removeDay, setDayMetadata } from '$lib/server/plan.js';
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
    removeDay(params.slug, dayNumber);
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
  try {
    setDayMetadata(params.slug, dayNumber, body);
    invalidateEnrichCache();
    return json({ ok: true });
  } catch (err) {
    return json({ error: String(err.message ?? err) }, { status: 400 });
  }
}

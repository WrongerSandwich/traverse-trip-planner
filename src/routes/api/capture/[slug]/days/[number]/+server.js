import { json } from '@sveltejs/kit';
import { setDayLog } from '$lib/server/plan.js';
import { invalidateEnrichCache, rejectInvalidSlug, findTripLocation } from '$lib/server/data.js';

const MAX_NOTE = 2000;

/**
 * PATCH the in-trip note (`log`) for one day. Body: { note: string }
 * Planning stage only.
 */
export async function PATCH({ params, request }) {
  const invalid = rejectInvalidSlug(params.slug);
  if (invalid) return invalid;

  const loc = findTripLocation(params.slug);
  if (!loc || loc.kind !== 'dir') return json({ code: 'trip_not_found' }, { status: 404 });
  if (loc.stage !== 'planning') return json({ code: 'wrong_stage' }, { status: 409 });

  const number = Number(params.number);
  if (!Number.isInteger(number)) {
    return json({ code: 'invalid_input', context: { reason: 'day number must be an integer' } }, { status: 400 });
  }

  let body;
  try { body = await request.json(); } catch { body = {}; }
  const note = body?.note;
  if (note != null && typeof note !== 'string') {
    return json({ code: 'invalid_input', context: { reason: 'note must be a string' } }, { status: 400 });
  }
  if (typeof note === 'string' && note.length > MAX_NOTE) {
    return json({ code: 'invalid_input', context: { reason: `note is too long (max ${MAX_NOTE})` } }, { status: 400 });
  }

  const day = setDayLog(params.slug, number, note ?? '');
  if (!day) return json({ code: 'trip_not_found', context: { reason: 'day not found' } }, { status: 404 });
  invalidateEnrichCache();
  return json({ ok: true, day });
}

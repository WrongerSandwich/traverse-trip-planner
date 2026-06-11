import { json } from '@sveltejs/kit';
import { setStopCapture } from '$lib/server/candidates.js';
import { invalidateEnrichCache, rejectInvalidSlug, rejectInvalidId, findTripLocation } from '$lib/server/data.js';

const MAX_NOTE = 2000;
const VALID_STATUS = new Set(['visited', 'skipped']);

/**
 * PATCH in-trip capture for one stop. Body: { status?, note? }
 *   status: 'visited' | 'skipped' | null (clear)
 *   note:   string (<=2000 chars; '' clears)
 * Planning stage only.
 */
export async function PATCH({ params, request }) {
  const invalid = rejectInvalidSlug(params.slug);
  if (invalid) return invalid;
  const invalidId = rejectInvalidId(params.id);
  if (invalidId) return invalidId;

  const loc = findTripLocation(params.slug);
  if (!loc || loc.kind !== 'dir') return json({ code: 'trip_not_found' }, { status: 404 });
  if (loc.stage !== 'planning') return json({ code: 'wrong_stage' }, { status: 409 });

  let body;
  try { body = await request.json(); } catch { body = {}; }

  const patch = {};
  if ('status' in body) {
    if (body.status !== null && !VALID_STATUS.has(body.status)) {
      return json({ code: 'invalid_input', context: { reason: 'status must be "visited", "skipped", or null' } }, { status: 400 });
    }
    patch.status = body.status;
  }
  if ('note' in body) {
    if (body.note != null && typeof body.note !== 'string') {
      return json({ code: 'invalid_input', context: { reason: 'note must be a string' } }, { status: 400 });
    }
    if (typeof body.note === 'string' && body.note.length > MAX_NOTE) {
      return json({ code: 'invalid_input', context: { reason: `note is too long (max ${MAX_NOTE})` } }, { status: 400 });
    }
    patch.note = body.note ?? '';
  }
  if (Object.keys(patch).length === 0) {
    return json({ code: 'invalid_input', context: { reason: 'provide status and/or note' } }, { status: 400 });
  }

  const updated = setStopCapture(params.slug, params.id, patch);
  if (!updated) return json({ code: 'trip_not_found', context: { reason: 'stop not found' } }, { status: 404 });
  invalidateEnrichCache();
  return json({ ok: true, candidate: updated });
}

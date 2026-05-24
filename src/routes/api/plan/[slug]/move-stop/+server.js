import { json } from '@sveltejs/kit';
import { moveStopToDay } from '$lib/server/plan.js';
import { invalidateEnrichCache, rejectInvalidSlug } from '$lib/server/data.js';

/**
 * POST /api/plan/[slug]/move-stop
 *
 * Body: { fromDay: number, toDay: number, stopId: string }
 *
 * Atomically removes `stopId` from `fromDay` and appends to `toDay`'s
 * stops list. Single file write (see plan.js moveStopToDay), so the
 * client doesn't have to design around partial-failure semantics the
 * way a two-call DELETE+POST flow would require. A no-op if `stopId`
 * isn't in `fromDay` to begin with; idempotent if it's already in
 * `toDay`.
 */
export async function POST({ params, request }) {
  const invalid = rejectInvalidSlug(params.slug);
  if (invalid) return invalid;

  const body = await request.json().catch(() => ({}));
  const fromDay = Number(body?.fromDay);
  const toDay = Number(body?.toDay);
  const stopId = body?.stopId;

  if (!Number.isFinite(fromDay) || !Number.isFinite(toDay) || !stopId) {
    return json({ error: 'fromDay (number), toDay (number), and stopId (string) are required' }, { status: 400 });
  }
  if (fromDay === toDay) {
    return json({ error: 'fromDay and toDay must differ' }, { status: 400 });
  }

  try {
    moveStopToDay(params.slug, fromDay, toDay, stopId);
    invalidateEnrichCache();
    return json({ ok: true });
  } catch (err) {
    return json({ error: String(err.message ?? err) }, { status: 400 });
  }
}

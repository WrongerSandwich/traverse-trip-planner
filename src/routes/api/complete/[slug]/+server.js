import { json } from '@sveltejs/kit';
import { moveTrip, rejectInvalidSlug } from '$lib/server/data.js';

export function POST({ params }) {
  const invalid = rejectInvalidSlug(params.slug);
  if (invalid) return invalid;
  const { slug } = params;
  const err = moveTrip(slug, 'planning', 'completed', 'completed');
  if (err) return json({ error: err.error, code: 'move_failed' }, { status: err.status ?? 500 });
  return json({ ok: true, slug, stage: 'completed' });
}

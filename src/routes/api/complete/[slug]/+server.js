import { json } from '@sveltejs/kit';
import { moveTrip, rejectInvalidSlug } from '$lib/server/data.js';

export function POST({ params }) {
  const invalid = rejectInvalidSlug(params.slug);
  if (invalid) return invalid;
  const { slug } = params;
  const err = moveTrip(slug, 'planning', 'completed', 'completed');
  if (err) return new Response(err.error, { status: err.status });
  return json({ ok: true, slug, stage: 'completed' });
}

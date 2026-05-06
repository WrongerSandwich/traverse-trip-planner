import { json } from '@sveltejs/kit';
import { moveTrip } from '$lib/server/data.js';

export function POST({ params }) {
  const { slug } = params;
  const err = moveTrip(slug, 'exploring', 'planning', 'planning');
  if (err) return new Response(err.error, { status: err.status });
  return json({ ok: true, slug, stage: 'planning' });
}

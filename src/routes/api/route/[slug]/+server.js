import { json } from '@sveltejs/kit';
import { getTripRoute, rejectInvalidSlug } from '$lib/server/data.js';

export async function GET({ params }) {
  const invalid = rejectInvalidSlug(params.slug);
  if (invalid) return invalid;
  const coords = await getTripRoute(params.slug);
  if (!coords) return new Response('No route', { status: 404 });
  return json({ coords });
}

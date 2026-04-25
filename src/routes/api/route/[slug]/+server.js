import { json } from '@sveltejs/kit';
import { getTripRoute } from '$lib/server/data.js';

export async function GET({ params }) {
  const coords = await getTripRoute(params.slug);
  if (!coords) return new Response('No route', { status: 404 });
  return json({ coords });
}

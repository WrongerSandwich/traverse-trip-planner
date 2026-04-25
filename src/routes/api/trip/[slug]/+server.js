import { json } from '@sveltejs/kit';
import { getTripFiles } from '$lib/server/data.js';

export function GET({ params }) {
  const data = getTripFiles(params.slug);
  if (!data) return new Response('Not found', { status: 404 });
  return json(data);
}

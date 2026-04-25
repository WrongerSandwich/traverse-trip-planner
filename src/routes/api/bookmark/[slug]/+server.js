import { json } from '@sveltejs/kit';
import { toggleStarred } from '$lib/server/data.js';

export function POST({ params }) {
  const result = toggleStarred(params.slug);
  if (!result) return new Response('Not found', { status: 404 });
  return json(result);
}

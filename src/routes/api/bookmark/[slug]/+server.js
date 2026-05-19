import { json } from '@sveltejs/kit';
import { toggleStarred, rejectInvalidSlug } from '$lib/server/data.js';

export function POST({ params }) {
  const invalid = rejectInvalidSlug(params.slug);
  if (invalid) return invalid;
  const result = toggleStarred(params.slug);
  if (!result) return new Response('Not found', { status: 404 });
  return json(result);
}

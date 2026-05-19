import { json } from '@sveltejs/kit';
import { getTripFiles, rejectInvalidSlug } from '$lib/server/data.js';

export function GET({ params }) {
  const invalid = rejectInvalidSlug(params.slug);
  if (invalid) return invalid;
  const data = getTripFiles(params.slug);
  if (!data) return new Response('Not found', { status: 404 });
  return json(data);
}

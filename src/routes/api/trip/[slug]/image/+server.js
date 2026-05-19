import { json } from '@sveltejs/kit';
import { updateImageMeta, rejectInvalidSlug } from '$lib/server/data.js';

export async function POST({ params, request }) {
  const invalid = rejectInvalidSlug(params.slug);
  if (invalid) return invalid;
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const patch = {};
  if ('image_query' in body) patch.image_query = body.image_query;
  if ('image_pick'  in body) patch.image_pick  = body.image_pick;
  if (Object.keys(patch).length === 0) {
    return new Response('No fields to update', { status: 400 });
  }

  try {
    const result = updateImageMeta(params.slug, patch);
    if (!result) return new Response('Not found', { status: 404 });
    return json(result);
  } catch (err) {
    if (err instanceof TypeError) {
      return json({ code: 'invalid_input', reason: err.message }, { status: 400 });
    }
    console.error('updateImageMeta failed:', err);
    return json({ code: 'image_save_failed' }, { status: 500 });
  }
}

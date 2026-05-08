import { json } from '@sveltejs/kit';
import { setShared } from '$lib/server/data.js';
import { makeShareToken, shareEnabled } from '$lib/server/share.js';

export function POST({ params }) {
  if (!shareEnabled()) return new Response('ATLAS_SHARE_SECRET not set', { status: 503 });
  const result = setShared(params.slug, true);
  if (!result) return new Response('Trip not found', { status: 404 });
  const token = makeShareToken(params.slug);
  return json({ ok: true, token, url: `/share/${token}` });
}

export function DELETE({ params }) {
  const result = setShared(params.slug, false);
  if (!result) return new Response('Trip not found', { status: 404 });
  return json({ ok: true });
}

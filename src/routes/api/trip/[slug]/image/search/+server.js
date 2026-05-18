import { json } from '@sveltejs/kit';
import { fetchImage, isPexelsConfigured } from '$lib/server/data.js';

export async function GET({ url }) {
  const q = url.searchParams.get('q')?.trim();
  if (!q) return new Response('Missing q parameter', { status: 400 });

  if (!isPexelsConfigured()) {
    return json({ code: 'image_search_unconfigured' }, { status: 503 });
  }

  const image = await fetchImage(q);
  return json({ photos: image?.photos ?? [] });
}

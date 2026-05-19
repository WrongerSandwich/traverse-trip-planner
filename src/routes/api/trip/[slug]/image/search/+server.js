import { json } from '@sveltejs/kit';
import { fetchImage, isPexelsConfigured } from '$lib/server/data.js';
import { rateLimitResponse } from '$lib/server/rate-limit.js';

export async function GET(event) {
  // Per-IP limit — cost is Pexels API quota, not per-trip work.
  const limited = rateLimitResponse({ event, endpoint: 'image-search' });
  if (limited) return limited;

  const q = event.url.searchParams.get('q')?.trim();
  if (!q) return new Response('Missing q parameter', { status: 400 });

  if (!isPexelsConfigured()) {
    return json({ code: 'image_search_unconfigured' }, { status: 503 });
  }

  const image = await fetchImage(q);
  return json({ photos: image?.photos ?? [] });
}

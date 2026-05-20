import { json } from '@sveltejs/kit';
import { readFileSync } from 'node:fs';
import {
  applyImagePick,
  fetchImage,
  findTripFile,
  imageQuery,
  invalidateEnrichCache,
  isPexelsConfigured,
  parseFrontmatter,
  purgeImageCacheEntry,
  rejectInvalidSlug,
} from '$lib/server/data.js';
import { rateLimitResponse } from '$lib/server/rate-limit.js';

export async function POST(event) {
  const invalid = rejectInvalidSlug(event.params.slug);
  if (invalid) return invalid;

  const limited = rateLimitResponse({ event, endpoint: 'image-search' });
  if (limited) return limited;

  if (!isPexelsConfigured()) {
    return json({ code: 'image_search_unconfigured' }, { status: 503 });
  }

  const filePath = findTripFile(event.params.slug);
  if (!filePath) return new Response('Not found', { status: 404 });
  const fm = parseFrontmatter(readFileSync(filePath, 'utf8'));
  if (!fm) return new Response('Not found', { status: 404 });

  const query = imageQuery(fm);
  if (!query) return json({ code: 'image_search_failed' }, { status: 200 });

  purgeImageCacheEntry(query);
  const raw = await fetchImage(query);
  const image = applyImagePick(raw, fm.image_pick);
  invalidateEnrichCache();

  if (!image) return json({ image: null, code: 'image_search_failed' });
  return json({ image });
}

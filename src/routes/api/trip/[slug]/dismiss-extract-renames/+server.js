import { json } from '@sveltejs/kit';
import { readFileSync, existsSync } from 'fs';
import { rejectInvalidSlug, findTripFile, removeFrontmatterField, atomicWrite, invalidateEnrichCache } from '$lib/server/data.js';

export async function POST({ params }) {
  const invalid = rejectInvalidSlug(params.slug);
  if (invalid) return invalid;

  const filePath = findTripFile(params.slug);
  if (!filePath || !existsSync(filePath)) {
    return new Response('Trip not found', { status: 404 });
  }

  const content = readFileSync(filePath, 'utf8');
  const updated = removeFrontmatterField(content, 'last_extract_renames');
  atomicWrite(filePath, updated);
  invalidateEnrichCache();

  return json({ ok: true });
}

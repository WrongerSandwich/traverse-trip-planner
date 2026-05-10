import { json } from '@sveltejs/kit';
import { writeBrochure, readBrochure } from '$lib/server/brochure.js';

export async function PUT({ params, request }) {
  const { slug } = params;

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response('Invalid JSON body', { status: 400 });
  }

  const data = body?.data;
  if (!data || typeof data !== 'object') {
    return new Response('Missing or invalid "data" field', { status: 400 });
  }

  // Preserve any prose body the user may have edited directly in
  // brochure.md (we don't surface it in the UI v1, but don't clobber).
  let existingProse = '';
  try {
    const existing = readBrochure(slug);
    if (existing?.prose) existingProse = existing.prose;
  } catch { /* OK if no existing brochure */ }

  try {
    writeBrochure(slug, { data, prose: existingProse });
  } catch (err) {
    return new Response(`Failed to write brochure: ${err.message}`, { status: 500 });
  }

  return json({ ok: true });
}

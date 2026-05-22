import { json } from '@sveltejs/kit';
import { addDay } from '$lib/server/plan.js';
import { invalidateEnrichCache } from '$lib/server/data.js';

export async function POST({ params }) {
  try {
    addDay(params.slug);
    invalidateEnrichCache();
    return json({ ok: true });
  } catch (err) {
    return json({ error: String(err.message ?? err) }, { status: 400 });
  }
}

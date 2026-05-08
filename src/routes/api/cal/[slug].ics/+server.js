import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { ROOT, parseFrontmatter } from '$lib/server/data.js';
import { tripsToIcs } from '$lib/server/ics.js';

function findTripFrontmatter(slug) {
  for (const stage of ['planning', 'completed']) {
    const overview = join(ROOT, stage, slug, 'overview.md');
    if (existsSync(overview)) {
      const fm = parseFrontmatter(readFileSync(overview, 'utf8'));
      if (fm) return { ...fm, _slug: slug };
    }
  }
  return null;
}

export function GET({ params }) {
  const trip = findTripFrontmatter(params.slug);
  if (!trip) return new Response('Not found', { status: 404 });
  const ics = tripsToIcs([trip]);
  return new Response(ics, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Cache-Control': 'no-cache',
    },
  });
}

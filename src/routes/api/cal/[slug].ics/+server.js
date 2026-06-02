import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { DATA_DIR, parseFrontmatter, rejectInvalidSlug } from '$lib/server/data.js';
import { readPlan } from '$lib/server/plan.js';
import { readCandidates } from '$lib/server/candidates.js';
import { tripToIcs } from '$lib/server/ics.js';

// Locate the trip in planning/ or completed/ and return both the parsed
// overview frontmatter (for target_date / title / etc) and the resolved
// stage so we know whether plan.yaml / candidates.yaml will exist.
function findTripWithStage(slug) {
  for (const stage of ['planning', 'completed']) {
    const overview = join(DATA_DIR, stage, slug, 'overview.md');
    if (existsSync(overview)) {
      const fm = parseFrontmatter(readFileSync(overview, 'utf8'));
      if (fm) return { trip: { ...fm, _slug: slug }, stage };
    }
  }
  return null;
}

export function GET({ params }) {
  const invalid = rejectInvalidSlug(params.slug);
  if (invalid) return invalid;

  const found = findTripWithStage(params.slug);
  if (!found) return new Response('Not found', { status: 404 });
  const { trip, stage } = found;

  // Planning + completed trips have plan + candidates on disk; idea-stage
  // doesn't (no folder). Load conditionally to mirror +page.server.js.
  const plan = stage === 'planning' || stage === 'completed' ? readPlan(params.slug) : null;
  const candidates = stage === 'planning' || stage === 'completed' ? readCandidates(params.slug) : null;

  const ics = tripToIcs(trip, { plan, candidates });
  if (!ics) return new Response(null, { status: 204 });

  return new Response(ics, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="${params.slug}.ics"`,
      'Cache-Control': 'no-cache',
    },
  });
}

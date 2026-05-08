import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { ROOT, parseFrontmatter } from '$lib/server/data.js';
import { tripsToIcs } from '$lib/server/ics.js';

function listPlanningTrips() {
  const planningDir = join(ROOT, 'planning');
  if (!existsSync(planningDir)) return [];
  const trips = [];
  for (const entry of readdirSync(planningDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const overview = join(planningDir, entry.name, 'overview.md');
    if (!existsSync(overview)) continue;
    const fm = parseFrontmatter(readFileSync(overview, 'utf8'));
    if (!fm) continue;
    trips.push({ ...fm, _slug: entry.name });
  }
  return trips;
}

export function GET() {
  const trips = listPlanningTrips();
  const ics = tripsToIcs(trips);
  return new Response(ics, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Cache-Control': 'no-cache',
    },
  });
}

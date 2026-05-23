// Derive a brochure-shaped object from plan.md + candidates.md + overview frontmatter.
// Pure templating — no AI, no cache. Called per-request by /brochure route.

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { findTripLocation, parseFrontmatter } from './data.js';
import { readPlan, findDanglingCandidateIds } from './plan.js';
import { readCandidates } from './candidates.js';

function readOverviewFm(slug) {
  const loc = findTripLocation(slug);
  if (!loc) return {};
  const p = join(loc.path, 'overview.md');
  if (!existsSync(p)) return {};
  return parseFrontmatter(readFileSync(p, 'utf8')) || {};
}

export function deriveBrochure(slug) {
  const fm = readOverviewFm(slug);
  const plan = readPlan(slug);
  const cands = readCandidates(slug);
  if (!plan || !cands) return null;

  const lookup = new Map();
  for (const s of cands.stops) lookup.set(s.id, { kind: 'stop', ...s });
  for (const l of cands.lodging) lookup.set(l.id, { kind: 'lodging', ...l });

  const days = plan.days.map((d) => ({
    n: d.number,
    date: d.date ?? null,
    theme: null,
    drive_distance_mi: d.drive_distance_mi ?? null,
    notes: d.notes ?? '',
    stops: d.stops
      .map((id) => lookup.get(id))
      .filter((c) => c?.kind === 'stop')
      .map((c) => ({
        name: c.name,
        category: c.category,
        description: c.description,
        coords: c.coords ?? null,
      })),
    lodging: d.lodging_id && lookup.get(d.lodging_id)?.kind === 'lodging'
      ? { name: lookup.get(d.lodging_id).name, coords: lookup.get(d.lodging_id).coords ?? null }
      : null,
  }));

  return {
    title: fm.title ?? slug,
    subtitle: fm.vibe ?? null,
    target_date: fm.target_date ?? null,
    duration_days: fm.duration_days ?? plan.days.length,
    cover_query: plan.cover_query,
    field_guide_notes: plan.field_guide_notes,
    gotchas: plan.gotchas,
    days,
    danglings: findDanglingCandidateIds(slug),
  };
}

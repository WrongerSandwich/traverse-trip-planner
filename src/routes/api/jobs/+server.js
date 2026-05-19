// GET /api/jobs — snapshot of in-flight Ambient Background jobs.
//
// Consumed by the global pill + jobs drawer (BackgroundJobsIndicator) and the
// per-trip badge (TripJobBadge). Reads only the in-memory map — for survival
// across restart, see the sweep wired into src/hooks.server.js.
//
// The response is enriched with trip titles so the drawer + toasts can render
// "Hannibal Mississippi · Brochure" without a second round-trip per row.

import { readFileSync } from 'node:fs';
import { json } from '@sveltejs/kit';
import { listJobs, listRecentEvents } from '$lib/server/jobs.js';
import { findTripFile, parseFrontmatter } from '$lib/server/data.js';

function makeTitleCache() {
  const cache = new Map();
  return function titleForSlug(slug) {
    if (cache.has(slug)) return cache.get(slug);
    const path = findTripFile(slug);
    if (!path) { cache.set(slug, null); return null; }
    let content;
    try {
      content = readFileSync(path, 'utf8');
    } catch {
      cache.set(slug, null);
      return null;
    }
    const fm = parseFrontmatter(content);
    const title = fm?.title ?? null;
    cache.set(slug, title);
    return title;
  };
}

export function GET() {
  const titleForSlug = makeTitleCache();
  const jobs = listJobs().map((j) => ({ ...j, title: titleForSlug(j.slug) }));
  const recent = listRecentEvents().map((e) => ({ ...e, title: titleForSlug(e.slug) }));
  return json({ jobs, recent });
}

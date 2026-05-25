// Derive a brochure-shaped object from plan.yaml + candidates.yaml + overview frontmatter.
// Pure templating — no AI, no cache. Called per-request by /brochure route.
//
// The output shape is a hybrid: the new flat day-shape (n, stops[], lodging)
// for direct consumers (BrochureDayBlocks, tests) plus a legacy-compatible
// projection (top-level stops[], top-level lodging[], days[].blocks, array
// field_guide_notes/gotchas) so the existing Brochure.svelte print view can
// render without restructuring. Fields that have no analog in plan.yaml +
// candidates.yaml (theme, address, hours, must_see, nights, confirmation, time)
// are simply omitted; the print view guards each with {#if} so they no-op.

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

// plan.yaml stores field_guide_notes / gotchas as arrays of strings (new
// format). For backwards compatibility during the migration window, block
// strings (one bullet per line, optionally prefixed with "- ") are also
// accepted — parsePlanFile already coerces them, but toBulletArray() provides
// an extra safety net for any path that bypasses readPlan().
function toBulletArray(value) {
  if (Array.isArray(value)) return value.map((s) => String(s).trim()).filter(Boolean);
  if (typeof value !== 'string') return [];
  return value
    .split('\n')
    .map((line) => line.replace(/^\s*[-*•]\s+/, '').trim())
    .filter(Boolean);
}

// candidates.yaml stores coords as { lat, lng } objects (see find-more,
// add-candidate, geocode-job). The brochure subsystem (+page.server.js,
// Brochure.svelte, DestinationMap.svelte) consumes them as [lat, lng]
// arrays so projection.project(...coords) can spread cleanly. Normalize
// here so disk-shape stays expressive and consumers stay convenient. Also
// tolerates the legacy array shape if any old data still has it.
function normalizeCoords(c) {
  if (!c) return null;
  if (Array.isArray(c) && c.length === 2) {
    const [lat, lng] = c.map(Number);
    return Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : null;
  }
  if (typeof c === 'object' && c.lat != null && c.lng != null) {
    const lat = Number(c.lat);
    const lng = Number(c.lng);
    return Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : null;
  }
  return null;
}

export function deriveBrochure(slug) {
  const fm = readOverviewFm(slug);
  const plan = readPlan(slug);
  const cands = readCandidates(slug);
  if (!plan || !cands) return null;

  const lookup = new Map();
  for (const s of cands.stops) lookup.set(s.id, { kind: 'stop', ...s });
  for (const l of cands.lodging) lookup.set(l.id, { kind: 'lodging', ...l });

  const days = plan.days.map((d) => {
    const dayStops = d.stops
      .map((id) => lookup.get(id))
      .filter((c) => c?.kind === 'stop')
      .map((c) => ({
        name: c.name,
        category: c.category,
        description: c.description,
        notes: c.description,           // legacy alias for the print view
        coords: normalizeCoords(c.coords),
      }));
    const dayLodging = d.lodging_id && lookup.get(d.lodging_id)?.kind === 'lodging'
      ? { name: lookup.get(d.lodging_id).name, coords: normalizeCoords(lookup.get(d.lodging_id).coords) }
      : null;
    return {
      n: d.number,
      date: d.date ?? null,
      theme: null,
      drive_distance_mi: d.drive_distance_mi ?? null,
      notes: d.notes ?? '',
      stops: dayStops,
      lodging: dayLodging,
      // Synthetic single-block projection for BrochureDayBlocks. Each stop
      // becomes a no-time item so the existing component can iterate without
      // a rewrite. Empty when the day has no stops. `period: null` so the
      // component's optional period-header renders nothing (legacy brochures
      // used 'morning'/'afternoon'/'evening'; derived ones have no analog).
      blocks: dayStops.length
        ? [{
            period: null,
            items: dayStops.map((s) => ({ time: null, activity: s.name })),
          }]
        : [],
    };
  });

  // Flat top-level stops + lodging arrays for the legacy print sections.
  // Dedupe by candidate id (a stop appearing on two days renders once at the
  // top-level — the day blocks above still show it on each day it's planned).
  const topStops = [];
  const topLodging = [];
  const seenStops = new Set();
  const seenLodging = new Set();
  for (const d of plan.days) {
    for (const id of d.stops) {
      const c = lookup.get(id);
      if (!c || c.kind !== 'stop' || seenStops.has(id)) continue;
      seenStops.add(id);
      topStops.push({
        name: c.name,
        category: c.category,
        notes: c.description,
        coords: normalizeCoords(c.coords),
      });
    }
    const lid = d.lodging_id;
    if (lid && !seenLodging.has(lid)) {
      const c = lookup.get(lid);
      if (c?.kind === 'lodging') {
        seenLodging.add(lid);
        topLodging.push({
          name: c.name,
          nights: typeof c.nights === 'number' ? c.nights : undefined,
          coords: normalizeCoords(c.coords),
        });
      }
    }
  }

  return {
    title: fm.title ?? slug,
    subtitle: fm.vibe ?? null,
    target_date: fm.target_date ?? null,
    duration_days: fm.duration_days ?? plan.days.length,
    cover_query: plan.cover_query ?? null,
    // field_guide_notes / gotchas are arrays in plan.yaml (readPlan coerces
    // any legacy block-string). toBulletArray() is a belt-and-suspenders
    // guard; callers that already have an array pass straight through.
    field_guide_notes: toBulletArray(plan.field_guide_notes),
    gotchas: toBulletArray(plan.gotchas),
    // Flat top-level stops + lodging mirror the brochure print view's
    // expected shape so it can iterate without restructuring. Day blocks
    // (above) still drive the day-by-day section.
    stops: topStops,
    lodging: topLodging,
    days,
    danglings: findDanglingCandidateIds(slug),
  };
}

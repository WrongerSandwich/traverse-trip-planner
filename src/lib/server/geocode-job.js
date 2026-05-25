// Geocode-candidates follow-on background job (issue #382).
//
// After deepen completes, this job runs the Nominatim loop that fills in
// `coords` on every visible candidate. Lifted out of realizePlan() so the
// deepen pill no longer waits on the ~15s throttle — `Research complete ✓`
// fires immediately and the second `Geocoding…` pill takes over.
//
// Contract:
//   - reads candidates from disk on each iteration (so concurrent edits
//     from the UI — un-hide, add, etc. — are not clobbered)
//   - skips entries that already have `coords` (idempotent on re-run)
//   - skips entries with `hidden: true` (no point pinning discards)
//   - writes candidates.yaml after each successful geocode so the map fills
//     in incrementally as the user watches
//   - respects an AbortController.signal — checked at the top of each
//     iteration so cancel from the jobs drawer aborts cleanly without
//     half-applying writes
//
// Disambiguation reuses `getDestinationRefCoords` + `geocodeCandidate` from
// candidates.js (same logic realize-plan used to call inline). The
// destination context comes from the overview frontmatter, which we read
// directly off disk because getTripFiles strips frontmatter from `files.overview`.

import { existsSync, readFileSync } from 'node:fs';
import { findTripFile, parseFrontmatter } from './data.js';
import {
  geocodeCandidate,
  getDestinationRefCoords,
  readCandidates,
  writeCandidates,
} from './candidates.js';

/**
 * @param {string} slug
 * @param {{ signal?: AbortSignal }} [opts]
 * @returns {Promise<void>}
 */
export async function geocodeCandidatesJob(slug, opts = {}) {
  const signal = opts.signal;

  // No candidates file => nothing to do. Bail out quietly so the job can
  // complete cleanly on freshly-created trips.
  const initial = readCandidates(slug);
  if (!initial) return;

  // Resolve disambiguation context once: read the overview frontmatter for
  // `destination`, then geocode it for the reference coordinate. Both feed
  // into geocodeCandidate() so common names ("Lake McDonald") resolve in
  // the trip's region instead of pinning to a same-name match elsewhere.
  const overviewPath = findTripFile(slug);
  let destinationContext = '';
  if (overviewPath && existsSync(overviewPath)) {
    const overviewRaw = readFileSync(overviewPath, 'utf8');
    const fm = parseFrontmatter(overviewRaw) || {};
    destinationContext = fm.destination ?? '';
  }
  const refCoords = await getDestinationRefCoords(destinationContext);

  // Build the work list from the initial read so we know which ids to
  // process. We re-read candidates inside the loop on each iteration so any
  // concurrent UI edits (un-hide, add-candidate, etc.) survive — the
  // write-back uses the freshly-read state plus the just-resolved coords,
  // not a stale snapshot.
  const ids = [];
  for (const s of initial.stops ?? []) {
    if (s.hidden) continue;
    if (s.coords) continue;
    if (s.id && s.name) ids.push({ id: s.id, name: s.name, kind: 'stop' });
  }
  for (const l of initial.lodging ?? []) {
    if (l.hidden) continue;
    if (l.coords) continue;
    if (l.id && l.name) ids.push({ id: l.id, name: l.name, kind: 'lodging' });
  }

  for (const entry of ids) {
    if (signal?.aborted) return;

    const coords = await geocodeCandidate(entry.name, destinationContext, refCoords);
    if (!coords) continue;

    // Re-read so any UI mutations since the prior iteration land in the
    // file we're about to write. If the candidate was deleted or hidden
    // mid-loop, skip the write — we don't want to resurrect a discard.
    const fresh = readCandidates(slug);
    if (!fresh) continue;

    const list = entry.kind === 'stop' ? fresh.stops : fresh.lodging;
    const target = list.find((c) => c.id === entry.id);
    if (!target) continue;
    if (target.hidden) continue;
    if (target.coords) continue; // someone else got here first; respect their write.

    target.coords = { lat: coords[0], lng: coords[1] };
    writeCandidates(slug, fresh);
  }
}

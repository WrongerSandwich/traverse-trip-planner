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
import { findTripFile, parseFrontmatter, reverseGeocode } from './data.js';
import {
  geocodeCandidate,
  getDestinationRefCoords,
  readCandidates,
  writeCandidates,
} from './candidates.js';

/**
 * @param {string} slug
 * @param {{ signal?: AbortSignal }} [opts]
 * @returns {Promise<{ geocodeFailures: number, reverseFailures: number } | undefined>}
 *   A summary of swallowed failures so the caller can surface a "X stops
 *   couldn't be pinned / addressed" hint instead of the data just looking
 *   incomplete (#488). Returns `undefined` only when there's no candidates
 *   file (nothing was attempted).
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
  // getDestinationRefCoords throws if Nominatim is down (#488 point 3). The
  // ref coord is only a disambiguation aid — degrade to `null` (bare-name
  // geocoding without distance-gating) rather than crashing the whole job.
  let refCoords = null;
  try {
    refCoords = await getDestinationRefCoords(destinationContext);
  } catch (e) {
    console.warn(`[geocode-candidates] ${slug}: ref-coords lookup failed, continuing without disambiguation —`, e?.message ?? e);
  }

  // Count swallowed failures so the job can report partial completion (#488
  // point 2). A forward-geocode miss (geocodeCandidate → null) and a
  // reverse-geocode miss (reverseGeocode → null) both leave a candidate
  // looking incomplete; tracking them lets the caller surface a hint.
  let geocodeFailures = 0;
  let reverseFailures = 0;

  // Build the work list from the initial read so we know which ids to
  // process. We re-read candidates inside the loop on each iteration so any
  // concurrent UI edits (un-hide, add-candidate, etc.) survive — the
  // write-back uses the freshly-read state plus the just-resolved coords,
  // not a stale snapshot.
  //
  // Stop candidates enroll when EITHER coords OR address is missing so that
  // trips geocoded before v0.1.2 (coords present, address absent) get their
  // address backfilled on the next run. Lodging candidates still only enroll
  // on missing coords (no brochure address slot yet).
  const ids = [];
  for (const s of initial.stops ?? []) {
    if (s.hidden) continue;
    if (s.coords && s.address) continue; // both present → nothing to do
    if (s.id && s.name) ids.push({ id: s.id, name: s.name, kind: 'stop' });
  }
  for (const l of initial.lodging ?? []) {
    if (l.hidden) continue;
    if (l.coords) continue; // lodging doesn't get address yet
    if (l.id && l.name) ids.push({ id: l.id, name: l.name, kind: 'lodging' });
  }

  for (const entry of ids) {
    if (signal?.aborted) return;

    // Re-read fresh each iteration so concurrent UI edits are visible.
    const fresh = readCandidates(slug);
    if (!fresh) continue;
    const list = entry.kind === 'stop' ? fresh.stops : fresh.lodging;
    const target = list.find((c) => c.id === entry.id);
    if (!target) continue;
    if (target.hidden) continue;

    let needsWrite = false;

    // Resolve coords only if missing. If the target already has coords (e.g.
    // a prior run filled them, or a user edit), skip the forward geocode
    // entirely and use the existing coords for the reverse lookup below.
    let coordsArr = null;
    if (target.coords) {
      coordsArr = [target.coords.lat, target.coords.lng];
    } else {
      // Pass any deepen-volunteered address as the most-precise geocode
      // attempt (#403/Bug 4): a stop can arrive with an address but no coords,
      // and a full address pins far more reliably than a bare name.
      coordsArr = await geocodeCandidate(entry.name, destinationContext, refCoords, target.address);
      if (coordsArr) {
        target.coords = { lat: coordsArr[0], lng: coordsArr[1] };
        needsWrite = true;
      } else {
        // Forward geocode found no plausible match — the pin won't appear.
        geocodeFailures++;
      }
    }
    if (!coordsArr) continue;

    // Stop candidates: also resolve a human-readable address as a byproduct
    // of having coords (#403). Skip lodging — no brochure slot for it yet.
    // Skip when the candidate already has an address (preserve user edits
    // and prior-run results).
    if (entry.kind === 'stop' && !target.address) {
      const addr = await reverseGeocode(coordsArr);
      if (addr) {
        target.address = addr;
        needsWrite = true;
      } else {
        // Reverse geocode failed (HTTP error, rate-limit, empty response) —
        // the stop keeps its coords but renders with a blank address. Count
        // it so the job can report how many addresses we couldn't backfill.
        reverseFailures++;
      }
    }

    if (needsWrite) writeCandidates(slug, fresh);
  }

  if (geocodeFailures > 0 || reverseFailures > 0) {
    console.warn(
      `[geocode-candidates] ${slug}: ${geocodeFailures} stop(s) couldn't be pinned, ` +
      `${reverseFailures} address(es) couldn't be resolved`,
    );
  }
  return { geocodeFailures, reverseFailures };
}

# Export formats implementation plan (#405)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship two new trip export surfaces — a per-day ICS calendar upgrade and per-day Google Maps deep links — both surfaced through new entries in the trip detail page's `⋯` menu.

**Architecture:** ICS work extends `src/lib/server/ics.js` with a per-day VEVENT generator and a dispatcher; the existing `/api/cal/[slug].ics` route picks between per-day and trip-level paths and adds `Content-Disposition`. Maps links live as a pure-function utility (`src/lib/utils/maps-links.js`) with no server endpoint — URLs are assembled at kebab-menu construction time from the data already on the page. Both formats are server-rendered or client-constructed at request time from existing plan + candidates data; no AI, no cache.

**Tech Stack:** SvelteKit, Node 20+, YAML (`yaml` lib), Vitest. ICS strings hand-built (no `ical` dep). Google Maps URL API (no API key needed for deep links).

---

## Spec reference

This plan implements [`docs/superpowers/specs/2026-06-02-export-formats-design.md`](../specs/2026-06-02-export-formats-design.md). When in doubt, the spec wins.

## File structure

**New files:**

| Path | Responsibility |
|---|---|
| `src/lib/utils/maps-links.js` | Pure URL builders for Google Maps deep links. Exports `stopToWaypoint`, `mapsDirectionsUrl`, `mapsDeepLinkSummary`. |
| `tests/maps-links.test.js` | Unit tests for the URL builders. |

**Modified files:**

| Path | Why |
|---|---|
| `src/lib/server/ics.js` | Add `tripToDailyVEvents()` and `tripToIcs()` dispatcher. Existing `tripToVEvent` and `tripsToIcs` stay intact. |
| `src/routes/api/cal/[slug].ics/+server.js` | Load `plan.yaml` + `candidates.yaml`, call new `tripToIcs()`, add `Content-Disposition` header, return 204 when no dates anywhere. |
| `src/routes/trips/[slug]/+page.svelte` | Extend `kebabGroups` derived: conditional `Download .ics` entry in `Output`, new `On the road` group with per-day Maps entries. |
| `tests/ics.test.js` | Per-day VEVENT cases; dispatcher cases; backward-compat assertion on `tripToVEvent` + `tripsToIcs`. |
| `CHANGELOG.md` | v0.1.2 entry. |

**Not touched:**

- `/api/cal.ics` (collection feed) — stays trip-level
- `src/routes/trips/[slug]/+page.server.js` — `plan` and `candidates` already flow to client (lines 32–33)
- `Brochure.svelte`, `derive-brochure.js` — parallel output, no overlap

---

## Phase 1 — Maps links utility

### Task 1: `stopToWaypoint` with coords/address/name fallback

**Files:**
- Create: `src/lib/utils/maps-links.js`
- Test: `tests/maps-links.test.js`

- [ ] **Step 1: Create the test file with the failing test**

Create `tests/maps-links.test.js`:

```js
import { describe, test, expect } from 'vitest';
import { stopToWaypoint } from '../src/lib/utils/maps-links.js';

describe('stopToWaypoint', () => {
  test('returns lat,lng when coords are present', () => {
    const stop = { name: 'X', address: '1 Main St', coords: [44.88, -86.05] };
    expect(stopToWaypoint(stop)).toBe('44.88,-86.05');
  });

  test('falls back to address when coords are missing', () => {
    const stop = { name: 'X', address: '1 Main St, Empire MI' };
    expect(stopToWaypoint(stop)).toBe('1 Main St, Empire MI');
  });

  test('falls back to name when coords and address are missing', () => {
    const stop = { name: 'Sleeping Bear Dunes' };
    expect(stopToWaypoint(stop)).toBe('Sleeping Bear Dunes');
  });

  test('returns null when stop has none of coords, address, name', () => {
    expect(stopToWaypoint({})).toBeNull();
    expect(stopToWaypoint(null)).toBeNull();
    expect(stopToWaypoint(undefined)).toBeNull();
  });

  test('treats non-array coords as missing', () => {
    const stop = { name: 'X', coords: { lat: 1, lng: 2 } };
    expect(stopToWaypoint(stop)).toBe('X');
  });

  test('treats 1-element coords as missing', () => {
    const stop = { name: 'X', coords: [44.88] };
    expect(stopToWaypoint(stop)).toBe('X');
  });

  test('treats empty-string address as missing', () => {
    const stop = { name: 'X', address: '   ' };
    expect(stopToWaypoint(stop)).toBe('X');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```
cd /home/evan/dev/traverse-trip-planner && npx vitest run tests/maps-links.test.js
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create the module with `stopToWaypoint`**

Create `src/lib/utils/maps-links.js`:

```js
// Google Maps deep-link builders. Pure functions, no Svelte deps, no API key.
// Consumed by the kebab menu construction in the trip detail page.
//
// URL shape: https://www.google.com/maps/dir/?api=1&waypoints=<wp1>|<wp2>|...
// No origin/destination — Maps prompts the user for current location once
// the URL loads, which is the right shape for the in-trip use case.

/**
 * Resolve a stop to its waypoint string. Prefers exact coords, falls back to
 * the human-readable address, then the place name. Returns `null` when the
 * stop has none of the three (skip from URL).
 *
 * @param {object} stop  Candidate stop projection — { name, address, coords }
 * @returns {string | null}
 */
export function stopToWaypoint(stop) {
  if (!stop || typeof stop !== 'object') return null;
  if (Array.isArray(stop.coords) && stop.coords.length === 2) {
    const [lat, lng] = stop.coords;
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return `${lat},${lng}`;
    }
  }
  if (typeof stop.address === 'string' && stop.address.trim()) {
    return stop.address.trim();
  }
  if (typeof stop.name === 'string' && stop.name.trim()) {
    return stop.name.trim();
  }
  return null;
}
```

- [ ] **Step 4: Run to verify it passes**

```
cd /home/evan/dev/traverse-trip-planner && npx vitest run tests/maps-links.test.js
```

Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/utils/maps-links.js tests/maps-links.test.js
git commit -m "feat(maps): stopToWaypoint() with coords/address/name fallback (#405)"
```

---

### Task 2: `mapsDirectionsUrl` + `mapsDeepLinkSummary`

**Files:**
- Modify: `src/lib/utils/maps-links.js`
- Modify: `tests/maps-links.test.js`

- [ ] **Step 1: Extend the test file with failing tests**

Append to `tests/maps-links.test.js`:

```js
import { mapsDirectionsUrl, mapsDeepLinkSummary } from '../src/lib/utils/maps-links.js';

describe('mapsDirectionsUrl', () => {
  test('assembles a single-stop URL with one waypoint', () => {
    const url = mapsDirectionsUrl([{ name: 'A', coords: [1, 2] }]);
    expect(url).toBe('https://www.google.com/maps/dir/?api=1&waypoints=1%2C2&travelmode=driving');
  });

  test('joins multiple waypoints with URL-encoded pipes', () => {
    const url = mapsDirectionsUrl([
      { coords: [1, 2] },
      { coords: [3, 4] },
      { coords: [5, 6] },
    ]);
    expect(url).toBe('https://www.google.com/maps/dir/?api=1&waypoints=1%2C2%7C3%2C4%7C5%2C6&travelmode=driving');
  });

  test('encodes address waypoints', () => {
    const url = mapsDirectionsUrl([{ address: '123 Main St, Empire MI' }]);
    expect(url).toContain('waypoints=123%20Main%20St%2C%20Empire%20MI');
  });

  test('caps at 11 stops when more are supplied', () => {
    const stops = Array.from({ length: 15 }, (_, i) => ({ name: `S${i + 1}` }));
    const url = mapsDirectionsUrl(stops);
    // First 11 names join with %7C; S12-S15 must NOT appear.
    expect(url).toContain('S1%7CS2');
    expect(url).toContain('S11&');           // S11 is the last waypoint
    expect(url).not.toContain('S12');
    expect(url).not.toContain('S15');
  });

  test('returns null when stops array is empty', () => {
    expect(mapsDirectionsUrl([])).toBeNull();
  });

  test('returns null when no stop yields a usable waypoint', () => {
    expect(mapsDirectionsUrl([{}, { coords: 'bad' }])).toBeNull();
  });

  test('skips stops with no usable encoding but uses the others', () => {
    const stops = [{ name: 'A' }, {}, { name: 'C' }];
    const url = mapsDirectionsUrl(stops);
    expect(url).toContain('waypoints=A%7CC');
  });

  test('respects travelMode override', () => {
    const url = mapsDirectionsUrl([{ name: 'A' }], { travelMode: 'walking' });
    expect(url).toContain('travelmode=walking');
  });
});

describe('mapsDeepLinkSummary', () => {
  test('returns null when no waypoints resolve', () => {
    expect(mapsDeepLinkSummary([])).toBeNull();
    expect(mapsDeepLinkSummary([{}])).toBeNull();
  });

  test('returns shape with url, waypointCount, truncated:false for in-range stops', () => {
    const result = mapsDeepLinkSummary([{ name: 'A' }, { name: 'B' }]);
    expect(result).toEqual({
      url: 'https://www.google.com/maps/dir/?api=1&waypoints=A%7CB&travelmode=driving',
      waypointCount: 2,
      truncated: false,
    });
  });

  test('marks truncated:true when more than 11 stops are supplied', () => {
    const stops = Array.from({ length: 13 }, (_, i) => ({ name: `S${i + 1}` }));
    const result = mapsDeepLinkSummary(stops);
    expect(result.truncated).toBe(true);
    expect(result.waypointCount).toBe(11);
  });

  test('waypointCount counts only usable stops, not raw input length', () => {
    // 3 usable + 2 unusable = 3 waypoints, truncated:false
    const result = mapsDeepLinkSummary([
      { name: 'A' },
      {},
      { name: 'B' },
      { coords: 'bad' },
      { name: 'C' },
    ]);
    expect(result.waypointCount).toBe(3);
    expect(result.truncated).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```
cd /home/evan/dev/traverse-trip-planner && npx vitest run tests/maps-links.test.js
```

Expected: FAIL — exports not found.

- [ ] **Step 3: Add the new exports to `maps-links.js`**

Append to `src/lib/utils/maps-links.js`:

```js
const MAPS_BASE = 'https://www.google.com/maps/dir/?api=1';

// Google Maps URL API allows up to 9 waypoints + origin + destination. With
// no origin/destination specified, all 11 slots are available for waypoints.
const MAX_WAYPOINTS = 11;

/**
 * Build a Google Maps directions URL from an ordered list of stops. Encodes
 * coords / address / name per `stopToWaypoint`. Stops that yield no usable
 * waypoint are skipped; only after that filtering is the 11-waypoint cap
 * applied. Returns `null` when no stop yields a usable waypoint.
 *
 * @param {object[]} stops
 * @param {{ travelMode?: string }} [opts]
 * @returns {string | null}
 */
export function mapsDirectionsUrl(stops, opts = {}) {
  if (!Array.isArray(stops) || stops.length === 0) return null;
  const usable = [];
  for (const s of stops) {
    const wp = stopToWaypoint(s);
    if (wp) usable.push(wp);
    if (usable.length >= MAX_WAYPOINTS) break;
  }
  if (usable.length === 0) return null;
  const waypoints = usable.map(encodeURIComponent).join(encodeURIComponent('|'));
  const travelMode = opts.travelMode || 'driving';
  return `${MAPS_BASE}&waypoints=${waypoints}&travelmode=${encodeURIComponent(travelMode)}`;
}

/**
 * Build a `{ url, waypointCount, truncated }` summary for the kebab menu.
 * `truncated` is true when the input had more usable stops than the URL cap.
 * Returns `null` when no usable waypoints resolve (same as `mapsDirectionsUrl`).
 *
 * @param {object[]} stops
 * @returns {{ url: string, waypointCount: number, truncated: boolean } | null}
 */
export function mapsDeepLinkSummary(stops) {
  if (!Array.isArray(stops) || stops.length === 0) return null;
  let usableCount = 0;
  for (const s of stops) {
    if (stopToWaypoint(s)) usableCount++;
  }
  if (usableCount === 0) return null;
  const url = mapsDirectionsUrl(stops);
  if (!url) return null;
  const waypointCount = Math.min(usableCount, MAX_WAYPOINTS);
  return {
    url,
    waypointCount,
    truncated: usableCount > MAX_WAYPOINTS,
  };
}
```

- [ ] **Step 4: Run to verify all tests pass**

```
cd /home/evan/dev/traverse-trip-planner && npx vitest run tests/maps-links.test.js
```

Expected: PASS (~18 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/utils/maps-links.js tests/maps-links.test.js
git commit -m "feat(maps): mapsDirectionsUrl() + mapsDeepLinkSummary() with 11-cap (#405)"
```

---

## Phase 2 — ICS per-day upgrade

### Task 3: `tripToDailyVEvents()` per-day generator

**Files:**
- Modify: `src/lib/server/ics.js`
- Modify: `tests/ics.test.js`

- [ ] **Step 1: Read the existing test file to learn the conventions**

```
cd /home/evan/dev/traverse-trip-planner && cat tests/ics.test.js | head -50
```

Note the import style, fixture pattern, and assertion style used by the existing `tripToVEvent` / `tripsToIcs` tests. Match it.

- [ ] **Step 2: Append the failing test cases**

Append to `tests/ics.test.js`:

```js
// ── tripToDailyVEvents — per-day expansion (#405) ──────────────────────────

import { tripToDailyVEvents } from '../src/lib/server/ics.js';

describe('tripToDailyVEvents', () => {
  const FROZEN = new Date('2026-06-02T12:00:00Z');

  const baseTrip = {
    _slug: 'lakeshore-loop',
    title: 'Lakeshore Loop',
  };

  test('returns null when no day has a date', () => {
    const plan = { days: [{ number: 1, stops: ['a'] }, { number: 2, stops: ['b'] }] };
    const candidates = { stops: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], lodging: [] };
    expect(tripToDailyVEvents(baseTrip, plan, candidates, FROZEN)).toBeNull();
  });

  test('returns null when plan is null or undefined', () => {
    expect(tripToDailyVEvents(baseTrip, null, null, FROZEN)).toBeNull();
    expect(tripToDailyVEvents(baseTrip, undefined, undefined, FROZEN)).toBeNull();
  });

  test('emits one VEVENT per dated day, skipping undated days', () => {
    const plan = {
      days: [
        { number: 1, date: '2026-07-04', stops: ['a'] },
        { number: 2, stops: ['b'] },                            // skipped — no date
        { number: 3, date: '2026-07-06', stops: ['c'] },
      ],
    };
    const candidates = {
      stops: [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
        { id: 'c', name: 'C' },
      ],
      lodging: [],
    };

    const events = tripToDailyVEvents(baseTrip, plan, candidates, FROZEN);
    expect(events).toHaveLength(2);
    expect(events[0]).toContain('UID:lakeshore-loop-day1@traverse');
    expect(events[0]).toContain('DTSTART;VALUE=DATE:20260704');
    expect(events[0]).toContain('DTEND;VALUE=DATE:20260705');
    expect(events[1]).toContain('UID:lakeshore-loop-day3@traverse');
    expect(events[1]).toContain('DTSTART;VALUE=DATE:20260706');
    expect(events[1]).toContain('DTEND;VALUE=DATE:20260707');
  });

  test('SUMMARY uses "<title> · Day N" format', () => {
    const plan = { days: [{ number: 2, date: '2026-07-04', stops: [] }] };
    const events = tripToDailyVEvents(baseTrip, plan, { stops: [], lodging: [] }, FROZEN);
    expect(events[0]).toContain('SUMMARY:Lakeshore Loop · Day 2');
  });

  test('falls back to slug when title is absent', () => {
    const plan = { days: [{ number: 1, date: '2026-07-04', stops: [] }] };
    const trip = { _slug: 'no-title' };
    const events = tripToDailyVEvents(trip, plan, { stops: [], lodging: [] }, FROZEN);
    expect(events[0]).toContain('SUMMARY:no-title · Day 1');
  });

  test('DESCRIPTION lists stops with categories', () => {
    const plan = {
      days: [
        { number: 1, date: '2026-07-04', stops: ['a', 'b'] },
      ],
    };
    const candidates = {
      stops: [
        { id: 'a', name: 'Sleeping Bear Dunes', category: 'outdoors' },
        { id: 'b', name: 'Dune Climb', category: 'view' },
      ],
      lodging: [],
    };
    const events = tripToDailyVEvents(baseTrip, plan, candidates, FROZEN);
    expect(events[0]).toMatch(/DESCRIPTION:[^\r\n]*Stops:\\n• Sleeping Bear Dunes \(outdoors\)\\n• Dune Climb \(view\)/);
  });

  test('DESCRIPTION includes lodging and notes when present', () => {
    const plan = {
      days: [
        {
          number: 1,
          date: '2026-07-04',
          stops: ['a'],
          lodging_id: 'inn',
          notes: 'Sunset is the move tonight.',
        },
      ],
    };
    const candidates = {
      stops: [{ id: 'a', name: 'A', category: 'misc' }],
      lodging: [{ id: 'inn', name: 'Riverbend Inn', address: '9922 Front St, Empire MI' }],
    };
    const events = tripToDailyVEvents(baseTrip, plan, candidates, FROZEN);
    expect(events[0]).toContain('Lodging: Riverbend Inn — 9922 Front St, Empire MI');
    expect(events[0]).toContain('Sunset is the move tonight.');
  });

  test('DESCRIPTION omits empty sections rather than rendering empty headings', () => {
    const plan = {
      days: [{ number: 1, date: '2026-07-04', stops: [] }],  // no stops, no lodging, no notes
    };
    const events = tripToDailyVEvents(baseTrip, plan, { stops: [], lodging: [] }, FROZEN);
    // DESCRIPTION line should not appear at all when there's nothing to say
    expect(events[0]).not.toMatch(/DESCRIPTION:/);
  });

  test('LOCATION resolves from lodging when present', () => {
    const plan = {
      days: [{ number: 1, date: '2026-07-04', stops: ['a'], lodging_id: 'inn' }],
    };
    const candidates = {
      stops: [{ id: 'a', name: 'A', address: '1 First St' }],
      lodging: [{ id: 'inn', name: 'Inn', address: '99 Inn Rd' }],
    };
    const events = tripToDailyVEvents(baseTrip, plan, candidates, FROZEN);
    expect(events[0]).toContain('LOCATION:Inn — 99 Inn Rd');
  });

  test('LOCATION falls back to first stop address when no lodging', () => {
    const plan = { days: [{ number: 1, date: '2026-07-04', stops: ['a'] }] };
    const candidates = {
      stops: [{ id: 'a', name: 'A', address: '1 First St' }],
      lodging: [],
    };
    const events = tripToDailyVEvents(baseTrip, plan, candidates, FROZEN);
    expect(events[0]).toContain('LOCATION:1 First St');
  });

  test('LOCATION is omitted when neither lodging nor first stop has address', () => {
    const plan = { days: [{ number: 1, date: '2026-07-04', stops: ['a'] }] };
    const candidates = {
      stops: [{ id: 'a', name: 'A' }],
      lodging: [],
    };
    const events = tripToDailyVEvents(baseTrip, plan, candidates, FROZEN);
    expect(events[0]).not.toMatch(/LOCATION:/);
  });

  test('UID stability: same input produces same UIDs', () => {
    const plan = { days: [{ number: 1, date: '2026-07-04', stops: [] }, { number: 2, date: '2026-07-05', stops: [] }] };
    const cands = { stops: [], lodging: [] };
    const a = tripToDailyVEvents(baseTrip, plan, cands, FROZEN);
    const b = tripToDailyVEvents(baseTrip, plan, cands, FROZEN);
    expect(a[0]).toContain('UID:lakeshore-loop-day1@traverse');
    expect(b[0]).toContain('UID:lakeshore-loop-day1@traverse');
    expect(a[1]).toContain('UID:lakeshore-loop-day2@traverse');
  });

  test('skips promoted stop IDs that have no matching candidate', () => {
    const plan = { days: [{ number: 1, date: '2026-07-04', stops: ['a', 'ghost', 'b'] }] };
    const candidates = {
      stops: [{ id: 'a', name: 'A', category: 'misc' }, { id: 'b', name: 'B', category: 'misc' }],
      lodging: [],
    };
    const events = tripToDailyVEvents(baseTrip, plan, candidates, FROZEN);
    expect(events[0]).toContain('• A (misc)');
    expect(events[0]).toContain('• B (misc)');
    expect(events[0]).not.toContain('ghost');
  });

  test('escapes special chars in description', () => {
    const plan = {
      days: [{ number: 1, date: '2026-07-04', stops: ['a'], notes: 'Watch out; mind the gap, and the rain.' }],
    };
    const candidates = {
      stops: [{ id: 'a', name: 'A', category: 'misc' }],
      lodging: [],
    };
    const events = tripToDailyVEvents(baseTrip, plan, candidates, FROZEN);
    // ICS escaping: ; → \;, , → \,, newline → \n
    expect(events[0]).toContain('Watch out\\; mind the gap\\, and the rain.');
  });
});
```

- [ ] **Step 3: Run to verify they fail**

```
cd /home/evan/dev/traverse-trip-planner && npx vitest run tests/ics.test.js
```

Expected: FAIL — `tripToDailyVEvents` is not exported.

- [ ] **Step 4: Add `tripToDailyVEvents` to `src/lib/server/ics.js`**

Insert the following function in `src/lib/server/ics.js` after `tripToVEvent` (around line 69, before `tripsToIcs`):

```js
/**
 * Build one VEVENT per dated day of a trip's plan (#405).
 *
 * Returns an array of VEVENT strings, or `null` when no day has a `date`
 * field. Days without dates are skipped (not synthesized).
 *
 * @param {object} trip            — trip frontmatter projection ({ _slug, title })
 * @param {object} plan            — parsed plan.yaml
 * @param {object} candidates      — parsed candidates.yaml ({ stops, lodging })
 * @param {Date}   [now]
 * @returns {string[] | null}
 */
export function tripToDailyVEvents(trip, plan, candidates, now = new Date()) {
  if (!plan || !Array.isArray(plan.days)) return null;
  const datedDays = plan.days.filter((d) => typeof d?.date === 'string' && d.date.trim());
  if (datedDays.length === 0) return null;

  const stopsById = new Map();
  for (const s of candidates?.stops ?? []) {
    if (s?.id) stopsById.set(s.id, s);
  }
  const lodgingById = new Map();
  for (const l of candidates?.lodging ?? []) {
    if (l?.id) lodgingById.set(l.id, l);
  }

  const title = trip.title || trip._slug;
  const dtstamp = nowToICalStamp(now);

  const events = [];
  for (const day of datedDays) {
    const start = new Date(`${day.date}T00:00:00Z`);
    if (isNaN(start.getTime())) continue;
    const end = new Date(start);
    end.setUTCDate(start.getUTCDate() + 1); // all-day events: DTEND = DTSTART + 1, exclusive

    // Resolve referenced candidates (skip dangling IDs silently).
    const dayStops = (day.stops ?? [])
      .map((id) => stopsById.get(id))
      .filter(Boolean);
    const dayLodging = day.lodging_id ? lodgingById.get(day.lodging_id) : null;

    // DESCRIPTION sections — each rendered only when its source data exists.
    const descParts = [];
    if (dayStops.length > 0) {
      const stopLines = dayStops.map((s) => `• ${s.name}${s.category ? ` (${s.category})` : ''}`).join('\n');
      descParts.push(`Stops:\n${stopLines}`);
    }
    if (dayLodging) {
      const lodgingLine = dayLodging.address
        ? `Lodging: ${dayLodging.name} — ${dayLodging.address}`
        : `Lodging: ${dayLodging.name}`;
      descParts.push(lodgingLine);
    }
    if (typeof day.notes === 'string' && day.notes.trim()) {
      descParts.push(day.notes.trim());
    }

    // LOCATION — lodging name+address, else first stop's address, else omitted.
    let location = '';
    if (dayLodging) {
      location = dayLodging.address
        ? `${dayLodging.name} — ${dayLodging.address}`
        : dayLodging.name;
    } else if (dayStops[0]?.address) {
      location = dayStops[0].address;
    }

    const lines = [
      'BEGIN:VEVENT',
      `UID:${trip._slug}-day${day.number}@traverse`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART;VALUE=DATE:${dateToICalDate(start)}`,
      `DTEND;VALUE=DATE:${dateToICalDate(end)}`,
      `SUMMARY:${escapeText(title)} · Day ${day.number}`,
    ];
    if (location) lines.push(`LOCATION:${escapeText(location)}`);
    if (descParts.length > 0) lines.push(`DESCRIPTION:${escapeText(descParts.join('\n\n'))}`);
    lines.push('END:VEVENT');
    events.push(lines.join(CRLF));
  }

  return events.length > 0 ? events : null;
}
```

- [ ] **Step 5: Run to verify all ics tests pass**

```
cd /home/evan/dev/traverse-trip-planner && npx vitest run tests/ics.test.js
```

Expected: PASS — new tests AND every existing test still green.

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/ics.js tests/ics.test.js
git commit -m "feat(ics): tripToDailyVEvents() per-day VEVENT generator (#405)"
```

---

### Task 4: `tripToIcs()` dispatcher

**Files:**
- Modify: `src/lib/server/ics.js`
- Modify: `tests/ics.test.js`

- [ ] **Step 1: Append failing tests for the dispatcher**

Append to `tests/ics.test.js`:

```js
// ── tripToIcs dispatcher (#405) ───────────────────────────────────────────

import { tripToIcs } from '../src/lib/server/ics.js';

describe('tripToIcs dispatcher', () => {
  const FROZEN = new Date('2026-06-02T12:00:00Z');

  test('returns null when neither per-day dates nor target_date are present', () => {
    const trip = { _slug: 't', title: 'T' };
    const plan = { days: [{ number: 1, stops: [] }] };
    const candidates = { stops: [], lodging: [] };
    expect(tripToIcs(trip, { plan, candidates }, FROZEN)).toBeNull();
  });

  test('emits per-day calendar when plan has any dated day', () => {
    const trip = { _slug: 't', title: 'T' };
    const plan = { days: [{ number: 1, date: '2026-07-04', stops: [] }] };
    const ics = tripToIcs(trip, { plan, candidates: { stops: [], lodging: [] } }, FROZEN);
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('UID:t-day1@traverse');
    expect(ics).toContain('END:VCALENDAR');
    // No trip-level UID (the bare slug@traverse) must appear.
    expect(ics).not.toMatch(/UID:t@traverse/);
  });

  test('falls back to trip-level VEVENT when no per-day dates but target_date present', () => {
    const trip = { _slug: 't', title: 'T', target_date: '2026-07-04', duration_days: 3 };
    const plan = { days: [{ number: 1, stops: [] }] };  // no day.date
    const ics = tripToIcs(trip, { plan, candidates: { stops: [], lodging: [] } }, FROZEN);
    expect(ics).toContain('UID:t@traverse');
    expect(ics).toContain('DTSTART;VALUE=DATE:20260704');
    expect(ics).toContain('DTEND;VALUE=DATE:20260707');
  });

  test('per-day path wins over trip-level fallback when both are available', () => {
    const trip = { _slug: 't', title: 'T', target_date: '2026-07-04', duration_days: 3 };
    const plan = { days: [{ number: 1, date: '2026-07-04', stops: [] }] };
    const ics = tripToIcs(trip, { plan, candidates: { stops: [], lodging: [] } }, FROZEN);
    expect(ics).toContain('UID:t-day1@traverse');
    expect(ics).not.toMatch(/UID:t@traverse[\r\n]/);
  });

  test('returns full ICS scaffold (BEGIN:VCALENDAR, METHOD, etc)', () => {
    const trip = { _slug: 't', title: 'T', target_date: '2026-07-04', duration_days: 1 };
    const ics = tripToIcs(trip, { plan: null, candidates: null }, FROZEN);
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('VERSION:2.0');
    expect(ics).toContain('PRODID:-//Traverse//Trip Planner//EN');
    expect(ics).toContain('CALSCALE:GREGORIAN');
    expect(ics).toContain('METHOD:PUBLISH');
    expect(ics).toContain('END:VCALENDAR');
  });

  test('omits options gracefully (plan / candidates may be missing)', () => {
    const trip = { _slug: 't', title: 'T', target_date: '2026-07-04', duration_days: 1 };
    expect(tripToIcs(trip, {}, FROZEN)).toContain('UID:t@traverse');
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```
cd /home/evan/dev/traverse-trip-planner && npx vitest run tests/ics.test.js -t "tripToIcs dispatcher"
```

Expected: FAIL — `tripToIcs` is not exported.

- [ ] **Step 3: Add `tripToIcs` dispatcher to `src/lib/server/ics.js`**

Append to `src/lib/server/ics.js` (after `tripsToIcs`, at the end of the file):

```js
/**
 * Dispatcher for the single-trip ICS endpoint (#405).
 *
 * Picks the per-day path when `plan` has at least one dated day; otherwise
 * falls back to the trip-level `tripToVEvent`. Returns a complete ICS
 * document string, or `null` when neither path yields any event.
 *
 * @param {object} trip
 * @param {{ plan?: object, candidates?: object }} [opts]
 * @param {Date} [now]
 * @returns {string | null}
 */
export function tripToIcs(trip, opts = {}, now = new Date()) {
  const { plan, candidates } = opts;
  const daily = tripToDailyVEvents(trip, plan, candidates, now);
  const events = daily ?? [];
  if (events.length === 0) {
    const fallback = tripToVEvent(trip, now);
    if (fallback) events.push(fallback);
  }
  if (events.length === 0) return null;
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Traverse//Trip Planner//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    ...events,
    'END:VCALENDAR',
    '',
  ].join(CRLF);
}
```

- [ ] **Step 4: Run to verify all ics tests pass**

```
cd /home/evan/dev/traverse-trip-planner && npx vitest run tests/ics.test.js
```

Expected: PASS — every ics test green (new dispatcher tests + per-day tests from Task 3 + existing legacy tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/ics.js tests/ics.test.js
git commit -m "feat(ics): tripToIcs() dispatcher with per-day/trip-level fallback (#405)"
```

---

## Phase 3 — Route handler

### Task 5: Update `/api/cal/[slug].ics` to use the dispatcher

**Files:**
- Modify: `src/routes/api/cal/[slug].ics/+server.js`

The current handler reads only `overview.md` frontmatter and calls `tripsToIcs([trip])`. The new behavior must also load `plan.yaml` + `candidates.yaml`, call `tripToIcs(trip, { plan, candidates })`, return 204 when the dispatcher returns null, and add a `Content-Disposition: attachment` header.

- [ ] **Step 1: Read the current handler to confirm imports**

```
cd /home/evan/dev/traverse-trip-planner && cat src/routes/api/cal/\[slug\].ics/+server.js
```

You should see the file from the spec context (imports from `data.js`, ad-hoc `findTripFrontmatter`).

- [ ] **Step 2: Replace the handler contents with the upgraded version**

Replace the entire contents of `src/routes/api/cal/[slug].ics/+server.js` with:

```js
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
```

- [ ] **Step 3: Verify svelte-check + tests pass**

```
cd /home/evan/dev/traverse-trip-planner && npm run verify
```

Expected: PASS. (If existing route tests for this endpoint exist, they may need a tweak — see Step 4.)

- [ ] **Step 4: Inspect / update route tests if present**

```
cd /home/evan/dev/traverse-trip-planner && ls tests/routes/ 2>/dev/null && grep -rln "cal/\[slug\]\|cal\.ics" tests/ 2>/dev/null
```

If there's an existing test file for this route, ensure it accommodates: 204 on no-dates, `Content-Disposition` presence, and the per-day path. If no test file exists, skip — the integration behavior is exercised by manual verification in Task 9.

- [ ] **Step 5: Smoke the endpoint locally**

```
cd /home/evan/dev/traverse-trip-planner && npm run dev -- --port 3499 &
DEVPID=$!
sleep 5
curl -s -o /dev/null -w 'HTTP %{http_code}\nContent-Type: %{content_type}\n' http://localhost:3499/api/cal/__definitely-not-a-real-slug.ics
kill $DEVPID 2>/dev/null
```

Expected: `HTTP 404`. Confirms the route is still mounted and slug validation works.

- [ ] **Step 6: Commit**

```bash
git add src/routes/api/cal/\[slug\].ics/+server.js
git commit -m "feat(api): /api/cal/[slug].ics uses tripToIcs dispatcher + Content-Disposition (#405)"
```

---

## Phase 4 — Kebab menu wiring

### Task 6: Conditional `Download .ics` entry in Output group

**Files:**
- Modify: `src/routes/trips/[slug]/+page.svelte`

- [ ] **Step 1: Find the existing `Output` group construction**

```
cd /home/evan/dev/traverse-trip-planner && grep -n "outputItems\|Output\|brochureHref\|kebabGroups" src/routes/trips/\[slug\]/+page.svelte | head -10
```

Confirm the existing structure around line 982: `outputItems = [ {brochure link}, {change cover photo} ]` then pushed into `groups`.

- [ ] **Step 2: Insert the conditional ICS entry**

In `src/routes/trips/[slug]/+page.svelte`, locate the existing `outputItems` array. After the brochure-link push (currently lines 988-996) and BEFORE the "Change cover photo" push (line 998), insert:

```js
    // ICS download — only available when the trip has any date info, either
    // per-day or trip-level. Hidden upfront when neither applies so a stale
    // tab doesn't trigger the endpoint's 204 path (#405).
    const planDays = data.plan?.days ?? [];
    const hasAnyDate = !!(
      trip.target_date ||
      planDays.some((d) => typeof d?.date === 'string' && d.date.trim())
    );
    if (hasAnyDate) {
      outputItems.push({
        type: 'link',
        label: '📅 Download .ics',
        href: `/api/cal/${encodeURIComponent(slug)}.ics`,
      });
    }
```

(The exact placement is between "View full brochure" and "Change cover photo" so the menu reads as: brochure → ICS → cover photo. Variable names — `slug`, `trip`, `data` — already exist in this scope; do not re-declare.)

- [ ] **Step 3: Verify svelte-check**

```
cd /home/evan/dev/traverse-trip-planner && npx svelte-check --fail-on-warnings
```

Expected: PASS.

- [ ] **Step 4: Visual smoke**

```
cd /home/evan/dev/traverse-trip-planner && npm run dev -- --port 3499 &
DEVPID=$!
sleep 5
```

Manually: open a planning trip with a `target_date` (or with per-day dates) in your browser at `http://localhost:3499/trips/<slug>` and confirm the `⋯` menu shows `📅 Download .ics` between "View full brochure" and "Change cover photo". Open a trip without any date info and confirm the entry is absent.

```
kill $DEVPID 2>/dev/null
```

- [ ] **Step 5: Commit**

```bash
git add src/routes/trips/\[slug\]/+page.svelte
git commit -m "ui(trip): add Download .ics entry to kebab Output group (#405)"
```

---

### Task 7: New `On the road` group with per-day Maps entries

**Files:**
- Modify: `src/routes/trips/[slug]/+page.svelte`

- [ ] **Step 1: Add the maps-links import**

Near the top of the `<script>` block in `src/routes/trips/[slug]/+page.svelte`, alongside existing `$lib/...` imports, add:

```js
  import { mapsDeepLinkSummary } from '$lib/utils/maps-links.js';
```

- [ ] **Step 2: Add the per-day group construction after the Output group**

In the `kebabGroups = $derived.by(() => { ... })` block, AFTER the existing `const groups = [{ label: 'Output', items: outputItems }];` line (around line 1004) and BEFORE the existing field-guide / lifecycle / activity group constructions, insert:

```js
    // "On the road" group — one Maps deep link per day with usable stops.
    // Hidden as a whole when no day has any waypoint we can encode (#405).
    const stopsById = new Map(
      (data.candidates?.stops ?? []).map((s) => [s.id, s]),
    );
    const onTheRoadItems = [];
    for (const day of planDays) {
      const dayStops = (day.stops ?? [])
        .map((id) => stopsById.get(id))
        .filter(Boolean);
      const summary = mapsDeepLinkSummary(dayStops);
      if (!summary?.url) continue;
      const truncationHint = summary.truncated
        ? ` (first ${summary.waypointCount} stops)`
        : '';
      onTheRoadItems.push({
        type: 'link',
        label: `🗺 Day ${day.number} in Maps ↗${truncationHint}`,
        href: summary.url,
        target: '_blank',
        rel: 'noopener',
      });
    }
    if (onTheRoadItems.length > 0) {
      groups.push({ label: 'On the road', items: onTheRoadItems });
    }
```

Notes:
- `planDays` was introduced in Task 6 in the same `$derived.by()` scope. Reuse it; do NOT redeclare.
- This block must run AFTER `outputItems` is fully populated and pushed (so the group order is Output → On the road → ...).

- [ ] **Step 3: Verify svelte-check**

```
cd /home/evan/dev/traverse-trip-planner && npx svelte-check --fail-on-warnings
```

Expected: PASS.

- [ ] **Step 4: Visual smoke**

```
cd /home/evan/dev/traverse-trip-planner && npm run dev -- --port 3499 &
DEVPID=$!
sleep 5
```

Open a planning trip with stops promoted into days. Open the `⋯` menu. Confirm:

- An `On the road` section appears below `Output`.
- Each day with at least one promotable stop has its own entry: `🗺 Day N in Maps ↗`.
- Days with zero stops are absent (not shown as disabled).
- Clicking one opens Google Maps in a new tab with the day's stops as waypoints.
- A trip with NO stops promoted to any day shows no `On the road` section at all.

```
kill $DEVPID 2>/dev/null
```

- [ ] **Step 5: Run the full verify**

```
cd /home/evan/dev/traverse-trip-planner && npm run verify
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/routes/trips/\[slug\]/+page.svelte
git commit -m "ui(trip): On the road group with per-day Maps deep links (#405)"
```

---

## Phase 5 — CHANGELOG + final verify

### Task 8: CHANGELOG entry

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Read the current CHANGELOG top**

```
cd /home/evan/dev/traverse-trip-planner && head -30 CHANGELOG.md
```

Find the existing `## [Unreleased] — v0.1.2` section (added during #403). Append to its existing `### Added` group rather than creating a duplicate.

- [ ] **Step 2: Append the new entry under `### Added`**

Add this entry to the existing `### Added` group under `## [Unreleased] — v0.1.2`:

```markdown
- **Trip export formats** (#405). Two new outputs surface in the trip detail
  page's `⋯` menu beyond the print brochure:
  - **📅 Download .ics** — one calendar event per day when the plan has
    dated days, anchored to each day's date. Falls back to a single
    trip-level event when only `target_date` is set. Hidden when neither
    applies.
  - **🗺 Day N in Maps ↗** — one Google Maps deep link per day with
    promoted stops, routing through the day's stops in order. Opens in a
    new tab (or the Maps app on iOS/Android). Disposable, in-trip useful.
```

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs(changelog): trip export formats (#405)"
```

---

### Task 9: Manual verification + final verify

- [ ] **Step 1: Run the full verify suite**

```
cd /home/evan/dev/traverse-trip-planner && npm run verify
```

Expected: PASS — svelte-check clean, all tests green, build successful.

- [ ] **Step 2: Manual end-to-end exercise**

```
cd /home/evan/dev/traverse-trip-planner && npm run dev -- --port 3499 &
DEVPID=$!
sleep 5
```

Open `http://localhost:3499` and walk through:

1. **Planning trip with `target_date` only (no per-day dates).** Open the `⋯` menu. Verify `📅 Download .ics` is present. Click it. The downloaded `.ics` should open in a calendar app and show a single all-day event spanning `duration_days`.

2. **Planning trip with per-day dates on `plan.yaml` days.** If no such trip exists, hand-edit a `plan.yaml` to add `date: 2026-07-04` to a day. Reload. Click `📅 Download .ics`. The downloaded file should contain one VEVENT per dated day with `UID:<slug>-day<N>@traverse`.

3. **Trip without any dates anywhere.** New idea, or planning trip with no `target_date` and no per-day dates. Verify the `📅 Download .ics` entry is ABSENT from the `⋯` menu.

4. **Maps deep links.** On a planning trip with stops promoted to days, open the `⋯` menu. Verify the `On the road` group appears with one entry per day with stops. Click `🗺 Day 1 in Maps ↗` — Google Maps opens in a new tab with that day's stops as waypoints in order.

5. **Empty plan.** Planning trip with stops in the candidates pool but none promoted to any day. Verify the `On the road` group is absent.

6. **Day with one stop.** A day with exactly one stop. Verify the Maps URL opens with that one waypoint and Maps lets the user add their current location as origin.

7. **Cap behavior.** If you have a day with >11 stops, verify the menu label includes `(first 11 stops)` and the URL contains exactly 11 waypoints.

8. **Mobile.** Open the same trip on a phone. Verify `🗺 Day N in Maps ↗` opens the native Maps app via OS-level deep-link routing.

9. **Completed trip.** Mark a trip completed (or open an existing completed one). Verify both `📅 Download .ics` and the `On the road` group are still available.

10. **Browser download flow.** When clicking `📅 Download .ics`, confirm the browser downloads the file rather than rendering it inline. (The new `Content-Disposition: attachment` header enforces this.)

```
kill $DEVPID 2>/dev/null
```

- [ ] **Step 3: Push and open PR**

```bash
git push -u origin <branch-name>
gh pr create --title "Trip export formats: per-day ICS + Maps deep links (#405)" --body "$(cat <<'EOF'
## Summary
- Upgrades \`/api/cal/[slug].ics\` to emit one VEVENT per dated day (from \`plan.yaml\`). Falls back to the existing single-VEVENT-per-trip behavior when only \`target_date\` is set. Returns 204 when no dates anywhere. Adds \`Content-Disposition: attachment\`.
- Adds \`src/lib/utils/maps-links.js\` with pure URL builders for Google Maps deep links (\`mapsDeepLinkSummary\`, \`mapsDirectionsUrl\`, \`stopToWaypoint\`). Caps URLs at 11 waypoints (Maps URL API limit). Stops-only routing — no origin/destination, no home_coords / lodging dependencies.
- Trip detail page's \`⋯\` menu gains a conditional \`📅 Download .ics\` entry in the existing Output group, plus a new \`On the road\` group with one \`🗺 Day N in Maps ↗\` entry per day with promoted stops.

Implements [\`docs/superpowers/specs/2026-06-02-export-formats-design.md\`](docs/superpowers/specs/2026-06-02-export-formats-design.md). Closes #405.

## Test plan
- [ ] \`npm run verify\` (svelte-check + tests + build)
- [ ] ICS: planning trip with per-day dates → .ics file has one VEVENT per dated day
- [ ] ICS: trip with target_date only → .ics file has the existing single VEVENT (unchanged behavior)
- [ ] ICS: trip with no dates → menu entry hidden; direct curl returns 204
- [ ] Maps: each day with promoted stops shows a Maps entry; opening it routes through the day's stops
- [ ] Maps: trip with no promoted stops → entire \`On the road\` group hidden
- [ ] Mobile: \`🗺 Day N in Maps ↗\` opens the Maps app via OS-level deep link
- [ ] Completed trip: both exports remain available
- [ ] Browser downloads .ics rather than rendering inline (Content-Disposition header working)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review

(Run before handing to executor.)

**Spec coverage check:**

| Spec section | Implementing tasks |
|---|---|
| Data model — none required | n/a |
| ICS endpoint behavior (per-day, fallback, 204) | Tasks 3, 4, 5 |
| ICS per-day VEVENT shape (UID, SUMMARY, DESCRIPTION, LOCATION, etc) | Task 3 |
| ICS Content-Disposition header | Task 5 |
| Maps URL shape (`api=1`, stops-only) | Task 2 |
| Per-stop encoding (coords → address → name) | Task 1 |
| 11-waypoint cap with truncation hint | Tasks 2, 7 |
| Edge cases (0 stops, 1 stop, missing fields) | Tasks 1, 2, 7 |
| Kebab menu wiring (Output group + On the road group) | Tasks 6, 7 |
| Visibility rules (hasAnyDate, hidden when no Maps URLs) | Tasks 6, 7 |
| Page data wiring (verify plan + candidates flow) | Already in `+page.server.js:32-33`; no task needed |
| ICS unit tests (per-day cases, dispatcher cases) | Tasks 3, 4 |
| Maps-links unit tests | Tasks 1, 2 |
| Manual verification checklist | Task 9 |
| Open implementation questions | All resolved inline per spec leans |
| CHANGELOG entry | Task 8 |

No gaps. The spec called out a verification step on `+page.server.js` — confirmed during exploration that `plan` and `candidates` already land on `data`, so no separate task.

**Placeholder scan:** no "TBD", "TODO", "fill in details", or "similar to" references. Every code step has complete code.

**Type consistency:**

- `tripToDailyVEvents(trip, plan, candidates, now)` — same signature in Tasks 3 and 4.
- `tripToIcs(trip, { plan, candidates }, now)` — consistent between Task 4 (definition) and Task 5 (caller).
- `stopToWaypoint`, `mapsDirectionsUrl`, `mapsDeepLinkSummary` — exports defined in Tasks 1, 2 and consumed in Task 7.
- `planDays` derived var introduced in Task 6 is reused (not redeclared) in Task 7's insertion block.
- Day field names (`number`, `date`, `stops`, `lodging_id`, `notes`) match `src/lib/server/plan.js` parsing convention confirmed during exploration.

One soft spot to watch during implementation: in Task 5, the `findTripWithStage` helper is named differently from the existing `findTripFrontmatter`. This is intentional — the original didn't return stage. If you want to merge them into one, do so as part of Task 5 (not its own commit). Keep the surface minimal.

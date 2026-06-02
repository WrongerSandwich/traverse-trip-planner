# Export formats: per-day ICS + Google Maps deep links (design)

**Date:** 2026-06-02
**Issue:** [#405](https://github.com/WrongerSandwich/traverse-trip-planner/issues/405)
**Milestone:** v0.1.2 In-trip companion
**Status:** Draft — pending plan + implementation

## Problem

The brochure answers "what does the whole trip look like as one artifact." It's print-optimized and assumes the user wants the trip in front of them on paper. The "in-trip companion" milestone calls for shapes that answer different on-the-road questions:

- A user who plans on their phone wants the trip's days to appear in their normal calendar so dates don't slip through the cracks.
- A user who's actually driving wants a one-tap link that opens today's stops in Maps with directions ready to go.

These are different surfaces of the same plan + candidates data. No data model change is needed — this is an output-surface question.

## Scope

**In scope (v0.1.2):**

- **Per-day ICS upgrade** — the existing `/api/cal/[slug].ics` endpoint emits one VEVENT for the whole trip. Upgrade to one VEVENT per day when `plan.yaml` has dated days. Trip-level fallback preserved for trips that have `target_date` but no per-day dates.
- **Google Maps deep links per day** — one per-day URL that opens today's stops in Google Maps with directions ready to go. No new endpoint; URLs are generated client-side from existing page data.
- **Kebab-menu integration** — both formats surface through entries in the trip detail page's `⋯` menu.

**Out of scope (deferred to a later spec):**

- GPX / KML export (niche audience; revisit when there's demand)
- Markdown digest export (low complexity, but no current pull)
- Single-page offline HTML export (overlaps with brochure; revisit if mobile-without-printing becomes a stated need)
- Per-trip subscription URLs (the all-trips collection feed at `/api/cal.ics` already exists)
- Travel-mode picker for Maps URLs (driving only, no UI affordance)
- Lodging-anchored Maps routing (origin/destination from home/lodging) — rejected in favor of stops-only routing for in-trip simplicity

## Approach summary

| Layer | Change |
|---|---|
| **Data** | None. Both formats project over existing `plan.yaml` + `candidates.yaml` + overview frontmatter. |
| **ICS server** | Extend `src/lib/server/ics.js` with `tripToDailyVEvents(trip, plan, candidates)`. Existing `tripToVEvent` and `tripsToIcs` unchanged. |
| **ICS route** | `/api/cal/[slug].ics` loads `plan.yaml` + `candidates.yaml`, picks per-day vs trip-level path, adds `Content-Disposition` for download. |
| **Maps links** | New `src/lib/utils/maps-links.js` with pure URL constructors. No server endpoint; consumed directly by the kebab menu construction. |
| **UI** | New entries in the trip detail page's `⋯` menu (`+page.svelte`): one for `.ics` download, one per day for Maps. |

## Architecture

Both formats are server-rendered (ICS) or client-constructed (Maps URLs) at request time. No AI, no caching, no client-side render path beyond URL building. Mirrors the brochure derivation pattern.

### Shared data shape

Both formats consume the same small projection over plan + candidates + frontmatter. The projection is built inline at each consumer (small, no shared helper needed yet — extract to `src/lib/server/derive-days.js` later only if a third consumer makes it duplicative).

Per dated day with at least one stop:
```js
{
  number,          // day number from plan.yaml
  date,            // ISO YYYY-MM-DD, or null when day has no date
  stops: [
    { name, address, coords }   // candidates pool projection
  ],
  lodging,         // resolved candidate, or null
  notes,           // free text
}
```

Trip-level fields:
```js
{ slug, title, target_date, duration_days, destination }
```

---

## Format 1: ICS calendar (per-day upgrade)

### Endpoint

`GET /api/cal/[slug].ics` — same path as today, behavior upgraded.

### Behavior

Three-level graceful degradation, picked in order:

1. **Per-day dates present** (any day in `plan.yaml` has a `date` field) → emit one VEVENT per dated day. Days without dates are skipped.
2. **Trip-level `target_date` only** (no per-day dates) → fall back to existing single-VEVENT behavior. Unchanged from today.
3. **Neither** → return 204 No Content. The kebab menu entry is hidden when this case applies, so a user with a stale tab gets a graceful empty response rather than a corrupt file.

### Headers

Add `Content-Disposition: attachment; filename="<slug>.ics"` to all responses. The current endpoint omits it, so today's behavior renders the file inline in most browsers — the upgrade enforces download.

The `Content-Type: text/calendar; charset=utf-8` header stays. The collection feed at `/api/cal.ics` is unchanged — it stays trip-level for performance and to avoid noisy expansion across every planning trip.

### Per-day VEVENT shape

For each day with a `date`:

```
BEGIN:VEVENT
UID:<slug>-day<N>@traverse
DTSTAMP:<now in UTC YYYYMMDDTHHMMSSZ>
DTSTART;VALUE=DATE:<YYYYMMDD>
DTEND;VALUE=DATE:<YYYYMMDD+1>          # exclusive per RFC 5545
SUMMARY:<trip title> · Day <N>
DESCRIPTION:<escaped multi-line description, see below>
LOCATION:<lodging name + address, else first stop's address, else omitted>
END:VEVENT
```

**SUMMARY** — `<trip title> · Day <N>`. Predictable, deduplicates well in calendar app rendering. `plan.days[i].theme` is not a field today; the format can extend if it's added later (`<title> · Day N: <theme>`).

**DESCRIPTION** — newline-joined (ICS-escaped) summary of the day's content:

```
Stops:
• Sleeping Bear Dunes (outdoors)
• Dune Climb (view)
• Pierce Stocking Drive (view)

Lodging: Riverbend Inn — 9922 Front St, Empire MI

Sunset is the move tonight.
```

Empty sections are omitted entirely rather than rendered as headings with nothing under them.

**LOCATION** — resolves from `day.lodging_id` lookup in candidates → first stop's address → field omitted. Helps calendar apps that show a small map preview alongside the event.

**UID stability** — `<slug>-day<N>@traverse` means re-importing the same calendar file updates existing events rather than duplicating them. If a day is added or removed, the UID set changes naturally and calendar apps handle the diff cleanly.

### ICS escaping

The existing `escapeText()` helper in `ics.js` handles `\\`, `;`, `,`, and CRLF/LF → `\\n`. Reuse for all per-day text fields.

### `ics.js` module structure after the change

| Export | Status | Responsibility |
|---|---|---|
| `tripToVEvent(trip, now)` | Unchanged | Single trip-level VEVENT (existing behavior). |
| `tripsToIcs(trips)` | Unchanged | Collection feed wrap of `tripToVEvent`. |
| `tripToDailyVEvents(trip, plan, candidates, now)` | **New** | Returns an array of per-day VEVENT strings, or `null` when no day has a date. |
| `tripToIcs(trip, { plan, candidates }, now)` | **New** | Dispatcher: picks per-day path when available, else falls back to `tripToVEvent`. Returns a complete ICS document string, or `null` when both paths return nothing. |

The route handler at `/api/cal/[slug].ics` calls the new `tripToIcs(trip, { plan, candidates })`. The collection feed at `/api/cal.ics` keeps calling `tripsToIcs`.

---

## Format 2: Google Maps deep links

### URL shape

Google Maps directions URL with the `api=1` parameter (documented Maps URL API):

```
https://www.google.com/maps/dir/?api=1&waypoints=<wp1>|<wp2>|<wp3>&travelmode=driving
```

No `origin`, no `destination` — Maps prompts the user for current location once the URL loads. This matches the in-trip use case ("open today's stops in Maps") and avoids dependencies on optional fields like home_coords or per-day lodging.

### Per-stop encoding

Prefer `coords` (most reliable), fall back to `address`, fall back to `name`:

```js
function stopToWaypoint(stop) {
  if (Array.isArray(stop.coords) && stop.coords.length === 2) {
    return `${stop.coords[0]},${stop.coords[1]}`;
  }
  if (stop.address) return stop.address;
  return stop.name ?? null;
}
```

Coord encoding `lat,lng` is what Maps treats as exact-point waypoints. Address/name strings get geocoded by Maps client-side, which can occasionally land on the wrong location but is acceptable as a fallback.

### Waypoint cap

Google Maps allows up to 9 waypoints plus origin/destination per URL — 11 total when origin/destination are omitted (the case here). We cap at 11 and surface a truncation indicator in the menu label (`first 11 stops`). Real trips rarely hit this, but the cap prevents a silently broken URL.

### Edge cases

| Case | Behavior |
|---|---|
| Day has 0 stops | No menu entry for that day. Hidden, not disabled. |
| Day has 1 stop | Menu entry still appears. URL with a single waypoint opens that place; Maps lets the user add their current location as origin. |
| Day has >11 stops | Cap at 11. Menu label includes `(first 11 stops)`. |
| Promoted stop ID with no matching candidate | Skipped silently. Same defensive pattern as `deriveBrochure`. |
| Stop has none of coords / address / name | Skipped from the URL. If all stops on a day fail, that day is hidden from the menu. |

### Module structure

New module `src/lib/utils/maps-links.js`. Pure functions, no Svelte dependencies. Three exports:

| Export | Returns | Notes |
|---|---|---|
| `stopToWaypoint(stop)` | `string \| null` | Encoded waypoint per the rules above. |
| `mapsDirectionsUrl(stops, { travelMode = 'driving' } = {})` | `string \| null` | Assembled URL with the 11-waypoint cap applied. Returns `null` when no usable waypoints. |
| `mapsDeepLinkSummary(stops)` | `{ url, waypointCount, truncated } \| null` | Convenience wrapper that the menu uses to render the `(first N stops)` indicator. |

Parallels the existing `src/lib/utils/links.js` from #403.

---

## Kebab menu wiring

Both formats slot into the existing `⋯` menu on the trip detail page (`+page.svelte:982-1004`). The Maps per-day entries get their own group.

### Group structure after the change

```
Output
  ↗ View full brochure
  📅 Download .ics                  ← new (visibility-gated)
  🖼 Change cover photo…

On the road                          ← new group, conditional
  🗺 Day 1 in Maps ↗
  🗺 Day 2 in Maps ↗
  ...
```

### Visibility rules

**`📅 Download .ics`** appears in `outputItems` only when the trip has any date info:

```js
const planDays = data.plan?.days ?? [];
const hasAnyDate = !!(trip.target_date || planDays.some(d => d.date));
if (hasAnyDate) {
  outputItems.push({
    type: 'link',
    label: '📅 Download .ics',
    href: `/api/cal/${encodeURIComponent(slug)}.ics`,
  });
}
```

The endpoint sets `Content-Disposition: attachment`, so the browser downloads via standard handling.

**`🗺 Day N in Maps ↗`** entries are built per day with `mapsDeepLinkSummary`:

```js
const candidatesLookup = new Map(
  (data.candidates?.stops ?? []).map(s => [s.id, s])
);
const onTheRoadItems = [];
for (const day of planDays) {
  const dayStops = (day.stops ?? [])
    .map(id => candidatesLookup.get(id))
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

The kebab construction runs in `$derived.by()` so it re-computes when `data` changes. Reorders, promotions, and address edits surface in the URL on the next render.

### Page data wiring

The trip detail page's `+page.server.js` already loads `plan.yaml` and `candidates.yaml` (for the Plan/Candidates UI). Verify they're passed through to the client as `data.plan` and `data.candidates`. If not, that's a one-line pass-through in the spec's implementation.

### Completed trips

Both export entries stay available. ICS export of a completed trip is useful as historical record; Maps links remain usable for re-visiting. No special completed-trip branching.

### Mobile

The kebab already works on touch. New items are plain `<a href>` links — Maps URLs open the Maps app via OS-level deep-link routing on iOS/Android. No special handling.

### Accessibility

Reuses KebabMenu's existing `role="menuitem"` markup. Each link gets an `aria-label` matching the visible label.

---

## Testing

### Unit tests

**Extend `tests/ics.test.js`:**

- `tripToDailyVEvents` returns an array when plan has dated days
- `tripToDailyVEvents` returns `null` when no day has a date
- Per-day SUMMARY format is `<title> · Day N`
- Per-day DESCRIPTION lists stops, lodging, notes
- DESCRIPTION sections empty when source data is empty
- LOCATION resolves from lodging → first stop → omitted
- UID stability: same input → same UIDs (re-import case)
- DESCRIPTION newlines correctly ICS-escaped (`\\n`)
- `tripToIcs` dispatcher picks per-day path when available
- `tripToIcs` falls back to trip-level when only `target_date` is present
- `tripToIcs` returns `null` when neither dates path applies
- Existing `tripToVEvent` and `tripsToIcs` behavior unchanged

**New `tests/maps-links.test.js`:**

- `stopToWaypoint`: coords preferred → address fallback → name fallback → `null`
- `mapsDirectionsUrl`: assembles correctly with 1, 5, 11 stops
- 12+ stops → truncates to 11 with `truncated: true`
- `mapsDeepLinkSummary` returns `{ url, waypointCount, truncated }`
- Empty stops array → returns `null`
- URL parts properly encoded (`|`, `,`, spaces, special chars)

### Route handler test

If the existing `/api/cal/[slug].ics` route has a sibling test, extend it: per-day path, fallback path, 204 path, `Content-Disposition` header presence. Otherwise skip and rely on manual verification.

### Manual verification

- Open a planning trip with a multi-day plan and target dates → kebab `Output` group shows `Download .ics`; `On the road` group shows one entry per day with stops; entries open Maps in a new tab.
- Open a planning trip with target_date but no per-day dates → `Download .ics` appears; `.ics` file contains one VEVENT for the whole trip (unchanged from today).
- Open a brand-new idea (no plan) → kebab shows neither ICS nor Maps entries.
- Open a completed trip → both export options remain available.
- Tap a Maps entry on mobile → opens the Maps app via OS-level deep link.
- Click `Download .ics` → browser downloads (doesn't render inline).

### Standard CI gates

`npm run verify` (svelte-check + tests + build) is the go/no-go. `npm run smoke` is not affected — no new `chat()` call sites.

---

## Open implementation questions

To resolve during the plan or implementation, not before:

1. **Per-day expansion location** — extend `ics.js` with `tripToDailyVEvents` and a `tripToIcs` dispatcher; keep `tripToVEvent` and `tripsToIcs` intact. *Lean: extend.*
2. **SUMMARY format** — `<trip title> · Day N` chosen. If `plan.days[i].theme` is added later, format extends gracefully. *No action now.*
3. **Travel mode** — driving only. No UI affordance for walking/cycling/transit. *Revisit if users ask.*
4. **Single-trip subscription URL** — out of scope. The all-trips feed exists; per-trip subscription is a different use case. *Defer.*
5. **Content-Disposition filename** — `<slug>.ics`. URL-safe, predictable. *Lean: slug; revisit if users push for the title.*
6. **Brochure-page duplication of Maps links** — out of scope here. The brochure is the print artifact; export formats are parallel surfaces. *Don't duplicate.*

---

## Files touched (anticipated)

**New:**

- `src/lib/utils/maps-links.js`
- `tests/maps-links.test.js`

**Modified:**

- `src/lib/server/ics.js` — add `tripToDailyVEvents()` + `tripToIcs()` dispatcher
- `src/routes/api/cal/[slug].ics/+server.js` — load plan + candidates, call dispatcher, add `Content-Disposition`
- `src/routes/trips/[slug]/+page.server.js` (verify) — confirm `data.plan` + `data.candidates` flow to client
- `src/routes/trips/[slug]/+page.svelte` — extend `kebabGroups` derived
- `tests/ics.test.js` — per-day VEVENT cases
- `CHANGELOG.md` — v0.1.2 entry

**Not touched:**

- `/api/cal.ics` (collection feed) — stays trip-level
- `Brochure.svelte`, `derive-brochure.js` — parallel output, no overlap
- `home.md` schema — no `home_coords` dependency (stops-only routing)

---

## Related issues

- **#403** — per-stop metadata. The `address` field landed in v0.1.2 is the fallback used by Maps URL waypoint encoding when `coords` are missing.
- **#406** — per-stop to-dos. Will surface a different shape of the same plan data. Doesn't block this work; both can co-exist as independent surfaces.
- **#436** — chat() per-turn telemetry. Unrelated; mentioned here only because it's the other v0.1.2 work in flight.

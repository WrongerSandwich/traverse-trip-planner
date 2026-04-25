---
home_city: Overland Park, KS
home_coords: [38.98, -94.67]
travelers: [evan, erika]
vehicles:
  rav4:
    model: 2019 Toyota RAV4
    type: gas
    default: true
    notes: Preferred for road trips — more cargo, no charging constraints.
  bolt:
    model: 2023 Chevy Bolt EUV
    type: ev
    range_mi: 247
    dc_fast_charge_kw: 55
    notes: Weekend trips where the charging plan is clean.
pets_need_sitter: true
default_radius_mi: 450
units:
  distance: mi
---

# Personal context for trip planning

This file holds user-specific preferences and constraints. Slash commands read the frontmatter above for structured values and the prose below for taste and nuance.

## Travelers and logistics

- Primary travelers: Evan and Erika (partner). Solo trips and guest travelers are both possible — note them per-trip.
- Pets: two cats, Goose and Bean. Any overnight trip needs a sitter; Terra is the usual.
- Sitter logistics are a real cost/coordination constraint — factor them into multi-night trip decisions, not just "do we need one."

## Vehicle notes

Two vehicles in the household; the RAV4 is the default for road trips. Trips may set `vehicle: bolt` in frontmatter to override. No specific notes for the RAV4 — it's the low-friction option.

### Bolt-specific guidance

*Only applies when `vehicle: bolt` is set on a trip.*

~247mi EPA range, but DC fast-charging is slow (~55kW max), which is the binding constraint on longer trips.

- For any trip >~200mi one-way, plan `charging_stops` explicitly.
- Prefer lodging with L2 overnight charging.
- Budget ~45 min per DC fast-charge stop.
- Note specific stations (Electrify America, EVgo), not just cities.
- Accumulate known weak corridors here as they're encountered — this section should get richer over time.

## Distance and duration heuristics

| Format                 | Drive each way | Approx radius |
| ---------------------- | -------------- | ------------- |
| One-night (Sat–Sun)    | 2–3 hrs        | ~150 mi       |
| Two-night (Fri–Sun)    | 3–5 hrs        | ~300 mi       |
| Long weekend (Thu–Sun) | 5–7 hrs        | ~450 mi       |
| Week+                  | Vacation mode  | —             |

These are starting heuristics, not rules. Update as real trips validate or break them.

## Weekly constraints

Recurring commitments that shape trip windows:
- Monday: Drunk Orchestra
- Tuesday: DnD
- Wednesday: Civ VII LAN party

Default trip window is Friday evening through Sunday. Thursday departures viable with notice.

## Seasonal notes

- **Spring (Apr–May):** Ozarks wildflowers; pleasant most regions
- **Summer (Jun–Aug):** Avoid anywhere hot/humid; favor Great Lakes, higher elevation, or water
- **Fall (Sep–Oct):** Peak season for most regional trips
- **Winter (Nov–Mar):** Cities fine (St Louis, Chicago, Omaha); avoid mountains

## Trip profile — what makes a good one

This section is the main driver of `/seed`. Update as real trips teach you what you actually like vs. what you thought you would.

**Tends to like:**
- Scenic drives, not just destinations. The route is the trip.
- Small quirky towns over tourist hubs (Eureka Springs > Branson).
- Historic and architectural interest — bathhouses, old hotels, weird museums.
- Natural features with reasonable walking access, not expedition hiking.
- Live music, local venues, independent bookstores.
- Food scenes worth driving to (Lawrence, Bentonville, Tulsa).

**Tends to avoid:**
- Pure tourist traps.
- Shopping-centric destinations.
- High-season crowds; prefer shoulder seasons.
- Chain-hotel-strip-mall corridors with nothing around them.

## Notes on completed trips

(To be filled in as trips move to `completed/`. Use this section for cross-trip patterns — "we always over-pack for X," "lodging within walking distance of downtown is non-negotiable," etc.)

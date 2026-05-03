---
home_city: Your City, ST
home_coords: [0.0, 0.0]        # lat/lon decimal — used for drive-time estimates
travelers: [you]               # list of traveler names/handles
vehicles:
  car:
    model: Your Car (Year)
    type: gas                  # gas | ev
    default: true
    notes: ""
# EV example (uncomment and fill in if applicable):
# ev:
#   model: Your EV (Year)
#   type: ev
#   range_mi: 250
#   dc_fast_charge_kw: 150
#   notes: ""
pets_need_sitter: false        # true if pets require a sitter for overnight trips
default_radius_mi: 400         # default max one-way drive distance for trip ideas
units:
  distance: mi
---

# Personal context for trip planning

This file drives all AI features — seed, research, chat, and itinerary generation. Fill it
in honestly; the more specific you are, the better the suggestions. See the sections below
as prompts, not rigid structure — add, remove, or rewrite freely.

## Travelers and logistics

- Primary travelers: [your name(s)]. Note solo vs. group trips per-trip.
- Pets: [describe pets and sitter situation, or remove this line]

## Vehicle notes

[Describe your vehicle(s) and any trip-relevant quirks — cargo space, towing, EV charging
constraints, etc. If you have multiple vehicles, note which you default to for road trips.]

## Distance and duration heuristics

| Format                 | Drive each way | Approx radius |
| ---------------------- | -------------- | ------------- |
| One-night (Sat–Sun)    | 2–3 hrs        | ~150 mi       |
| Two-night (Fri–Sun)    | 3–5 hrs        | ~300 mi       |
| Long weekend (Thu–Sun) | 5–7 hrs        | ~450 mi       |
| Week+                  | Vacation mode  | —             |

Adjust these to match your actual tolerance for driving.

## Weekly constraints

[List recurring commitments that affect your trip windows, e.g.:]
- Monday: [commitment]
- Tuesday: [commitment]

Default trip window: [e.g., Friday evening through Sunday]

## Seasonal notes

[Describe how seasons affect your travel — heat tolerance, activities you prefer per season,
regions to avoid at certain times, etc.]

## Trip profile — what makes a good one

**Tends to like:**
- [Describe the kinds of trips, destinations, and experiences you enjoy]

**Tends to avoid:**
- [Describe what you don't enjoy or want to filter out]

## Notes on completed trips

(Fill in as trips move to `completed/`. Use this for cross-trip patterns you notice over time.)

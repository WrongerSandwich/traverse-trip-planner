License attribution:
# Geographic data

## us-states.json

GeoJSON of US state boundaries (50 states + DC + Puerto Rico). Sourced from
[PublicaMundi/MappingAPI](https://github.com/PublicaMundi/MappingAPI), which
derives from public US Census Bureau cartographic boundary files (public domain).

Used by `PaperMap.svelte` as a terrain backdrop for brochure illustrations.

## na-rivers.json

GeoJSON of major North American rivers (96 features), filtered from
[Natural Earth's 1:50m rivers + lake centerlines](https://www.naturalearthdata.com/downloads/50m-physical-vectors/50m-rivers-lake-centerlines/)
to a Mexico–Canada / Pacific–Atlantic bbox. Natural Earth is public domain.

Used as a terrain layer in `PaperMap.svelte` and `DestinationMap.svelte`.
Per-feature `properties.min_zoom` and `properties.name` are preserved so
features can be filtered by zoom level (smaller streams hidden at lower
detail) and labeled in italic Fraunces inline when desired.

## na-places.json

GeoJSON of North American populated places (1218 features, ~155KB),
filtered from
[Natural Earth's 1:10m populated_places_simple](https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-populated-places/)
to a Mexico–Canada / Pacific–Atlantic bbox. Properties stripped to
just `name` + `scalerank`; coordinates rounded to 4dp (~10m). Natural
Earth is public domain.

`scalerank` lets callers filter by importance: 0–4 are major cities
(NYC, LA, Chicago…); 5–7 are regional centers; 8–10 are small towns.
Used as terrain detail on `DestinationMap.svelte` and optionally on
the regional route map.

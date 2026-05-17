// Map marker / accent color per lifecycle stage. Hexes track the brand
// palette in src/app.css — idea→sky-400, planning→sunset-600, completed→forest-800.
// Chosen for hue + luminance spread so stages remain distinct on OSM tiles
// and under color-vision deficiency. See
// docs/superpowers/specs/2026-05-17-trip-stage-visual-clarity-design.md.
export const STATUS_COLOR = {
  idea:      '#5B7E92', // sky-400 — cool, sketchy, far-off
  planning:  '#D87B3F', // sunset-600 — warm, active, in-flight
  completed: '#1F4332', // forest-800 — deep, rooted, settled
};

/** Returns the marker/accent color for a trip object. */
export function tripColor(trip) {
  return STATUS_COLOR[trip?.status || trip?._stage] || '#9A8A6F';
}

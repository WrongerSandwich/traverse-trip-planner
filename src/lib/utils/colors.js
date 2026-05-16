// Map marker / accent color per lifecycle stage. Hexes track the brand
// palette in src/app.css — idea→sky-600, planning→forest-800, completed→bark-600.
export const STATUS_COLOR = {
  idea:      '#3D5A6E',
  planning:  '#1F4332',
  completed: '#5C4031',
};

/** Returns the marker/accent color for a trip object. */
export function tripColor(trip) {
  return STATUS_COLOR[trip?.status || trip?._stage] || '#9A8A6F';
}

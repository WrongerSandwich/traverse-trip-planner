export const STATUS_COLOR = {
  idea: '#1e40af',
  exploring: '#c2570a',
  planning: '#166534',
  completed: '#6d28d9',
};

/** Returns the marker/accent color for a trip object. */
export function tripColor(trip) {
  return STATUS_COLOR[trip?.status || trip?._stage] || '#888';
}

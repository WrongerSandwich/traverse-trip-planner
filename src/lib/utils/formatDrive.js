/**
 * Format `_drive_hours` as a short human label, e.g. 4.5 → "4.5 hr", 4 → "4 hr".
 * Returns null when input is null/undefined so callers can skip the chip entirely.
 */
export function formatDriveLabel(hours) {
  if (hours == null) return null;
  return `${hours % 1 === 0 ? hours : hours.toFixed(1)} hr`;
}

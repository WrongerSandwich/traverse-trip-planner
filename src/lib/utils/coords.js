// Parse a user-pasted coordinate string or Google Maps URL into [lat, lon].
//
// Supported formats:
//   "39.0686, -92.9457"            bare lat/lon pair
//   "https://maps.google.com/?q=39.0686,-92.9457"
//   "https://www.google.com/maps/place/Name/@39.0686,-92.9457,15z"
//   "https://www.google.com/maps/@39.0686,-92.9457,15z"

/**
 * Parse a user-pasted string into [lat, lon] or null.
 * Returns null when parsing fails or values are out of valid range.
 *
 * @param {string} str
 * @returns {[number, number] | null}
 */
export function parseCoordInput(str) {
  if (!str || typeof str !== 'string') return null;
  const s = str.trim();
  if (!s) return null;

  if (s.includes('maps.google.com') || s.includes('google.com/maps')) {
    // /@lat,lon,zoom  (place URL or plain location URL)
    const atMatch = s.match(/@(-?\d+(?:\.\d*)?),(-?\d+(?:\.\d*)?),/);
    if (atMatch) return validate(parseFloat(atMatch[1]), parseFloat(atMatch[2]));

    // ?q=lat,lon  (share URL)
    try {
      const url = new URL(s);
      const q = url.searchParams.get('q');
      if (q) {
        const parts = q.split(',');
        if (parts.length >= 2) return validate(parseFloat(parts[0]), parseFloat(parts[1]));
      }
    } catch { /* invalid URL */ }

    return null;
  }

  // Bare "lat, lon" — two numbers separated by comma and/or whitespace.
  const parts = s.split(/[,\s]+/).filter(Boolean);
  if (parts.length === 2) {
    return validate(parseFloat(parts[0]), parseFloat(parts[1]));
  }

  return null;
}

function validate(lat, lon) {
  if (isNaN(lat) || isNaN(lon)) return null;
  if (lat < -90 || lat > 90) return null;
  if (lon < -180 || lon > 180) return null;
  return [lat, lon];
}

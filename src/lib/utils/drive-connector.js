// Formats the between-stops drive connector. Distance is required to render;
// duration is appended only when available. Returns null when nothing to show.
//
// The `mi` field is required; `min` is optional (only present when per-segment
// drive time data exists). When mi is 0 or absent, returns null so no
// connector element is rendered.
export function driveConnectorLabel(seg = {}) {
  const mi = Number(seg.mi);
  if (!Number.isFinite(mi) || mi <= 0) return null;
  const miText = Number.isInteger(mi) ? `${mi}` : `${parseFloat(mi.toFixed(1))}`;
  let out = `↓ ${miText} mi`;
  if (Number.isFinite(Number(seg.min)) && Number(seg.min) > 0) out += ` · ${Math.round(seg.min)} min`;
  return out;
}

/**
 * Format a normalized usage object as a one-line cost summary.
 * Shape: { input, output, total, turns }. Missing fields default to 0/1.
 * Returns "" when usage is missing entirely.
 */
export function formatUsage(usage) {
  if (!usage) return '';
  const input = usage.input ?? 0;
  const output = usage.output ?? 0;
  const turns = usage.turns ?? 1;
  return `Used ${input.toLocaleString()} in / ${output.toLocaleString()} out · ${turns} turn${turns === 1 ? '' : 's'}`;
}

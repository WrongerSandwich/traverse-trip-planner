// Standalone re-export so server-side code and non-component consumers
// can import formatTokens without pulling in the full workflow-status barrel.
// The authoritative implementation lives in src/lib/workflow-status/core.js.
export { formatTokens } from '../workflow-status/core.js';

/**
 * Sum a normalized usage object { input, output } into a token count.
 * Returns 0 when usage is missing or malformed.
 * Adapters return { input, output, total, turns } — use this helper
 * in route handlers before passing to the SSE done event or JSON response.
 *
 * @param {{ input?: number, output?: number } | null | undefined} usage
 * @returns {number}
 */
export function usageToTokens(usage) {
  if (!usage) return 0;
  return (usage.input ?? 0) + (usage.output ?? 0);
}

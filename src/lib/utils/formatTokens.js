// Standalone re-export so server-side code and non-component consumers
// can import formatTokens without pulling in the full workflow-status barrel.
// The authoritative implementation lives in src/lib/workflow-status/core.js.
export { formatTokens } from '../workflow-status/core.js';

/**
 * Sum a usage object into a token count.
 * Accepts both the normalized adapter shape { input, output } and the raw
 * provider shape { input_tokens, output_tokens } (Anthropic/OpenAI wire format).
 * Returns 0 when usage is missing or malformed.
 *
 * @param {{ input?: number, output?: number, input_tokens?: number, output_tokens?: number } | null | undefined} usage
 * @returns {number}
 */
export function usageToTokens(usage) {
  if (!usage) return 0;
  return (usage.input_tokens ?? usage.input ?? 0) + (usage.output_tokens ?? usage.output ?? 0);
}

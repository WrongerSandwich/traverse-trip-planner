// Maps HTTP status codes from /api/actions/receipts/[slug] to typed
// TraverseError codes for client-side error rendering.
// See docs/ai-workflow-ux.md §5 (failure recovery contract).

/**
 * Map an HTTP status code (and optional response body) from the receipts
 * route to a { code, ctx } pair for use with failureSentence().
 *
 * @param {number} status HTTP status code from the receipts POST response.
 * @param {string} body   Response body text (may be empty string).
 * @returns {{ code: string, ctx: Record<string, string> }}
 */
export function receiptsErrorFromStatus(status, body) {
  if (status === 404) return { code: 'trip_not_found', ctx: {} };
  if (status === 413) return { code: 'invalid_input', ctx: { reason: 'Image too large (max 5 MB per file)' } };
  if (status === 415) return { code: 'invalid_input', ctx: { reason: body || 'Unsupported image type' } };
  if (status === 400) return { code: 'invalid_input', ctx: { reason: body || 'Bad request' } };
  if (status === 422) return { code: 'empty_model_output', ctx: {} };
  if (status === 502) return { code: 'provider_error', ctx: { provider: 'Model', summary: body || 'Unknown error' } };
  return { code: 'network_error', ctx: {} };
}

/**
 * Returns true when `err` represents an AbortError from any source:
 * - a DOMException with name "AbortError"
 * - a Node.js AbortError with code "ABORT_ERR"
 * - the literal string "AbortError" (SSE legacy path)
 *
 * @param {unknown} err
 * @returns {boolean}
 */
export function isAbort(err) {
  if (!err) return false;
  return err.name === 'AbortError' || err.code === 'ABORT_ERR' || err === 'AbortError';
}

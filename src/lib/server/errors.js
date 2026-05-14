// Application-level typed error. Thrown by server logic when a failure has a
// known, recoverable cause. Route handlers catch it and map `code` to a
// user-facing action sentence rather than surfacing the raw message.
export class TraverseError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'TraverseError';
    this.code = code;
  }
}

// Normalized error type for AI/search adapter failures.
//
// `message` is a short, public-safe summary suitable for SSE streams or end-user UI.
// `cause` carries the raw provider response (response body, SDK error) — log it
// server-side for debugging, but don't surface it to the client.
//
// Adapters should call `logAdapterError(err)` before throwing to keep the cause
// in the server log without coupling that to the throw site.

export class AdapterError extends Error {
  constructor({ provider, model, status, summary, cause }) {
    super(summary);
    this.name = 'AdapterError';
    this.provider = provider;
    this.model = model;
    this.status = status;
    this.cause = cause;
  }
}

export function summarizeStatus(status) {
  if (status === 401) return 'API key rejected';
  if (status === 403) return 'API access forbidden';
  if (status === 404) return 'Model or endpoint not found';
  if (status === 429) return 'Rate limited';
  if (status >= 500 && status < 600) return 'Provider unavailable';
  if (status >= 400 && status < 500) return `Client error (${status})`;
  return `HTTP ${status}`;
}

/** Format the public-safe summary string used as the AdapterError's message. */
export function formatSummary({ provider, model, status, detail }) {
  const head = model ? `${provider}/${model}` : provider;
  const body = status ? summarizeStatus(status) : detail || 'Request failed';
  const tail = status && detail ? ` (${detail})` : '';
  return `${head}: ${body}${tail}`;
}

/**
 * Build an AdapterError from an HTTP-style failure (fetch response we read).
 * `cause` should be the raw response text or parsed body.
 */
export function adapterErrorFromResponse({ provider, model, status, cause, detail }) {
  return new AdapterError({
    provider,
    model,
    status,
    summary: formatSummary({ provider, model, status, detail }),
    cause,
  });
}

export function logAdapterError(err) {
  if (!(err instanceof AdapterError)) return;
  const head = `[${err.provider}${err.model ? `/${err.model}` : ''}]`;
  const status = err.status ? ` ${err.status}` : '';
  console.error(`${head}${status} ${err.message}`);
  if (err.cause !== undefined) {
    const causeStr = typeof err.cause === 'string' ? err.cause : JSON.stringify(err.cause);
    // Truncate noisy bodies so server logs stay readable.
    const truncated = causeStr.length > 1000 ? `${causeStr.slice(0, 1000)}… [truncated]` : causeStr;
    console.error(`${head} cause:`, truncated);
  }
}

// Failure recovery registry lives in $lib/errors-registry.js — a client-safe
// module (no node imports, no side effects). Re-exported from here for
// backwards compatibility so server-side imports keep working.
export { ERROR_REGISTRY, AFFORDANCES, failureSentence } from '../errors-registry.js';

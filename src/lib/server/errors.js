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

// Valid recovery affordances. UI components key off these to render the
// appropriate action button for each failure.
export const AFFORDANCES = ['retry', 'switch_provider', 'edit', 'dismiss', 'open_file'];

// Maps every TraverseError code to a user-facing sentence and recovery
// affordances. UI components import this — no inline catch sentences in
// route handlers or components.
//
// Entries with `interpolate` list named placeholders that callers must
// fill in via string replacement; each key must appear as `{key}` in
// the sentence.
export const ERROR_REGISTRY = {
  // ── Codes from the §5 spec ───────────────────────────────────────────
  empty_model_output: {
    sentence: 'The model returned no usable output. Try again, or switch providers if it keeps happening.',
    affordances: ['retry', 'switch_provider'],
  },
  geocode_quota: {
    sentence: 'Geocoding is rate-limited right now. Try again in a minute.',
    affordances: ['retry', 'dismiss'],
  },
  provider_error: {
    sentence: '{provider} returned an error: {summary}. Retry, or switch providers.',
    affordances: ['retry', 'switch_provider'],
    interpolate: ['provider', 'summary'],
  },
  timeout: {
    sentence: 'This took longer than expected and was cancelled. Retry, or try a faster model.',
    affordances: ['retry', 'switch_provider'],
  },
  invalid_input: {
    sentence: '{reason}. Edit the trip and try again.',
    affordances: ['edit'],
    interpolate: ['reason'],
  },
  file_conflict: {
    sentence: '{artifact} already exists. Delete or rename it to redo.',
    affordances: ['open_file', 'dismiss'],
    interpolate: ['artifact'],
  },
  cancelled: {
    sentence: 'Cancelled.',
    affordances: ['dismiss'],
  },
  network_error: {
    sentence: "Couldn't reach the model. Check your connection and retry.",
    affordances: ['retry'],
  },
  // ── Codes thrown elsewhere in src/ ───────────────────────────────────
  no_section_content: {
    sentence: 'The model returned no section content. Try again.',
    affordances: ['retry'],
  },
  trip_not_found: {
    sentence: 'Trip not found.',
    affordances: ['dismiss'],
  },
  wrong_stage: {
    sentence: 'This action requires a different trip stage.',
    affordances: ['dismiss'],
  },
  missing_overview: {
    sentence: 'overview.md is required for this action. Add it and try again.',
    affordances: ['edit'],
  },
  model_returned_no_yaml_block: {
    sentence: 'The model did not return the expected output block. Try again.',
    affordances: ['retry'],
  },
  model_returned_invalid_yaml: {
    sentence: 'The model returned output that failed to parse. Try again.',
    affordances: ['retry'],
  },
};

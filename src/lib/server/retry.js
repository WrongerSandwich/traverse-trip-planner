// Thin retry helper for fetch-based adapters. Retries on transient
// failures (network errors, 429, 5xx) with exponential backoff.
//
// Usage:
//   const data = await withRetry(() => callApi(), { label: 'tavily' });

const DEFAULT_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 1000;
const RETRIABLE_STATUS = /\b(429|500|502|503|504)\b/;

const RETRIABLE_HTTP_STATUSES = new Set([429, 500, 502, 503, 504]);

function isRetriable(err) {
  if (!err) return false;
  // AdapterError exposes the parsed HTTP status directly.
  if (typeof err.status === 'number' && RETRIABLE_HTTP_STATUSES.has(err.status)) return true;
  // Network-level failures from fetch surface as TypeError on Node.
  // Only retry TypeErrors whose message mentions fetch/network; let real code
  // bugs (e.g. "Cannot read properties of undefined") propagate immediately.
  if (err.name === 'TypeError' && /fetch|network|failed to fetch/i.test(err.message || '')) return true;
  if (err.code && /^(ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN)$/.test(err.code)) return true;
  // Fallback: status codes baked into thrown error messages by SDKs we don't wrap.
  if (RETRIABLE_STATUS.test(err.message || '')) return true;
  return false;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export async function withRetry(fn, opts = {}) {
  const { retries = DEFAULT_RETRIES, baseDelay = DEFAULT_BASE_DELAY_MS, label = 'request', signal = null } = opts;
  let attempt = 0;
  while (true) {
    if (signal?.aborted) throw signal.reason ?? new Error('Aborted');
    try {
      return await fn();
    } catch (err) {
      if (signal?.aborted) throw signal.reason ?? err;
      if (attempt >= retries || !isRetriable(err)) throw err;
      const delay = baseDelay * Math.pow(2, attempt);
      console.log(`[retry] ${label} attempt ${attempt + 1}/${retries} failed (${err.message}); retrying in ${delay}ms`);
      await sleep(delay);
      attempt++;
    }
  }
}

// Exported for tests.
export const _internal = { isRetriable };

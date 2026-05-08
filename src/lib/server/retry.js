// Thin retry helper for fetch-based adapters. Retries on transient
// failures (network errors, 429, 5xx) with exponential backoff.
//
// Usage:
//   const data = await withRetry(() => callApi(), { label: 'tavily' });

const DEFAULT_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 1000;
const RETRIABLE_STATUS = /\b(429|500|502|503|504)\b/;

function isRetriable(err) {
  if (!err) return false;
  // Network-level failures from fetch (TypeError on Node) and Node's connection errors.
  if (err.name === 'TypeError') return true;
  if (err.code && /^(ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN)$/.test(err.code)) return true;
  // Status codes baked into thrown error messages by the adapters.
  if (RETRIABLE_STATUS.test(err.message || '')) return true;
  return false;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export async function withRetry(fn, opts = {}) {
  const { retries = DEFAULT_RETRIES, baseDelay = DEFAULT_BASE_DELAY_MS, label = 'request' } = opts;
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
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

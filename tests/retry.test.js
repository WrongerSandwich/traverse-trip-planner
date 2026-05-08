import { describe, it, expect, vi, beforeEach } from 'vitest';
import { withRetry, _internal } from '../src/lib/server/retry.js';

describe('isRetriable', () => {
  const { isRetriable } = _internal;

  it('treats fetch TypeErrors as retriable', () => {
    expect(isRetriable(new TypeError('fetch failed'))).toBe(true);
  });

  it('treats Node connection errors as retriable', () => {
    const e = Object.assign(new Error('reset'), { code: 'ECONNRESET' });
    expect(isRetriable(e)).toBe(true);
  });

  it('matches retriable status codes embedded in error messages', () => {
    expect(isRetriable(new Error('OpenAI API 429: rate limited'))).toBe(true);
    expect(isRetriable(new Error('OpenAI API 503: backend down'))).toBe(true);
  });

  it('does not retry on 4xx other than 429', () => {
    expect(isRetriable(new Error('OpenAI API 400: bad request'))).toBe(false);
    expect(isRetriable(new Error('OpenAI API 401: unauthorized'))).toBe(false);
  });

  it('does not retry on null/undefined', () => {
    expect(isRetriable(null)).toBe(false);
    expect(isRetriable(undefined)).toBe(false);
  });

  it('recognizes AdapterError.status without parsing the message', () => {
    // No status in the message — message-pattern regex would miss it.
    const e = Object.assign(new Error('Rate limited'), { status: 429 });
    expect(isRetriable(e)).toBe(true);

    const e2 = Object.assign(new Error('Provider unavailable'), { status: 503 });
    expect(isRetriable(e2)).toBe(true);

    // Non-retriable status takes precedence over message regex.
    const e3 = Object.assign(new Error('Client error'), { status: 400 });
    expect(isRetriable(e3)).toBe(false);
  });
});

describe('withRetry', () => {
  beforeEach(() => {
    // Drop the delay to keep tests fast.
    vi.useFakeTimers();
  });

  it('returns immediately on success', async () => {
    const fn = vi.fn().mockResolvedValueOnce('ok');
    const promise = withRetry(fn);
    await vi.runAllTimersAsync();
    expect(await promise).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on retriable failure and succeeds', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('OpenAI API 429: rate limited'))
      .mockResolvedValueOnce('ok');
    const promise = withRetry(fn, { baseDelay: 10 });
    await vi.runAllTimersAsync();
    expect(await promise).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws non-retriable errors immediately without further attempts', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('OpenAI API 401: unauthorized'));
    const promise = withRetry(fn);
    await expect(promise).rejects.toThrow(/401/);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('exhausts retries and rethrows the last error', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('OpenAI API 503: down'));
    const promise = withRetry(fn, { retries: 2, baseDelay: 10 }).catch(e => e);
    await vi.runAllTimersAsync();
    const err = await promise;
    expect(err.message).toMatch(/503/);
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it('throws immediately when signal is already aborted, never calls fn', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const controller = new AbortController();
    controller.abort(new Error('cancelled'));
    await expect(withRetry(fn, { signal: controller.signal })).rejects.toThrow(/cancelled/);
    expect(fn).not.toHaveBeenCalled();
  });

  it('does not retry after the signal aborts mid-flight', async () => {
    const controller = new AbortController();
    const fn = vi.fn().mockImplementation(async () => {
      controller.abort(new Error('cancelled'));
      throw new Error('OpenAI API 500: down');
    });
    await expect(withRetry(fn, { signal: controller.signal, baseDelay: 10 }))
      .rejects.toThrow(/cancelled/);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('uses exponential backoff for delay between attempts', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('500'))
      .mockRejectedValueOnce(new Error('500'))
      .mockResolvedValueOnce('ok');
    const promise = withRetry(fn, { baseDelay: 100 });

    expect(fn).toHaveBeenCalledTimes(1);

    // First retry fires after baseDelay = 100ms.
    await vi.advanceTimersByTimeAsync(50);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60);
    expect(fn).toHaveBeenCalledTimes(2);

    // Second retry fires after baseDelay * 2 = 200ms more.
    await vi.advanceTimersByTimeAsync(150);
    expect(fn).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60);
    expect(fn).toHaveBeenCalledTimes(3);

    expect(await promise).toBe('ok');
  });
});

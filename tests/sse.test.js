import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withHeartbeat } from '../src/lib/server/sse.js';

describe('withHeartbeat', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('returns the value from the wrapped function', async () => {
    const send = vi.fn();
    const result = await withHeartbeat(() => Promise.resolve(42), send, ['tick']);
    expect(result).toBe(42);
  });

  it('sends no messages when fn resolves before first tick', async () => {
    const send = vi.fn();
    const promise = withHeartbeat(() => Promise.resolve('fast'), send, ['tick'], 5000);
    await promise;
    expect(send).not.toHaveBeenCalled();
  });

  it('sends first message after one interval', async () => {
    const send = vi.fn();
    let resolve;
    const slow = new Promise((r) => { resolve = r; });
    const promise = withHeartbeat(() => slow, send, ['Still drafting…', 'Almost there…'], 5000);

    await vi.advanceTimersByTimeAsync(5000);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('Still drafting…');

    await vi.advanceTimersByTimeAsync(5000);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledWith('Almost there…');

    resolve('done');
    expect(await promise).toBe('done');
  });

  it('clears the timer once messages are exhausted', async () => {
    const send = vi.fn();
    let resolve;
    const slow = new Promise((r) => { resolve = r; });
    const promise = withHeartbeat(() => slow, send, ['one'], 5000);

    await vi.advanceTimersByTimeAsync(5000);
    expect(send).toHaveBeenCalledTimes(1);

    // Advance well past another interval — timer should be cleared, no more sends
    await vi.advanceTimersByTimeAsync(10000);
    expect(send).toHaveBeenCalledTimes(1);

    resolve();
    await promise;
  });

  it('clears the timer after fn settles so no stray sends occur', async () => {
    const send = vi.fn();
    const promise = withHeartbeat(() => Promise.resolve(), send, ['late'], 5000);
    await promise;
    // Advance past interval — timer should already be cleared
    await vi.advanceTimersByTimeAsync(10000);
    expect(send).not.toHaveBeenCalled();
  });

  it('clears the timer even when fn rejects', async () => {
    const send = vi.fn();
    let reject;
    const slow = new Promise((_, r) => { reject = r; });
    const promise = withHeartbeat(() => slow, send, ['tick'], 5000);

    await vi.advanceTimersByTimeAsync(3000);
    reject(new Error('boom'));
    await expect(promise).rejects.toThrow('boom');

    await vi.advanceTimersByTimeAsync(10000);
    expect(send).not.toHaveBeenCalled();
  });
});

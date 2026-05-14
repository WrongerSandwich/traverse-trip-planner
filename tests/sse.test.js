import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withHeartbeat, sseStream } from '../src/lib/server/sse.js';

// ─── sseStream token propagation ─────────────────────────────────────────────

async function collectEvents(handler) {
  const res = sseStream(handler);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const events = [];
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      try { events.push(JSON.parse(line.slice(6))); } catch { /* ignore */ }
    }
  }
  return events;
}

describe('sseStream', () => {
  it('includes tokens in the done event when tokens > 0', async () => {
    const events = await collectEvents(async (send) => {
      send('Done.', true, 3200);
    });
    const doneEvent = events.find(e => e.done);
    expect(doneEvent).toBeDefined();
    expect(doneEvent.tokens).toBe(3200);
    expect(doneEvent.msg).toBe('Done.');
  });

  it('omits tokens from the done event when tokens is 0', async () => {
    const events = await collectEvents(async (send) => {
      send('Done.', true, 0);
    });
    const doneEvent = events.find(e => e.done);
    expect(doneEvent).toBeDefined();
    expect(doneEvent.tokens).toBeUndefined();
  });

  it('omits tokens from the done event when tokens is null', async () => {
    const events = await collectEvents(async (send) => {
      send('Done.', true, null);
    });
    const doneEvent = events.find(e => e.done);
    expect(doneEvent).toBeDefined();
    expect(doneEvent.tokens).toBeUndefined();
  });

  it('does not include tokens on non-done events', async () => {
    const events = await collectEvents(async (send) => {
      send('Progress…', false, 999);
      send('Done.', true, 3200);
    });
    const progressEvent = events.find(e => !e.done);
    expect(progressEvent).toBeDefined();
    expect(progressEvent.tokens).toBeUndefined();
  });
});

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

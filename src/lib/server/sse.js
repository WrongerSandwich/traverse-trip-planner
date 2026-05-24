import { isAbort } from '$lib/utils/abort.js';

/**
 * Wraps an async SSE handler in a ReadableStream + Response with correct headers.
 *
 * The handler receives a `send` function that accepts either positional
 * `(msg, done?, tokens?)` args or a single payload object
 * `{ msg, done?, tokens?, code?, context?, id?, ... }`. Unhandled errors
 * are automatically forwarded as a final SSE error message. The controller
 * is always closed in `finally` so callers never need to close it explicitly.
 *
 * Usage:
 *   return sseStream(async (send) => {
 *     send('Working…');
 *     send('Done.', true);
 *     // or with structured terminal payload:
 *     // send({ msg: 'Already on the list.', done: true, code: 'candidate_duplicate', context: { name } });
 *   });
 */

/**
 * Runs `fn` while sending periodic heartbeat messages to keep the SSE panel
 * alive during long model calls. Clears the timer as soon as `fn` settles.
 *
 * @param {() => Promise<T>} fn - async work to await
 * @param {(msg: string) => void} send - SSE send function
 * @param {string[]} messages - sequential messages to emit at each tick
 * @param {number} intervalMs - ms between ticks (default 5000)
 * @returns {Promise<T>}
 */
export async function withHeartbeat(fn, send, messages, intervalMs = 5000) {
  let idx = 0;
  const timer = setInterval(() => {
    if (idx < messages.length) send(messages[idx++]);
    if (idx >= messages.length) clearInterval(timer);
  }, intervalMs);
  try {
    return await fn();
  } finally {
    clearInterval(timer);
  }
}

export function sseStream(handler) {
  const encoder = new TextEncoder();
  let cancelled = false;
  const stream = new ReadableStream({
    async start(controller) {
      // Accepts either positional (msg, done, tokens) or a single payload
      // object {msg, done, tokens, code, context, id, ...} — newer endpoints
      // (add-candidate, find-more) use the object form so they can carry an
      // error code and structured context onto the terminal event.
      const send = (arg, done = false, tokens = null) => {
        if (cancelled) return; // client gone — drop the write
        try {
          let payload;
          if (arg !== null && typeof arg === 'object') {
            payload = { ...arg };
            if (payload.done == null) payload.done = false;
            if (!payload.done) delete payload.tokens;
            if (payload.done && (payload.tokens == null || payload.tokens <= 0)) {
              delete payload.tokens;
            }
          } else {
            payload = { msg: arg, done };
            if (done && tokens != null && tokens > 0) payload.tokens = tokens;
          }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        } catch { /* stream is closed — ignore */ }
      };
      try {
        await handler(send);
      } catch (err) {
        if (!cancelled && !isAbort(err)) send(`Error: ${err.message}`, true);
      } finally {
        try { controller.close(); } catch { /* already closed */ }
      }
    },
    cancel() {
      cancelled = true;
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

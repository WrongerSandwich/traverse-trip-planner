/**
 * Wraps an async SSE handler in a ReadableStream + Response with correct headers.
 *
 * The handler receives a `send(msg, done?)` function. Unhandled errors are
 * automatically forwarded as a final SSE error message. The controller is
 * always closed in `finally` so callers never need to close it explicitly.
 *
 * Usage:
 *   return sseStream(async (send) => {
 *     send('Working…');
 *     send('Done.', true);
 *   });
 */
function isAbort(err) {
  if (!err) return false;
  return err.name === 'AbortError' || err.code === 'ABORT_ERR' || err === 'AbortError';
}

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
      const send = (msg, done = false, tokens = null) => {
        if (cancelled) return; // client gone — drop the write
        try {
          const payload = { msg, done };
          if (done && tokens != null && tokens > 0) payload.tokens = tokens;
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

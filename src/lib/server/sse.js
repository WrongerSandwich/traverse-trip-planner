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

export function sseStream(handler) {
  const encoder = new TextEncoder();
  let cancelled = false;
  const stream = new ReadableStream({
    async start(controller) {
      const send = (msg, done = false) => {
        if (cancelled) return; // client gone — drop the write
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ msg, done })}\n\n`));
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

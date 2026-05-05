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
export function sseStream(handler) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (msg, done = false) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ msg, done })}\n\n`));
      };
      try {
        await handler(send);
      } catch (err) {
        send(`Error: ${err.message}`, true);
      } finally {
        controller.close();
      }
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

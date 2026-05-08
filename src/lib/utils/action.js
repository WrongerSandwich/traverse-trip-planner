/**
 * Stream an SSE action endpoint, calling onMessage for each event.
 * Resolves when the server sends { done: true }.
 * Rejects on network/server errors.
 *
 * Pass an AbortSignal to cancel the request mid-stream. When aborted,
 * the fetch is cancelled (closing the SSE connection), the server's
 * request.signal fires, and any in-flight upstream API calls in chat()
 * abort with it. The function then resolves silently rather than rejecting,
 * since aborts are user-initiated and shouldn't surface as errors.
 */
export async function streamAction(url, onMessage, body = null, signal = null) {
  const init = { method: 'POST' };
  if (body !== null) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  if (signal) init.signal = signal;

  let res;
  try {
    res = await fetch(url, init);
  } catch (err) {
    if (signal?.aborted) return; // aborted before headers — silent
    throw err;
  }
  if (!res.ok) throw new Error(`Server error ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const event = JSON.parse(line.slice(6));
          onMessage(event);
          if (event.done) return;
        } catch { /* malformed line — ignore */ }
      }
    }
  } catch (err) {
    if (signal?.aborted) return; // aborted mid-stream — silent
    throw err;
  }
}

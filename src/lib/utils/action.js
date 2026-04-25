/**
 * Stream an SSE action endpoint, calling onMessage for each event.
 * Resolves when the server sends { done: true }.
 * Rejects on network/server errors.
 */
export async function streamAction(url, onMessage, body = null) {
  const init = { method: 'POST' };
  if (body !== null) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`Server error ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';

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
}

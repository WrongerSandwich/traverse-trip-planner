import { sseStream } from '$lib/server/sse.js';
import { prepareBrochure } from '$lib/server/brochure.js';
import { formatUsage } from '$lib/server/ai.js';

export function POST({ params, request }) {
  const { slug } = params;
  const signal = request.signal;

  return sseStream(async (send) => {
    let usage;
    try {
      const result = await prepareBrochure(slug, {
        signal,
        onActivity: ({ type, message }) => {
          if (type === 'progress' && message) send(message);
        },
      });
      usage = result.usage;
    } catch (err) {
      throw new Error(`Brochure preparation failed: ${err.message}`);
    }

    if (usage) send(formatUsage(usage));
    send('Done — brochure prepared. Open the brochure page to review.', true);
  });
}

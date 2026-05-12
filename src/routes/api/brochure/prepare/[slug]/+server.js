import { sseStream } from '$lib/server/sse.js';
import { prepareBrochure } from '$lib/server/brochure.js';
import { formatUsage } from '$lib/server/ai.js';
import { TraverseError } from '$lib/server/errors.js';

const ERROR_MESSAGES = {
  missing_planning_sections: 'Add at least an overview before preparing the brochure.',
  model_returned_no_yaml: "The model didn't return structured data — try again.",
  geocode_quota: 'Map service is rate-limited; wait a minute before retrying.',
};

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
      if (err instanceof TraverseError && ERROR_MESSAGES[err.code]) {
        throw new Error(ERROR_MESSAGES[err.code]);
      }
      throw new Error(`Brochure preparation failed: ${err.message}`);
    }

    if (usage) send(formatUsage(usage));
    send('Done — brochure prepared. Open the brochure page to review.', true);
  });
}

import { sseStream } from '$lib/server/sse.js';
import { regeocodeBrochureStops } from '$lib/server/brochure.js';

export function POST({ params }) {
  const { slug } = params;
  return sseStream(async (send) => {
    let result;
    try {
      result = await regeocodeBrochureStops(slug, {
        onActivity: ({ type, message }) => {
          if (type === 'progress' && message) send(message);
        },
      });
    } catch (err) {
      throw new Error(`Re-geocode failed: ${err.message}`);
    }
    if (result.stopsAdded === 0 && result.lodgingAdded === 0) {
      send(`No new pins found. ${result.stopsLocated} of ${result.stopsTotal} stops have coords.`, true);
    } else {
      const parts = [];
      if (result.stopsAdded > 0) parts.push(`${result.stopsAdded} new stop pin${result.stopsAdded === 1 ? '' : 's'}`);
      if (result.lodgingAdded > 0) parts.push(`${result.lodgingAdded} new lodging pin${result.lodgingAdded === 1 ? '' : 's'}`);
      send(`Added ${parts.join(' and ')}. ${result.stopsLocated} of ${result.stopsTotal} stops now have coords.`, true);
    }
  });
}

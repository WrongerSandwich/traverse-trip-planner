import { getFeatureAvailability, getEffectiveConfig } from '$lib/server/config.js';
import { getResolvedPromises } from '$lib/server/promises.js';

export function load() {
  return {
    features: getFeatureAvailability(),
    assistantName: getEffectiveConfig().assistantName,
    // Telemetry-resolved `_promise` map (label → { verb, produces,
    // time_seconds, tokens_range }). Falls back to hand defaults when
    // telemetry is sparse or drift is suspicious; see
    // src/lib/server/workflow-stats.js + src/lib/server/promises.js.
    promises: getResolvedPromises(),
  };
}

import { getFeatureAvailability, getEffectiveConfig } from '$lib/server/config.js';

export function load() {
  return {
    features: getFeatureAvailability(),
    assistantName: getEffectiveConfig().assistantName,
  };
}

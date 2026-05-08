import { getFeatureAvailability, config } from '$lib/server/config.js';

export function load() {
  return {
    features: getFeatureAvailability(),
    assistantName: config.assistantName,
  };
}

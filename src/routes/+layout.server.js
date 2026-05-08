import { getFeatureAvailability } from '$lib/server/config.js';

export function load() {
  return { features: getFeatureAvailability() };
}

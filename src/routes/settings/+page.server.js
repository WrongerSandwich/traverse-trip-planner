import { readSettings, redactSettings, SUPPORTED_PROVIDERS } from '$lib/server/settings.js';
import { getFeatureAvailability, config } from '$lib/server/config.js';

export function load() {
  const settings = readSettings();
  return {
    settingsView: redactSettings(settings),
    supportedProviders: SUPPORTED_PROVIDERS,
    features: getFeatureAvailability(),
    assistantName: config.assistantName,
  };
}

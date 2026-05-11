import { error } from '@sveltejs/kit';
import { readSettings, redactSettings, SUPPORTED_PROVIDERS } from '$lib/server/settings.js';
import { getFeatureAvailability, config } from '$lib/server/config.js';

export function load() {
  if (process.env.TRAVERSE_DISABLE_SETTINGS_UI) {
    error(403, 'Settings UI is disabled on this server. Unset TRAVERSE_DISABLE_SETTINGS_UI to re-enable.');
  }

  const settings = readSettings();
  return {
    settingsView: redactSettings(settings),
    supportedProviders: SUPPORTED_PROVIDERS,
    features: getFeatureAvailability(),
    assistantName: config.assistantName,
  };
}

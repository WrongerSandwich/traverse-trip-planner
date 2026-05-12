import { error } from '@sveltejs/kit';
import {
  readSettings,
  redactSettings,
  SUPPORTED_PROVIDERS,
  SUPPORTED_SEARCH_PROVIDERS,
} from '$lib/server/settings.js';
import { getFeatureAvailability, getEffectiveConfig } from '$lib/server/config.js';

export function load() {
  if (process.env.TRAVERSE_DISABLE_SETTINGS_UI) {
    error(403, 'Settings UI is disabled on this server. Unset TRAVERSE_DISABLE_SETTINGS_UI to re-enable.');
  }

  const settings = readSettings();
  const effective = getEffectiveConfig();
  return {
    settingsView: redactSettings(settings),
    supportedProviders: SUPPORTED_PROVIDERS,
    supportedSearchProviders: SUPPORTED_SEARCH_PROVIDERS,
    features: getFeatureAvailability(),
    effectiveSearchProvider: effective.search.provider,
    effectiveAssistantName: effective.assistantName,
  };
}

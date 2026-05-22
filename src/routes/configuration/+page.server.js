import { error } from '@sveltejs/kit';
import {
  readSettings,
  redactSettings,
  SUPPORTED_PROVIDERS,
  SUPPORTED_SEARCH_PROVIDERS,
} from '$lib/server/settings.js';
import { getFeatureAvailability, getEffectiveConfig } from '$lib/server/config.js';

// Env-only knobs the Settings UI surfaces as read-only. Each row has a reason
// it's not editable from the UI; the canonical full list lives in DEPLOY.md's
// "Configuration reference" section. The order here is the rendering order.
//
// Display modes:
//   - 'boolean'  — render "on" if any non-empty value is set, else "unset"
//   - 'secret'   — render "set" if non-empty, else "unset" (never echo the value)
//   - 'verbatim' — render the value as-is (no secrets)
const ENV_ONLY_KNOBS = [
  {
    name: 'TRAVERSE_DISABLE_SETTINGS_UI',
    display: 'boolean',
    reason: 'Trust boundary — disables this UI, so it must live in .env (otherwise the UI it disables could re-enable itself).',
  },
  {
    name: 'TRAVERSE_ALLOW_LAN_WRITES',
    display: 'boolean',
    reason: 'Auth gate for POST /api/settings and PUT /api/home. Opens config writes to non-loopback clients on a trusted LAN.',
  },
  {
    name: 'TRUST_PROXY_FOR_AUTH',
    display: 'boolean',
    reason: 'Trust the first hop of X-Forwarded-For when gating auth — set when running behind a reverse proxy that overwrites this header.',
  },
  {
    name: 'TRAVERSE_SHARE_SECRET',
    display: 'secret',
    reason: 'HMAC secret for public share links. Generate with `openssl rand -base64 32`; rotating it invalidates every existing link.',
  },
];

function describeEnvOnlyKnob(knob) {
  const raw = process.env[knob.name];
  const isSet = typeof raw === 'string' && raw.trim() !== '';
  let displayValue;
  if (!isSet) displayValue = 'unset';
  else if (knob.display === 'secret') displayValue = 'set';
  else if (knob.display === 'boolean') displayValue = 'on';
  else displayValue = raw;
  return { name: knob.name, isSet, displayValue, reason: knob.reason };
}

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
    envOnlyKnobs: ENV_ONLY_KNOBS.map(describeEnvOnlyKnob),
  };
}

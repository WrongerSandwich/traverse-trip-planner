import { error } from '@sveltejs/kit';
import {
  readSettings,
  redactSettings,
  SUPPORTED_PROVIDERS,
  SUPPORTED_SEARCH_PROVIDERS,
} from '$lib/server/settings.js';
import { getFeatureAvailability, getEffectiveConfig } from '$lib/server/config.js';

// Env-only knobs the Settings UI surfaces as read-only. Each row has a reason
// it's not editable from the UI; the canonical full list lives in
// docs/deploy.md's "Configuration reference" section. The order here is the
// rendering order.
//
// Display modes:
//   - 'boolean'  — render "on" / "off" based on isActiveIf(rawValue). Each
//                  boolean knob declares its own truthy check matching how
//                  its consumer reads it (e.g. strict `=== '1'` vs JS-truthy
//                  `if (process.env.X)`). The badge state mirrors the actual
//                  runtime effect, not just whether the var is set.
//   - 'secret'   — render "set" if non-empty, else "unset" (never echo the value)
//   - 'verbatim' — render the value as-is (no secrets)
const ENV_ONLY_KNOBS = [
  {
    name: 'TRAVERSE_DISABLE_SETTINGS_UI',
    display: 'boolean',
    // Consumer: `if (process.env.TRAVERSE_DISABLE_SETTINGS_UI)` (JS-truthy).
    isActiveIf: (v) => typeof v === 'string' && v.trim() !== '',
    reason: 'Trust boundary: disables this UI, so it must live in .env (otherwise the UI it disables could re-enable itself).',
  },
  {
    name: 'TRAVERSE_ALLOW_LAN_WRITES',
    display: 'boolean',
    // Consumer in src/lib/server/auth.js: strict `=== '1'`.
    isActiveIf: (v) => v === '1',
    reason: 'Auth gate for POST /api/settings and PUT /api/home. Opens config writes to non-loopback clients on a trusted LAN.',
  },
  {
    name: 'TRUST_PROXY_FOR_AUTH',
    display: 'boolean',
    // Consumer in src/lib/server/auth.js: strict `=== '1'`.
    isActiveIf: (v) => v === '1',
    reason: 'Trust the first hop of X-Forwarded-For when gating auth, set when running behind a reverse proxy that overwrites this header.',
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
  let isActive;
  let displayValue;
  if (knob.display === 'secret') {
    isActive = isSet;
    displayValue = isSet ? 'set' : 'unset';
  } else if (knob.display === 'boolean') {
    isActive = knob.isActiveIf ? knob.isActiveIf(raw) : isSet;
    displayValue = isActive ? 'on' : 'off';
  } else {
    isActive = isSet;
    displayValue = isSet ? raw : 'unset';
  }
  return { name: knob.name, isActive, displayValue, reason: knob.reason };
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

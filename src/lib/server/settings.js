// Runtime-editable settings overlay. Lives at `data/settings.json` under the
// repo root and overlays on top of process.env — settings values win where
// present, env is the fallback. Re-read on every getEffectiveConfig() call so
// changes made via the Settings UI take effect on the next request without a
// restart.
//
// Public API:
//   readSettings()                   → parsed settings.json or {}
//   writeSettings(data)              → write settings.json (not crash-safe; single-user app)
//   redactKey(key)                   → "sk-ant-…XY4Z" safe for sending to the browser
//   settingsToEnv(settings)          → flat env-var override map for merging with process.env
//   redactSettings(settings, env?)   → browser-safe view with per-row source attribution

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PROVIDERS } from './providers.js';
import { atomicWrite } from './atomic-write.js';

// Resolve from cwd at module-load time. Direct constant rather than importing
// DATA_DIR from data.js, since data.js itself depends on this module —
// avoid a circular import.
const SETTINGS_PATH = resolve('data', 'settings.json');

const PROVIDER_KEY_ENV = Object.fromEntries(Object.entries(PROVIDERS).map(([k, v]) => [k, v.envKey]));

// Non-model third-party services that take an API key. Same storage shape as
// providers (settings.services.<name>) but kept distinct in the UI so they can
// be grouped separately from model providers.
const SERVICE_KEY_ENV = {
  tavily: 'TAVILY_API_KEY',
  pexels: 'PEXELS_API_KEY',
  stadia: 'STADIA_API_KEY',
};

export const SUPPORTED_PROVIDERS = Object.keys(PROVIDER_KEY_ENV);
export const SUPPORTED_SERVICES = Object.keys(SERVICE_KEY_ENV);
export const SUPPORTED_SEARCH_PROVIDERS = ['anthropic-builtin', 'tavily'];

export const SERVICE_ENV_NAMES = SERVICE_KEY_ENV;

export function readSettings() {
  try {
    const raw = readFileSync(SETTINGS_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function writeSettings(data) {
  atomicWrite(SETTINGS_PATH, JSON.stringify(data, null, 2) + '\n');
}

/**
 * Redact an API key for safe display in the browser.
 * Returns "sk-ant-…AB12" — first 7 chars + ellipsis + last 4.
 * Keys shorter than 12 chars are fully masked as "•••".
 */
export function redactKey(key) {
  if (!key || typeof key !== 'string' || key.length < 12) return '•••';
  return `${key.slice(0, 7)}…${key.slice(-4)}`;
}

/**
 * Convert settings.json shape to a flat env-var map suitable for merging
 * with process.env. Only includes entries that are non-empty strings.
 *
 * @param {object} settings — parsed settings.json
 * @returns {Record<string, string>}
 */
export function settingsToEnv(settings) {
  const out = {};

  const keys = settings?.keys ?? {};
  for (const [provider, envName] of Object.entries(PROVIDER_KEY_ENV)) {
    if (keys[provider] && typeof keys[provider] === 'string' && keys[provider].trim()) {
      out[envName] = keys[provider].trim();
    }
  }

  const services = settings?.services ?? {};
  for (const [service, envName] of Object.entries(SERVICE_KEY_ENV)) {
    if (services[service] && typeof services[service] === 'string' && services[service].trim()) {
      out[envName] = services[service].trim();
    }
  }

  const slots = settings?.slots ?? {};
  if (slots.default?.provider) out['TRAVERSE_MODEL_DEFAULT_PROVIDER'] = slots.default.provider;
  if (slots.default?.model)    out['TRAVERSE_MODEL_DEFAULT']          = slots.default.model;
  if (slots.research?.provider) out['TRAVERSE_MODEL_RESEARCH_PROVIDER'] = slots.research.provider;
  if (slots.research?.model)    out['TRAVERSE_MODEL_RESEARCH']          = slots.research.model;

  if (settings?.search?.provider && typeof settings.search.provider === 'string' && settings.search.provider.trim()) {
    out['TRAVERSE_SEARCH_PROVIDER'] = settings.search.provider.trim();
  }
  if (settings?.assistantName && typeof settings.assistantName === 'string' && settings.assistantName.trim()) {
    out['TRAVERSE_ASSISTANT_NAME'] = settings.assistantName.trim();
  }

  return out;
}

/**
 * Build a per-key row describing where the effective value came from. The
 * Settings UI uses this to render "From .env" vs "From settings.json"
 * labels and to tell users what (if anything) will resume on Remove.
 *
 * Returns `{ isSet, source, preview, envShadowed }`:
 *   - `isSet`        — kept for backwards compatibility; equivalent to `source !== 'unset'`
 *   - `source`       — 'env' | 'settings' | 'unset' — origin of the effective value
 *   - `preview`      — redacted preview of the effective value (or '' if unset)
 *   - `envShadowed`  — `{ preview }` when settings.json is overriding a *different* .env
 *                      value (so the UI can show what would resume on Remove); else `null`
 */
function describeKeyRow(settingsRaw, envRaw) {
  const settingsValue = typeof settingsRaw === 'string' ? settingsRaw.trim() : '';
  const envValue      = typeof envRaw      === 'string' ? envRaw.trim()      : '';
  if (settingsValue) {
    return {
      isSet: true,
      source: 'settings',
      preview: redactKey(settingsValue),
      envShadowed: (envValue && envValue !== settingsValue)
        ? { preview: redactKey(envValue) }
        : null,
    };
  }
  if (envValue) {
    return { isSet: true, source: 'env', preview: redactKey(envValue), envShadowed: null };
  }
  return { isSet: false, source: 'unset', preview: '', envShadowed: null };
}

/**
 * Return the redacted settings view for the browser. Each provider/service
 * key row carries source attribution (.env vs settings.json) so the UI can
 * tell users where the active value came from and what would happen on
 * Remove. Slot/search/assistantName values are sent as-is (not secret); the
 * Settings UI already surfaces effective values via separate page-data fields.
 *
 * @param {object} settings — parsed settings.json
 * @param {object} env      — env-var map to consult for shadowing (defaults to process.env)
 */
export function redactSettings(settings, env = process.env) {
  const keys = settings?.keys ?? {};
  const redactedKeys = {};
  for (const provider of SUPPORTED_PROVIDERS) {
    redactedKeys[provider] = describeKeyRow(keys[provider], env[PROVIDER_KEY_ENV[provider]]);
  }

  const services = settings?.services ?? {};
  const redactedServices = {};
  for (const service of SUPPORTED_SERVICES) {
    redactedServices[service] = describeKeyRow(services[service], env[SERVICE_KEY_ENV[service]]);
  }

  return {
    keys: redactedKeys,
    services: redactedServices,
    slots: {
      default: settings?.slots?.default ?? null,
      research: settings?.slots?.research ?? null,
    },
    search: { provider: settings?.search?.provider ?? '' },
    assistantName: settings?.assistantName ?? '',
  };
}

/**
 * Resolve a runtime env value, preferring the settings.json overlay over
 * process.env. Used by services (Tavily, Pexels, Stadia) so keys saved via the
 * Settings UI take effect on the next request without writing process.env.
 *
 * @param {string} envName — env var name (e.g. 'TAVILY_API_KEY')
 * @returns {string|undefined}
 */
export function resolveEnv(envName) {
  const overlay = settingsToEnv(readSettings());
  return overlay[envName] ?? process.env[envName];
}

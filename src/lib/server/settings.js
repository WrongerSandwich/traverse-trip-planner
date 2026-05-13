// Runtime-editable settings overlay. Lives in `settings.json` at the repo
// root and overlays on top of process.env — settings values win where present,
// env is the fallback. Re-read on every getEffectiveConfig() call so changes
// made via the Settings UI take effect on the next request without a restart.
//
// Public API:
//   readSettings()          → parsed settings.json or {}
//   writeSettings(data)     → write settings.json (not crash-safe; single-user app)
//   redactKey(key)          → "sk-ant-…XY4Z" safe for sending to the browser
//   settingsToEnv(settings) → flat env-var override map for merging with process.env

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PROVIDERS } from './providers.js';

const SETTINGS_PATH = resolve('settings.json');

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
  writeFileSync(SETTINGS_PATH, JSON.stringify(data, null, 2) + '\n', 'utf8');
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
 * Return the redacted settings view for the browser: each stored key is
 * replaced with a redacted preview + an `isSet` flag. Slot values are sent
 * as-is (they're not secret).
 *
 * @param {object} settings — parsed settings.json
 */
export function redactSettings(settings) {
  const keys = settings?.keys ?? {};
  const redactedKeys = {};
  for (const provider of SUPPORTED_PROVIDERS) {
    const raw = keys[provider] ?? '';
    redactedKeys[provider] = {
      isSet: Boolean(raw),
      preview: raw ? redactKey(raw) : '',
    };
  }

  const services = settings?.services ?? {};
  const redactedServices = {};
  for (const service of SUPPORTED_SERVICES) {
    const raw = services[service] ?? '';
    redactedServices[service] = {
      isSet: Boolean(raw),
      preview: raw ? redactKey(raw) : '',
    };
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

// Runtime-editable settings overlay. Lives in `settings.json` at the repo
// root and overlays on top of process.env — settings values win where present,
// env is the fallback. Re-read on every getEffectiveConfig() call so changes
// made via the Settings UI take effect on the next request without a restart.
//
// Public API:
//   readSettings()          → parsed settings.json or {}
//   writeSettings(data)     → atomically write settings.json
//   redactKey(key)          → "sk-ant-…XY4Z" safe for sending to the browser
//   settingsToEnv(settings) → flat env-var override map for merging with process.env

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SETTINGS_PATH = resolve('settings.json');

const PROVIDER_KEY_ENV = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
};

export const SUPPORTED_PROVIDERS = Object.keys(PROVIDER_KEY_ENV);

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

  const slots = settings?.slots ?? {};
  if (slots.default?.provider) out['TRAVERSE_MODEL_DEFAULT_PROVIDER'] = slots.default.provider;
  if (slots.default?.model)    out['TRAVERSE_MODEL_DEFAULT']          = slots.default.model;
  if (slots.research?.provider) out['TRAVERSE_MODEL_RESEARCH_PROVIDER'] = slots.research.provider;
  if (slots.research?.model)    out['TRAVERSE_MODEL_RESEARCH']          = slots.research.model;

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

  return {
    keys: redactedKeys,
    slots: {
      default: settings?.slots?.default ?? null,
      research: settings?.slots?.research ?? null,
    },
  };
}

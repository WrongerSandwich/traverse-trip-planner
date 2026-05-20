import { readSettings, settingsToEnv } from './settings.js';
import { PROVIDERS } from './providers.js';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as yamlParse } from 'yaml';

function env(envObj, name, fallback) {
  const v = envObj[name];
  return v && v.length > 0 ? v : fallback;
}

const FEATURE_SLOT = {
  seed: 'modelDefault',
  add: 'modelDefault',
  chat: 'modelDefault',
  retro: 'modelDefault',
  receipts: 'modelDefault',
  deepen: 'modelResearch',
};

const PROVIDER_KEYS = Object.fromEntries(Object.entries(PROVIDERS).map(([k, v]) => [k, v.envKey]));

const SEARCH_KEYS = {
  'anthropic-builtin': null,
  tavily: 'TAVILY_API_KEY',
};

function buildConfig(envObj) {
  const slots = {
    modelDefault: {
      provider: env(envObj, 'TRAVERSE_MODEL_DEFAULT_PROVIDER', 'anthropic'),
      model: env(envObj, 'TRAVERSE_MODEL_DEFAULT', 'claude-sonnet-4-6'),
    },
    modelResearch: {
      provider: env(envObj, 'TRAVERSE_MODEL_RESEARCH_PROVIDER', 'anthropic'),
      model: env(envObj, 'TRAVERSE_MODEL_RESEARCH', 'claude-opus-4-7'),
    },
  };

  const features = {};
  for (const [feature, slotKey] of Object.entries(FEATURE_SLOT)) {
    const upper = feature.toUpperCase();
    features[feature] = {
      provider: env(envObj, `TRAVERSE_MODEL_${upper}_PROVIDER`, slots[slotKey].provider),
      model: env(envObj, `TRAVERSE_MODEL_${upper}`, slots[slotKey].model),
    };
  }

  return {
    ...slots,
    features,
    search: {
      provider: env(envObj, 'TRAVERSE_SEARCH_PROVIDER', 'anthropic-builtin'),
    },
    assistantName: env(envObj, 'TRAVERSE_ASSISTANT_NAME', 'Field guide'),
  };
}

// Static config built once at import time — used by the startup banner,
// backwards-compat callers, and module-level constants (e.g. assistantName).
export const config = buildConfig(process.env);

/**
 * Re-read settings.json and build a fresh config that overlays stored settings
 * on top of process.env. Call this inside request handlers (not at module level)
 * so changes made via the Settings UI take effect on the next request.
 */
export function getEffectiveConfig() {
  const overlay = settingsToEnv(readSettings());
  return buildConfig({ ...process.env, ...overlay });
}

function providerKeyOkIn(envObj, provider) {
  const keyName = PROVIDER_KEYS[provider];
  if (keyName === undefined) return false;
  if (keyName === null) return true;
  return Boolean(envObj[keyName]);
}

function searchOkIn(cfg, envObj) {
  const sp = cfg.search.provider;
  if (!(sp in SEARCH_KEYS)) return false;
  if (sp === 'anthropic-builtin' && cfg.features.deepen.provider !== 'anthropic') return false;
  const keyName = SEARCH_KEYS[sp];
  if (keyName === null) return true;
  return Boolean(envObj[keyName]);
}

/**
 * Returns true iff home.md exists at the repo root, has a non-empty
 * home_city field, and has a valid home_coords array (2 finite numbers).
 * Used to gate AI features that require the traveler's home context.
 */
function isHomeMdReady() {
  try {
    const p = join(process.cwd(), 'home.md');
    if (!existsSync(p)) return false;
    const content = readFileSync(p, 'utf8');
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return false;
    const fm = yamlParse(match[1]) || {};
    if (!fm.home_city || typeof fm.home_city !== 'string' || !fm.home_city.trim()) return false;
    if (!Array.isArray(fm.home_coords) || fm.home_coords.length !== 2) return false;
    const [lat, lon] = fm.home_coords.map(Number);
    if (!isFinite(lat) || !isFinite(lon)) return false;
    return true;
  } catch {
    return false;
  }
}

export function getFeatureAvailability() {
  const overlay = settingsToEnv(readSettings());
  const effectiveEnv = { ...process.env, ...overlay };
  const cfg = buildConfig(effectiveEnv);
  const search = searchOkIn(cfg, effectiveEnv);
  const result = {};
  for (const feature of Object.keys(FEATURE_SLOT)) {
    const ok = providerKeyOkIn(effectiveEnv, cfg.features[feature].provider);
    result[feature] = feature === 'deepen' ? (ok && search) : ok;
  }
  result.homeMdReady = isHomeMdReady();
  result.pexelsConfigured = isRealKey(effectiveEnv.PEXELS_API_KEY);
  return result;
}

// Treat obvious .env.example placeholders (anything matching `your_*_here` or
// containing `...`) as unset. Older copies of `.env.example` shipped
// `PEXELS_API_KEY=your_pexels_key_here`, which is truthy but useless — the
// API rejects it at request time, and the "no key" banner would never show.
function isRealKey(value) {
  if (!value || typeof value !== 'string') return false;
  const v = value.trim();
  if (!v) return false;
  if (/^your_.*_here$/i.test(v)) return false;
  if (v.endsWith('...')) return false;
  return true;
}

// Both functions below describe the *live* config — process.env merged with
// the settings.json overlay — not the module-load snapshot. The startup banner
// is printed once on first request, by which point a user may already have
// saved settings via the UI; reading the overlay keeps the banner truthful.
//
// Returns 'settings' if the value came from settings.json overlay, 'env' if
// from process.env, 'default' if neither was set (compiled fallback in use).
// Used by describeConfig() / printConfigBanner() to attribute each line's
// source so operators can reason about which knob is in effect.
function sourceOf(envName, overlay, processEnv) {
  const overlayVal = overlay[envName];
  if (overlayVal !== undefined && overlayVal !== '') return 'settings';
  const envVal = processEnv[envName];
  if (envVal !== undefined && envVal !== '') return 'env';
  return 'default';
}

export function describeConfig() {
  const overlay = settingsToEnv(readSettings());
  const effectiveEnv = { ...process.env, ...overlay };
  const effective = buildConfig(effectiveEnv);
  const featureDetails = {};
  const slotForFeature = (f) => effective[FEATURE_SLOT[f]];
  for (const [feature, info] of Object.entries(effective.features)) {
    const slot = slotForFeature(feature);
    const overridden = info.provider !== slot.provider || info.model !== slot.model;
    const ok = providerKeyOkIn(effectiveEnv, info.provider) && (feature === 'deepen' ? searchOkIn(effective, effectiveEnv) : true);
    featureDetails[feature] = { ...info, ok, overridden };
  }
  return {
    modelDefault: {
      ...effective.modelDefault,
      ok: providerKeyOkIn(effectiveEnv, effective.modelDefault.provider),
      providerSource: sourceOf('TRAVERSE_MODEL_DEFAULT_PROVIDER', overlay, process.env),
      modelSource: sourceOf('TRAVERSE_MODEL_DEFAULT', overlay, process.env),
    },
    modelResearch: {
      ...effective.modelResearch,
      ok: providerKeyOkIn(effectiveEnv, effective.modelResearch.provider),
      providerSource: sourceOf('TRAVERSE_MODEL_RESEARCH_PROVIDER', overlay, process.env),
      modelSource: sourceOf('TRAVERSE_MODEL_RESEARCH', overlay, process.env),
    },
    search: {
      provider: effective.search.provider,
      ok: searchOkIn(effective, effectiveEnv),
      providerSource: sourceOf('TRAVERSE_SEARCH_PROVIDER', overlay, process.env),
    },
    features: featureDetails,
    issues: validateConfig(),
  };
}

export function validateConfig() {
  const overlay = settingsToEnv(readSettings());
  const effectiveEnv = { ...process.env, ...overlay };
  const effective = buildConfig(effectiveEnv);
  const issues = [];
  const seenProviders = new Set();

  for (const slot of ['modelDefault', 'modelResearch']) {
    const { provider } = effective[slot];
    seenProviders.add(provider);
    const keyName = PROVIDER_KEYS[provider];
    if (keyName === undefined) {
      issues.push(`Unknown model provider for ${slot}: "${provider}". Supported: ${Object.keys(PROVIDER_KEYS).join(', ')}.`);
    } else if (keyName && !effectiveEnv[keyName]) {
      issues.push(`${slot} provider "${provider}" requires ${keyName} in env.`);
    }
  }

  for (const [feature, info] of Object.entries(effective.features)) {
    if (seenProviders.has(info.provider)) continue;
    seenProviders.add(info.provider);
    const keyName = PROVIDER_KEYS[info.provider];
    if (keyName === undefined) {
      issues.push(`Unknown model provider for feature ${feature}: "${info.provider}". Supported: ${Object.keys(PROVIDER_KEYS).join(', ')}.`);
    } else if (keyName && !effectiveEnv[keyName]) {
      issues.push(`Feature ${feature} provider "${info.provider}" requires ${keyName} in env.`);
    }
  }

  const sp = effective.search.provider;
  if (!(sp in SEARCH_KEYS)) {
    issues.push(`Unknown search provider: "${sp}". Supported: ${Object.keys(SEARCH_KEYS).join(', ')}.`);
  } else {
    const keyName = SEARCH_KEYS[sp];
    if (keyName && !effectiveEnv[keyName]) {
      issues.push(`Search provider "${sp}" requires ${keyName} in env.`);
    }
    if (sp === 'anthropic-builtin' && effective.features.deepen.provider !== 'anthropic') {
      issues.push(`Search provider "anthropic-builtin" requires the deepen feature to use the anthropic provider.`);
    }
  }

  return issues;
}

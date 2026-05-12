import { readSettings, settingsToEnv } from './settings.js';

function env(envObj, name, fallback) {
  const v = envObj[name];
  return v && v.length > 0 ? v : fallback;
}

const FEATURE_SLOT = {
  seed: 'modelDefault',
  add: 'modelDefault',
  lock: 'modelDefault',
  chat: 'modelDefault',
  retro: 'modelDefault',
  receipts: 'modelDefault',
  deepen: 'modelResearch',
};

const PROVIDER_KEYS = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
};

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
    shareSecret: env(envObj, 'TRAVERSE_SHARE_SECRET', ''),
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
  result.share = Boolean(cfg.shareSecret);
  return result;
}

export function describeConfig() {
  const overlay = settingsToEnv(readSettings());
  const effectiveEnv = { ...process.env, ...overlay };
  const featureDetails = {};
  const slotForFeature = (f) => config[FEATURE_SLOT[f]];
  for (const [feature, info] of Object.entries(config.features)) {
    const slot = slotForFeature(feature);
    const overridden = info.provider !== slot.provider || info.model !== slot.model;
    const ok = providerKeyOkIn(effectiveEnv, info.provider) && (feature === 'deepen' ? searchOkIn(config, effectiveEnv) : true);
    featureDetails[feature] = { ...info, ok, overridden };
  }
  return {
    modelDefault: { ...config.modelDefault, ok: providerKeyOkIn(effectiveEnv, config.modelDefault.provider) },
    modelResearch: { ...config.modelResearch, ok: providerKeyOkIn(effectiveEnv, config.modelResearch.provider) },
    search: { provider: config.search.provider, ok: searchOkIn(config, effectiveEnv) },
    features: featureDetails,
    issues: validateConfig(),
  };
}

export function validateConfig() {
  const overlay = settingsToEnv(readSettings());
  const effectiveEnv = { ...process.env, ...overlay };
  const issues = [];
  const seenProviders = new Set();

  for (const slot of ['modelDefault', 'modelResearch']) {
    const { provider } = config[slot];
    seenProviders.add(provider);
    const keyName = PROVIDER_KEYS[provider];
    if (keyName === undefined) {
      issues.push(`Unknown model provider for ${slot}: "${provider}". Supported: ${Object.keys(PROVIDER_KEYS).join(', ')}.`);
    } else if (keyName && !effectiveEnv[keyName]) {
      issues.push(`${slot} provider "${provider}" requires ${keyName} in env.`);
    }
  }

  for (const [feature, info] of Object.entries(config.features)) {
    if (seenProviders.has(info.provider)) continue;
    seenProviders.add(info.provider);
    const keyName = PROVIDER_KEYS[info.provider];
    if (keyName === undefined) {
      issues.push(`Unknown model provider for feature ${feature}: "${info.provider}". Supported: ${Object.keys(PROVIDER_KEYS).join(', ')}.`);
    } else if (keyName && !effectiveEnv[keyName]) {
      issues.push(`Feature ${feature} provider "${info.provider}" requires ${keyName} in env.`);
    }
  }

  const sp = config.search.provider;
  if (!(sp in SEARCH_KEYS)) {
    issues.push(`Unknown search provider: "${sp}". Supported: ${Object.keys(SEARCH_KEYS).join(', ')}.`);
  } else {
    const keyName = SEARCH_KEYS[sp];
    if (keyName && !effectiveEnv[keyName]) {
      issues.push(`Search provider "${sp}" requires ${keyName} in env.`);
    }
    if (sp === 'anthropic-builtin' && config.features.deepen.provider !== 'anthropic') {
      issues.push(`Search provider "anthropic-builtin" requires the deepen feature to use the anthropic provider.`);
    }
  }

  return issues;
}

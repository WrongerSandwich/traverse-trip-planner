function env(name, fallback) {
  const v = process.env[name];
  return v && v.length > 0 ? v : fallback;
}

const FEATURE_SLOT = {
  seed: 'modelDefault',
  add: 'modelDefault',
  lock: 'modelDefault',
  chat: 'modelDefault',
  deepen: 'modelResearch',
};

const slots = {
  modelDefault: {
    provider: env('TRAVERSE_MODEL_DEFAULT_PROVIDER', 'anthropic'),
    model: env('TRAVERSE_MODEL_DEFAULT', 'claude-sonnet-4-6'),
  },
  modelResearch: {
    provider: env('TRAVERSE_MODEL_RESEARCH_PROVIDER', 'anthropic'),
    model: env('TRAVERSE_MODEL_RESEARCH', 'claude-opus-4-7'),
  },
};

const features = {};
for (const [feature, slotKey] of Object.entries(FEATURE_SLOT)) {
  const upper = feature.toUpperCase();
  features[feature] = {
    provider: env(`TRAVERSE_MODEL_${upper}_PROVIDER`, slots[slotKey].provider),
    model: env(`TRAVERSE_MODEL_${upper}`, slots[slotKey].model),
  };
}

export const config = {
  ...slots,
  features,
  search: {
    provider: env('TRAVERSE_SEARCH_PROVIDER', 'anthropic-builtin'),
  },
  assistantName: env('TRAVERSE_ASSISTANT_NAME', 'Field guide'),
  shareSecret: env('TRAVERSE_SHARE_SECRET', ''),
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

function providerKeyOk(provider) {
  const keyName = PROVIDER_KEYS[provider];
  if (keyName === undefined) return false;
  if (keyName === null) return true;
  return Boolean(process.env[keyName]);
}

function searchOk() {
  const sp = config.search.provider;
  if (!(sp in SEARCH_KEYS)) return false;
  if (sp === 'anthropic-builtin' && config.features.deepen.provider !== 'anthropic') return false;
  const keyName = SEARCH_KEYS[sp];
  if (keyName === null) return true;
  return Boolean(process.env[keyName]);
}

export function getFeatureAvailability() {
  const search = searchOk();
  const result = {};
  for (const feature of Object.keys(FEATURE_SLOT)) {
    const ok = providerKeyOk(config.features[feature].provider);
    result[feature] = feature === 'deepen' ? (ok && search) : ok;
  }
  result.share = Boolean(config.shareSecret);
  return result;
}

export function describeConfig() {
  const featureDetails = {};
  const slotForFeature = (f) => slots[FEATURE_SLOT[f]];
  for (const [feature, info] of Object.entries(config.features)) {
    const slot = slotForFeature(feature);
    const overridden = info.provider !== slot.provider || info.model !== slot.model;
    const ok = providerKeyOk(info.provider) && (feature === 'deepen' ? searchOk() : true);
    featureDetails[feature] = { ...info, ok, overridden };
  }
  return {
    modelDefault: { ...config.modelDefault, ok: providerKeyOk(config.modelDefault.provider) },
    modelResearch: { ...config.modelResearch, ok: providerKeyOk(config.modelResearch.provider) },
    search: { provider: config.search.provider, ok: searchOk() },
    features: featureDetails,
    issues: validateConfig(),
  };
}

export function validateConfig() {
  const issues = [];
  const seenProviders = new Set();

  for (const slot of ['modelDefault', 'modelResearch']) {
    const { provider } = config[slot];
    seenProviders.add(provider);
    const keyName = PROVIDER_KEYS[provider];
    if (keyName === undefined) {
      issues.push(`Unknown model provider for ${slot}: "${provider}". Supported: ${Object.keys(PROVIDER_KEYS).join(', ')}.`);
    } else if (keyName && !process.env[keyName]) {
      issues.push(`${slot} provider "${provider}" requires ${keyName} in env.`);
    }
  }

  // Per-feature overrides may introduce providers not used by either slot.
  for (const [feature, info] of Object.entries(config.features)) {
    if (seenProviders.has(info.provider)) continue;
    seenProviders.add(info.provider);
    const keyName = PROVIDER_KEYS[info.provider];
    if (keyName === undefined) {
      issues.push(`Unknown model provider for feature ${feature}: "${info.provider}". Supported: ${Object.keys(PROVIDER_KEYS).join(', ')}.`);
    } else if (keyName && !process.env[keyName]) {
      issues.push(`Feature ${feature} provider "${info.provider}" requires ${keyName} in env.`);
    }
  }

  const sp = config.search.provider;
  if (!(sp in SEARCH_KEYS)) {
    issues.push(`Unknown search provider: "${sp}". Supported: ${Object.keys(SEARCH_KEYS).join(', ')}.`);
  } else {
    const keyName = SEARCH_KEYS[sp];
    if (keyName && !process.env[keyName]) {
      issues.push(`Search provider "${sp}" requires ${keyName} in env.`);
    }
    if (sp === 'anthropic-builtin' && config.features.deepen.provider !== 'anthropic') {
      issues.push(`Search provider "anthropic-builtin" requires the deepen feature to use the anthropic provider.`);
    }
  }

  return issues;
}

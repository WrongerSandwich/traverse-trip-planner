function env(name, fallback) {
  const v = process.env[name];
  return v && v.length > 0 ? v : fallback;
}

export const config = {
  modelDefault: {
    provider: env('ATLAS_MODEL_DEFAULT_PROVIDER', 'anthropic'),
    model: env('ATLAS_MODEL_DEFAULT', 'claude-sonnet-4-6'),
  },
  modelResearch: {
    provider: env('ATLAS_MODEL_RESEARCH_PROVIDER', 'anthropic'),
    model: env('ATLAS_MODEL_RESEARCH', 'claude-opus-4-7'),
  },
  search: {
    provider: env('ATLAS_SEARCH_PROVIDER', 'anthropic-builtin'),
  },
  assistantName: env('ATLAS_ASSISTANT_NAME', 'Claude'),
};

const PROVIDER_KEYS = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
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
  if (sp === 'anthropic-builtin' && config.modelResearch.provider !== 'anthropic') return false;
  const keyName = SEARCH_KEYS[sp];
  if (keyName === null) return true;
  return Boolean(process.env[keyName]);
}

export function getFeatureAvailability() {
  const defaultOk = providerKeyOk(config.modelDefault.provider);
  const researchOk = providerKeyOk(config.modelResearch.provider);
  const search = searchOk();
  return {
    seed: defaultOk,
    add: defaultOk,
    lock: defaultOk,
    chat: defaultOk,
    deepen: researchOk && search,
  };
}

export function describeConfig() {
  const features = getFeatureAvailability();
  return {
    modelDefault: { ...config.modelDefault, ok: providerKeyOk(config.modelDefault.provider) },
    modelResearch: { ...config.modelResearch, ok: providerKeyOk(config.modelResearch.provider) },
    search: { provider: config.search.provider, ok: searchOk() },
    features,
    issues: validateConfig(),
  };
}

export function validateConfig() {
  const issues = [];

  for (const slot of ['modelDefault', 'modelResearch']) {
    const { provider } = config[slot];
    const keyName = PROVIDER_KEYS[provider];
    if (keyName === undefined) {
      issues.push(`Unknown model provider for ${slot}: "${provider}". Supported: ${Object.keys(PROVIDER_KEYS).join(', ')}.`);
    } else if (keyName && !process.env[keyName]) {
      issues.push(`${slot} provider "${provider}" requires ${keyName} in env.`);
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
    if (sp === 'anthropic-builtin' && config.modelResearch.provider !== 'anthropic') {
      issues.push(`Search provider "anthropic-builtin" requires ATLAS_MODEL_RESEARCH_PROVIDER=anthropic.`);
    }
  }

  return issues;
}

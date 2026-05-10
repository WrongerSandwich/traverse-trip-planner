import { describe, it, expect, beforeEach, vi } from 'vitest';

const TRAVERSE_KEYS = [
  'TRAVERSE_MODEL_DEFAULT_PROVIDER',
  'TRAVERSE_MODEL_DEFAULT',
  'TRAVERSE_MODEL_RESEARCH_PROVIDER',
  'TRAVERSE_MODEL_RESEARCH',
  'TRAVERSE_SEARCH_PROVIDER',
  'TRAVERSE_ASSISTANT_NAME',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'TAVILY_API_KEY',
  // Per-feature overrides
  'TRAVERSE_MODEL_SEED_PROVIDER', 'TRAVERSE_MODEL_SEED',
  'TRAVERSE_MODEL_ADD_PROVIDER', 'TRAVERSE_MODEL_ADD',
  'TRAVERSE_MODEL_LOCK_PROVIDER', 'TRAVERSE_MODEL_LOCK',
  'TRAVERSE_MODEL_CHAT_PROVIDER', 'TRAVERSE_MODEL_CHAT',
  'TRAVERSE_MODEL_DEEPEN_PROVIDER', 'TRAVERSE_MODEL_DEEPEN',
  'TRAVERSE_SHARE_SECRET',
];

function clearEnv() {
  for (const k of TRAVERSE_KEYS) delete process.env[k];
}

async function loadConfig(env = {}) {
  clearEnv();
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  vi.resetModules();
  return import('../src/lib/server/config.js');
}

describe('config defaults', () => {
  beforeEach(clearEnv);

  it('falls back to anthropic + claude defaults when nothing is set', async () => {
    const { config } = await loadConfig();
    expect(config.modelDefault).toEqual({ provider: 'anthropic', model: 'claude-sonnet-4-6' });
    expect(config.modelResearch).toEqual({ provider: 'anthropic', model: 'claude-opus-4-7' });
    expect(config.search.provider).toBe('anthropic-builtin');
    expect(config.assistantName).toBe('Claude');
  });

  it('honors env overrides', async () => {
    const { config } = await loadConfig({
      TRAVERSE_MODEL_DEFAULT_PROVIDER: 'openai',
      TRAVERSE_MODEL_DEFAULT: 'gpt-4o-mini',
      TRAVERSE_SEARCH_PROVIDER: 'tavily',
      TRAVERSE_ASSISTANT_NAME: 'GPT',
    });
    expect(config.modelDefault).toEqual({ provider: 'openai', model: 'gpt-4o-mini' });
    expect(config.search.provider).toBe('tavily');
    expect(config.assistantName).toBe('GPT');
  });
});

describe('validateConfig', () => {
  it('flags missing anthropic key when provider is anthropic', async () => {
    const { validateConfig } = await loadConfig();
    const issues = validateConfig();
    expect(issues.some(i => i.includes('ANTHROPIC_API_KEY'))).toBe(true);
  });

  it('passes cleanly when all keys are present', async () => {
    const { validateConfig } = await loadConfig({
      ANTHROPIC_API_KEY: 'sk-ant-test',
    });
    expect(validateConfig()).toEqual([]);
  });

  it('flags anthropic-builtin search with non-Anthropic research provider', async () => {
    const { validateConfig } = await loadConfig({
      TRAVERSE_MODEL_RESEARCH_PROVIDER: 'openai',
      OPENAI_API_KEY: 'sk-test',
      ANTHROPIC_API_KEY: 'sk-ant-test',
    });
    const issues = validateConfig();
    expect(issues.some(i => i.includes('anthropic-builtin'))).toBe(true);
  });

  it('flags unknown provider names', async () => {
    const { validateConfig } = await loadConfig({
      TRAVERSE_MODEL_DEFAULT_PROVIDER: 'cohere',
    });
    const issues = validateConfig();
    expect(issues.some(i => i.includes('Unknown model provider'))).toBe(true);
  });

  it('flags tavily without TAVILY_API_KEY', async () => {
    const { validateConfig } = await loadConfig({
      ANTHROPIC_API_KEY: 'sk-ant-test',
      TRAVERSE_SEARCH_PROVIDER: 'tavily',
    });
    const issues = validateConfig();
    expect(issues.some(i => i.includes('TAVILY_API_KEY'))).toBe(true);
  });
});

describe('getFeatureAvailability', () => {
  it('disables every feature when no keys are set', async () => {
    const { getFeatureAvailability } = await loadConfig();
    expect(getFeatureAvailability()).toEqual({
      seed: false, add: false, lock: false, chat: false, deepen: false, share: false,
    });
  });

  it('enables all features with anthropic + builtin search', async () => {
    const { getFeatureAvailability } = await loadConfig({ ANTHROPIC_API_KEY: 'sk-ant-test' });
    expect(getFeatureAvailability()).toEqual({
      seed: true, add: true, lock: true, chat: true, deepen: true, share: false,
    });
  });

  it('enables share when TRAVERSE_SHARE_SECRET is set', async () => {
    const { getFeatureAvailability } = await loadConfig({
      ANTHROPIC_API_KEY: 'sk-ant-test',
      TRAVERSE_SHARE_SECRET: 'shh',
    });
    expect(getFeatureAvailability().share).toBe(true);
  });

  it('disables only deepen when search backend is misconfigured', async () => {
    const { getFeatureAvailability } = await loadConfig({
      ANTHROPIC_API_KEY: 'sk-ant-test',
      TRAVERSE_SEARCH_PROVIDER: 'tavily',
      // TAVILY_API_KEY missing
    });
    const f = getFeatureAvailability();
    expect(f.seed).toBe(true);
    expect(f.add).toBe(true);
    expect(f.deepen).toBe(false);
  });

  it('handles split-provider config (anthropic default, openai research)', async () => {
    const { getFeatureAvailability } = await loadConfig({
      ANTHROPIC_API_KEY: 'sk-ant-test',
      TRAVERSE_MODEL_RESEARCH_PROVIDER: 'openai',
      OPENAI_API_KEY: 'sk-test',
      TRAVERSE_SEARCH_PROVIDER: 'tavily',
      TAVILY_API_KEY: 'tvly-test',
    });
    expect(getFeatureAvailability().deepen).toBe(true);
  });
});

describe('describeConfig', () => {
  it('returns a full snapshot including features and issues', async () => {
    const { describeConfig } = await loadConfig({ ANTHROPIC_API_KEY: 'sk-ant-test' });
    const d = describeConfig();
    expect(d.modelDefault.ok).toBe(true);
    expect(d.modelResearch.ok).toBe(true);
    expect(d.search.ok).toBe(true);
    expect(d.features.deepen.ok).toBe(true);
    expect(d.features.deepen.provider).toBe('anthropic');
    expect(d.features.deepen.overridden).toBe(false);
    expect(d.issues).toEqual([]);
  });

  it('marks slots as not-ok when their key is missing', async () => {
    const { describeConfig } = await loadConfig();
    const d = describeConfig();
    expect(d.modelDefault.ok).toBe(false);
    expect(d.search.ok).toBe(true); // anthropic-builtin doesn't need its own key
  });

  it('flags overridden features in the snapshot', async () => {
    const { describeConfig } = await loadConfig({
      ANTHROPIC_API_KEY: 'sk-ant-test',
      TRAVERSE_MODEL_LOCK: 'claude-haiku-4-5',
    });
    const d = describeConfig();
    expect(d.features.lock.overridden).toBe(true);
    expect(d.features.lock.model).toBe('claude-haiku-4-5');
    expect(d.features.seed.overridden).toBe(false);
  });
});

describe('per-feature model overrides', () => {
  it('every feature inherits its slot defaults when no overrides set', async () => {
    const { config } = await loadConfig();
    expect(config.features.seed).toEqual(config.modelDefault);
    expect(config.features.add).toEqual(config.modelDefault);
    expect(config.features.lock).toEqual(config.modelDefault);
    expect(config.features.chat).toEqual(config.modelDefault);
    expect(config.features.deepen).toEqual(config.modelResearch);
  });

  it('TRAVERSE_MODEL_LOCK overrides only the lock feature', async () => {
    const { config } = await loadConfig({
      TRAVERSE_MODEL_LOCK: 'claude-haiku-4-5',
    });
    expect(config.features.lock.model).toBe('claude-haiku-4-5');
    expect(config.features.lock.provider).toBe('anthropic'); // inherits slot's provider
    expect(config.features.seed.model).toBe('claude-sonnet-4-6'); // others untouched
  });

  it('TRAVERSE_MODEL_CHAT_PROVIDER allows different provider per feature', async () => {
    const { config } = await loadConfig({
      TRAVERSE_MODEL_CHAT_PROVIDER: 'openai',
      TRAVERSE_MODEL_CHAT: 'gpt-4o-mini',
      ANTHROPIC_API_KEY: 'sk-ant-test',
      OPENAI_API_KEY: 'sk-test',
    });
    expect(config.features.chat).toEqual({ provider: 'openai', model: 'gpt-4o-mini' });
    expect(config.features.seed.provider).toBe('anthropic');
  });

  it('disables only the overridden feature when its provider key is missing', async () => {
    const { getFeatureAvailability } = await loadConfig({
      ANTHROPIC_API_KEY: 'sk-ant-test',
      TRAVERSE_MODEL_LOCK_PROVIDER: 'openai',
      // OPENAI_API_KEY missing
    });
    const f = getFeatureAvailability();
    expect(f.seed).toBe(true);
    expect(f.add).toBe(true);
    expect(f.lock).toBe(false); // override breaks only lock
    expect(f.chat).toBe(true);
    expect(f.deepen).toBe(true);
  });

  it('flags missing provider key for an overridden feature in validateConfig', async () => {
    const { validateConfig } = await loadConfig({
      ANTHROPIC_API_KEY: 'sk-ant-test',
      TRAVERSE_MODEL_LOCK_PROVIDER: 'openai',
    });
    const issues = validateConfig();
    expect(issues.some(i => i.includes('Feature lock') && i.includes('OPENAI_API_KEY'))).toBe(true);
  });
});

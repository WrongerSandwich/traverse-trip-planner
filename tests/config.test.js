import { describe, it, expect, beforeEach, vi } from 'vitest';

const ATLAS_KEYS = [
  'ATLAS_MODEL_DEFAULT_PROVIDER',
  'ATLAS_MODEL_DEFAULT',
  'ATLAS_MODEL_RESEARCH_PROVIDER',
  'ATLAS_MODEL_RESEARCH',
  'ATLAS_SEARCH_PROVIDER',
  'ATLAS_ASSISTANT_NAME',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'TAVILY_API_KEY',
];

function clearEnv() {
  for (const k of ATLAS_KEYS) delete process.env[k];
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
      ATLAS_MODEL_DEFAULT_PROVIDER: 'openai',
      ATLAS_MODEL_DEFAULT: 'gpt-4o-mini',
      ATLAS_SEARCH_PROVIDER: 'tavily',
      ATLAS_ASSISTANT_NAME: 'GPT',
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
      ATLAS_MODEL_RESEARCH_PROVIDER: 'openai',
      OPENAI_API_KEY: 'sk-test',
      ANTHROPIC_API_KEY: 'sk-ant-test',
    });
    const issues = validateConfig();
    expect(issues.some(i => i.includes('anthropic-builtin'))).toBe(true);
  });

  it('flags unknown provider names', async () => {
    const { validateConfig } = await loadConfig({
      ATLAS_MODEL_DEFAULT_PROVIDER: 'cohere',
    });
    const issues = validateConfig();
    expect(issues.some(i => i.includes('Unknown model provider'))).toBe(true);
  });

  it('flags tavily without TAVILY_API_KEY', async () => {
    const { validateConfig } = await loadConfig({
      ANTHROPIC_API_KEY: 'sk-ant-test',
      ATLAS_SEARCH_PROVIDER: 'tavily',
    });
    const issues = validateConfig();
    expect(issues.some(i => i.includes('TAVILY_API_KEY'))).toBe(true);
  });
});

describe('getFeatureAvailability', () => {
  it('disables every feature when no keys are set', async () => {
    const { getFeatureAvailability } = await loadConfig();
    expect(getFeatureAvailability()).toEqual({
      seed: false, add: false, lock: false, chat: false, deepen: false,
    });
  });

  it('enables all features with anthropic + builtin search', async () => {
    const { getFeatureAvailability } = await loadConfig({ ANTHROPIC_API_KEY: 'sk-ant-test' });
    expect(getFeatureAvailability()).toEqual({
      seed: true, add: true, lock: true, chat: true, deepen: true,
    });
  });

  it('disables only deepen when search backend is misconfigured', async () => {
    const { getFeatureAvailability } = await loadConfig({
      ANTHROPIC_API_KEY: 'sk-ant-test',
      ATLAS_SEARCH_PROVIDER: 'tavily',
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
      ATLAS_MODEL_RESEARCH_PROVIDER: 'openai',
      OPENAI_API_KEY: 'sk-test',
      ATLAS_SEARCH_PROVIDER: 'tavily',
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
    expect(d.features.deepen).toBe(true);
    expect(d.issues).toEqual([]);
  });

  it('marks slots as not-ok when their key is missing', async () => {
    const { describeConfig } = await loadConfig();
    const d = describeConfig();
    expect(d.modelDefault.ok).toBe(false);
    expect(d.search.ok).toBe(true); // anthropic-builtin doesn't need its own key
  });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock node:fs so settings.json on disk doesn't sneak into these tests.
// readSettings() (used by getFeatureAvailability and getEffectiveConfig)
// reads settings.json from the repo root, and a real one with provider keys
// would flip feature flags on even though the test sets no env values.
// existsSync returns false by default — home.md treated as absent (homeMdReady: false).
vi.mock('node:fs', () => ({
  readFileSync: () => { throw new Error('ENOENT'); },
  writeFileSync: () => {},
  existsSync: () => false,
}));

const TRAVERSE_KEYS = [
  'TRAVERSE_MODEL_DEFAULT_PROVIDER',
  'TRAVERSE_MODEL_DEFAULT',
  'TRAVERSE_MODEL_RESEARCH_PROVIDER',
  'TRAVERSE_MODEL_RESEARCH',
  'TRAVERSE_SEARCH_PROVIDER',
  'TRAVERSE_ASSISTANT_NAME',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'OPENROUTER_API_KEY',
  'TAVILY_API_KEY',
  // Per-feature overrides
  'TRAVERSE_MODEL_SEED_PROVIDER', 'TRAVERSE_MODEL_SEED',
  'TRAVERSE_MODEL_ADD_PROVIDER', 'TRAVERSE_MODEL_ADD',
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
    expect(config.assistantName).toBe('Field guide');
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
      seed: false, add: false, chat: false, retro: false, receipts: false, deepen: false, share: false,
      homeMdReady: false,
      pexelsConfigured: false,
    });
  });

  it('enables all features with anthropic + builtin search', async () => {
    const { getFeatureAvailability } = await loadConfig({ ANTHROPIC_API_KEY: 'sk-ant-test' });
    expect(getFeatureAvailability()).toEqual({
      seed: true, add: true, chat: true, retro: true, receipts: true, deepen: true, share: false,
      homeMdReady: false,
      pexelsConfigured: false,
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
      TRAVERSE_MODEL_CHAT: 'claude-haiku-4-5',
    });
    const d = describeConfig();
    expect(d.features.chat.overridden).toBe(true);
    expect(d.features.chat.model).toBe('claude-haiku-4-5');
    expect(d.features.seed.overridden).toBe(false);
  });

  it('reflects the settings.json overlay, not just the module-load snapshot', async () => {
    // Module load has `TRAVERSE_MODEL_RESEARCH=claude-opus-4-7` (the default).
    // settings.json overlays research → openrouter/google/gemini-3.1-pro-preview.
    // The banner must show the overlay, since that's what live requests use.
    clearEnv();
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    vi.resetModules();
    vi.doMock('node:fs', () => ({
      readFileSync: () => JSON.stringify({
        keys: { openrouter: 'sk-or-test' },
        services: { tavily: 'tvly-test' },
        slots: {
          research: { provider: 'openrouter', model: 'google/gemini-3.1-pro-preview' },
        },
        search: { provider: 'tavily' },
      }),
      writeFileSync: () => {},
      existsSync: () => false,
    }));
    const { describeConfig } = await import('../src/lib/server/config.js');
    const d = describeConfig();
    expect(d.modelResearch.provider).toBe('openrouter');
    expect(d.modelResearch.model).toBe('google/gemini-3.1-pro-preview');
    expect(d.features.deepen.provider).toBe('openrouter');
    expect(d.search.provider).toBe('tavily');

    // Reset the fs mock so other tests don't see this overlay.
    vi.doMock('node:fs', () => ({
      readFileSync: () => { throw new Error('ENOENT'); },
      writeFileSync: () => {},
      existsSync: () => false,
    }));
  });
});

describe('OpenRouter provider', () => {
  it('recognizes openrouter as a valid provider', async () => {
    const { validateConfig } = await loadConfig({
      TRAVERSE_MODEL_DEFAULT_PROVIDER: 'openrouter',
      OPENROUTER_API_KEY: 'sk-or-test',
    });
    const issues = validateConfig();
    expect(issues.some(i => i.includes('Unknown model provider'))).toBe(false);
  });

  it('flags missing OPENROUTER_API_KEY', async () => {
    const { validateConfig } = await loadConfig({
      TRAVERSE_MODEL_DEFAULT_PROVIDER: 'openrouter',
    });
    const issues = validateConfig();
    expect(issues.some(i => i.includes('OPENROUTER_API_KEY'))).toBe(true);
  });

  it('flags anthropic-builtin search with openrouter research provider', async () => {
    const { validateConfig } = await loadConfig({
      TRAVERSE_MODEL_RESEARCH_PROVIDER: 'openrouter',
      OPENROUTER_API_KEY: 'sk-or-test',
      ANTHROPIC_API_KEY: 'sk-ant-test',
    });
    const issues = validateConfig();
    expect(issues.some(i => i.includes('anthropic-builtin'))).toBe(true);
  });

  it('enables deepen when openrouter + tavily are both configured', async () => {
    const { getFeatureAvailability } = await loadConfig({
      TRAVERSE_MODEL_RESEARCH_PROVIDER: 'openrouter',
      OPENROUTER_API_KEY: 'sk-or-test',
      ANTHROPIC_API_KEY: 'sk-ant-test',
      TRAVERSE_SEARCH_PROVIDER: 'tavily',
      TAVILY_API_KEY: 'tvly-test',
    });
    expect(getFeatureAvailability().deepen).toBe(true);
  });
});

describe('per-feature model overrides', () => {
  it('every feature inherits its slot defaults when no overrides set', async () => {
    const { config } = await loadConfig();
    expect(config.features.seed).toEqual(config.modelDefault);
    expect(config.features.add).toEqual(config.modelDefault);
    expect(config.features.chat).toEqual(config.modelDefault);
    expect(config.features.deepen).toEqual(config.modelResearch);
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
      TRAVERSE_MODEL_CHAT_PROVIDER: 'openai',
      // OPENAI_API_KEY missing
    });
    const f = getFeatureAvailability();
    expect(f.seed).toBe(true);
    expect(f.add).toBe(true);
    expect(f.chat).toBe(false); // override breaks only chat
    expect(f.deepen).toBe(true);
  });

  it('flags missing provider key for an overridden feature in validateConfig', async () => {
    const { validateConfig } = await loadConfig({
      ANTHROPIC_API_KEY: 'sk-ant-test',
      TRAVERSE_MODEL_CHAT_PROVIDER: 'openai',
    });
    const issues = validateConfig();
    expect(issues.some(i => i.includes('Feature chat') && i.includes('OPENAI_API_KEY'))).toBe(true);
  });
});

describe('homeMdReady', () => {
  const VALID_HOME_MD = `---
home_city: Kansas City
home_coords: [39.0997, -94.5786]
---

Some prose here.
`;

  // Helper that re-imports config.js with a custom fs mock for this test only.
  async function loadConfigWithFs(fsMock, env = { ANTHROPIC_API_KEY: 'sk-ant-test' }) {
    clearEnv();
    for (const [k, v] of Object.entries(env)) process.env[k] = v;
    vi.resetModules();
    vi.doMock('node:fs', () => fsMock);
    const mod = await import('../src/lib/server/config.js');
    vi.doMock('node:fs', () => ({
      readFileSync: () => { throw new Error('ENOENT'); },
      writeFileSync: () => {},
      existsSync: () => false,
    }));
    return mod;
  }

  it('returns homeMdReady: true for a valid home.md', async () => {
    const { getFeatureAvailability } = await loadConfigWithFs({
      existsSync: () => true,
      readFileSync: () => VALID_HOME_MD,
      writeFileSync: () => {},
    });
    expect(getFeatureAvailability().homeMdReady).toBe(true);
  });

  it('returns homeMdReady: false when home.md does not exist', async () => {
    const { getFeatureAvailability } = await loadConfigWithFs({
      existsSync: () => false,
      readFileSync: () => { throw new Error('ENOENT'); },
      writeFileSync: () => {},
    });
    expect(getFeatureAvailability().homeMdReady).toBe(false);
  });

  it('returns homeMdReady: false when home_city is missing', async () => {
    const noCity = `---
home_coords: [39.0997, -94.5786]
---
`;
    const { getFeatureAvailability } = await loadConfigWithFs({
      existsSync: () => true,
      readFileSync: () => noCity,
      writeFileSync: () => {},
    });
    expect(getFeatureAvailability().homeMdReady).toBe(false);
  });

  it('returns homeMdReady: false when home_coords is missing', async () => {
    const noCoords = `---
home_city: Kansas City
---
`;
    const { getFeatureAvailability } = await loadConfigWithFs({
      existsSync: () => true,
      readFileSync: () => noCoords,
      writeFileSync: () => {},
    });
    expect(getFeatureAvailability().homeMdReady).toBe(false);
  });

  it('returns homeMdReady: false when home_coords contains non-finite values', async () => {
    const badCoords = `---
home_city: Kansas City
home_coords: [NaN, -94.5786]
---
`;
    const { getFeatureAvailability } = await loadConfigWithFs({
      existsSync: () => true,
      readFileSync: () => badCoords,
      writeFileSync: () => {},
    });
    expect(getFeatureAvailability().homeMdReady).toBe(false);
  });

  // Regression: the onboarding writer (writeHomeMd → yamlStringify) emits
  // home_coords as a YAML block sequence, not the inline `[lat, lon]` form.
  // The readiness check must accept both shapes.
  it('returns homeMdReady: true when home_coords is a YAML block sequence', async () => {
    const blockForm = `---
home_city: Des Moines
home_coords:
  - 41.5868654
  - -93.6249494
---
`;
    const { getFeatureAvailability } = await loadConfigWithFs({
      existsSync: () => true,
      readFileSync: () => blockForm,
      writeFileSync: () => {},
    });
    expect(getFeatureAvailability().homeMdReady).toBe(true);
  });
});

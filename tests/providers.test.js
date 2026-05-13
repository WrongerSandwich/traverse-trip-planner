import { describe, it, expect } from 'vitest';
import { PROVIDERS } from '../src/lib/server/providers.js';

describe('PROVIDERS', () => {
  it('lists the three supported providers', () => {
    expect(Object.keys(PROVIDERS)).toEqual(['anthropic', 'openai', 'openrouter']);
  });

  it('every provider has a non-empty envKey string', () => {
    for (const [name, meta] of Object.entries(PROVIDERS)) {
      expect(typeof meta.envKey, `${name}.envKey`).toBe('string');
      expect(meta.envKey.length, `${name}.envKey`).toBeGreaterThan(0);
    }
  });

  it('every provider has a supportsImages boolean', () => {
    for (const [name, meta] of Object.entries(PROVIDERS)) {
      expect(typeof meta.supportsImages, `${name}.supportsImages`).toBe('boolean');
    }
  });

  it('all three providers support images', () => {
    for (const [name, meta] of Object.entries(PROVIDERS)) {
      expect(meta.supportsImages, `${name} should support images`).toBe(true);
    }
  });

  it('env keys match the expected API key names', () => {
    expect(PROVIDERS.anthropic.envKey).toBe('ANTHROPIC_API_KEY');
    expect(PROVIDERS.openai.envKey).toBe('OPENAI_API_KEY');
    expect(PROVIDERS.openrouter.envKey).toBe('OPENROUTER_API_KEY');
  });
});

describe('PROVIDERS as source of truth', () => {
  it('SUPPORTED_PROVIDERS in settings.js matches PROVIDERS keys', async () => {
    // settings.js now derives SUPPORTED_PROVIDERS from PROVIDERS — verify derivation
    const { SUPPORTED_PROVIDERS } = await import('../src/lib/server/settings.js');
    expect(SUPPORTED_PROVIDERS).toEqual(Object.keys(PROVIDERS));
  });
});

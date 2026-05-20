import { describe, it, expect, vi, beforeEach } from 'vitest';

// We test settings helpers in isolation — no real fs writes.
// The module reads/writes a file path resolved to 'settings.json' at repo root.
// We mock node:fs so no disk access happens in tests.

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  renameSync: vi.fn(),
}));
vi.mock('node:path', () => ({
  resolve: vi.fn((...args) => args.join('/')),
}));

import { readFileSync, writeFileSync } from 'node:fs';
import {
  readSettings,
  writeSettings,
  redactKey,
  settingsToEnv,
  redactSettings,
  SUPPORTED_PROVIDERS,
} from '../src/lib/server/settings.js';

// ── readSettings ─────────────────────────────────────────────────────────────

describe('readSettings', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns {} when settings.json does not exist', () => {
    readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
    expect(readSettings()).toEqual({});
  });

  it('returns parsed JSON when the file exists', () => {
    readFileSync.mockReturnValue(JSON.stringify({ keys: { anthropic: 'sk-ant-test' } }));
    expect(readSettings()).toEqual({ keys: { anthropic: 'sk-ant-test' } });
  });

  it('returns {} when the file contains invalid JSON', () => {
    readFileSync.mockReturnValue('not json{');
    expect(readSettings()).toEqual({});
  });
});

// ── writeSettings ─────────────────────────────────────────────────────────────

describe('writeSettings', () => {
  beforeEach(() => vi.clearAllMocks());

  it('writes pretty-printed JSON to settings.json', () => {
    const data = { keys: { anthropic: 'sk-ant-test' } };
    writeSettings(data);
    expect(writeFileSync).toHaveBeenCalledOnce();
    const [, content] = writeFileSync.mock.calls[0];
    expect(JSON.parse(content)).toEqual(data);
  });

  it('ends the file with a newline', () => {
    writeSettings({});
    const [, content] = writeFileSync.mock.calls[0];
    expect(content.endsWith('\n')).toBe(true);
  });
});

// ── redactKey ────────────────────────────────────────────────────────────────

describe('redactKey', () => {
  it('shows first 7 chars + ellipsis + last 4', () => {
    expect(redactKey('sk-ant-api03-ABCDEFGHIJ1234')).toBe('sk-ant-…1234');
  });

  it('returns ••• for keys shorter than 12 chars', () => {
    expect(redactKey('short')).toBe('•••');
    expect(redactKey('12345678901')).toBe('•••'); // 11 chars
  });

  it('returns ••• for null/undefined/empty', () => {
    expect(redactKey(null)).toBe('•••');
    expect(redactKey(undefined)).toBe('•••');
    expect(redactKey('')).toBe('•••');
  });

  it('handles a key exactly 12 chars', () => {
    // 12 chars: first 7 = "sk-ant-", last 4 = "7890"
    const result = redactKey('sk-ant-7890');
    // 11 chars → ••• (below threshold)
    expect(result).toBe('•••');
  });

  it('a 12-char key is masked (boundary: <12 → •••)', () => {
    const key12 = '123456789012'; // exactly 12
    const result = redactKey(key12);
    expect(result).toBe('1234567…9012');
  });
});

// ── settingsToEnv ─────────────────────────────────────────────────────────────

describe('settingsToEnv', () => {
  it('returns empty object for empty settings', () => {
    expect(settingsToEnv({})).toEqual({});
  });

  it('maps provider keys to their env var names', () => {
    const env = settingsToEnv({ keys: { anthropic: 'sk-ant-test', openai: 'sk-oai' } });
    expect(env['ANTHROPIC_API_KEY']).toBe('sk-ant-test');
    expect(env['OPENAI_API_KEY']).toBe('sk-oai');
    expect(env['OPENROUTER_API_KEY']).toBeUndefined();
  });

  it('maps slot provider/model to env vars', () => {
    const env = settingsToEnv({
      slots: {
        default: { provider: 'openai', model: 'gpt-4o-mini' },
        research: { provider: 'anthropic', model: 'claude-opus-4-7' },
      },
    });
    expect(env['TRAVERSE_MODEL_DEFAULT_PROVIDER']).toBe('openai');
    expect(env['TRAVERSE_MODEL_DEFAULT']).toBe('gpt-4o-mini');
    expect(env['TRAVERSE_MODEL_RESEARCH_PROVIDER']).toBe('anthropic');
    expect(env['TRAVERSE_MODEL_RESEARCH']).toBe('claude-opus-4-7');
  });

  it('omits empty or whitespace-only key values', () => {
    const env = settingsToEnv({ keys: { anthropic: '', openai: '  ' } });
    expect(env['ANTHROPIC_API_KEY']).toBeUndefined();
    expect(env['OPENAI_API_KEY']).toBeUndefined();
  });

  it('handles missing keys/slots gracefully', () => {
    expect(settingsToEnv({ keys: {} })).toEqual({});
    expect(settingsToEnv({ slots: {} })).toEqual({});
    expect(settingsToEnv(null)).toEqual({});
  });
});

// ── redactSettings ────────────────────────────────────────────────────────────

describe('redactSettings', () => {
  it('marks a settings.json-only key with source:settings and no envShadowed', () => {
    const view = redactSettings(
      { keys: { anthropic: 'sk-ant-api03-ABCDEFG1234' } },
      {} // empty env
    );
    expect(view.keys.anthropic.isSet).toBe(true);
    expect(view.keys.anthropic.source).toBe('settings');
    expect(view.keys.anthropic.preview).toContain('…');
    expect(view.keys.anthropic.envShadowed).toBe(null);
  });

  it('marks an env-only key with source:env', () => {
    const view = redactSettings(
      {},
      { ANTHROPIC_API_KEY: 'sk-ant-api03-FROMENVXYZ' }
    );
    expect(view.keys.anthropic.isSet).toBe(true);
    expect(view.keys.anthropic.source).toBe('env');
    expect(view.keys.anthropic.preview).toContain('…');
    expect(view.keys.anthropic.envShadowed).toBe(null);
  });

  it('marks settings as overriding when both .env and settings differ', () => {
    const view = redactSettings(
      { keys: { anthropic: 'sk-ant-api03-FROMSETTINGSXX' } },
      { ANTHROPIC_API_KEY: 'sk-ant-api03-FROMENVAAAA' }
    );
    expect(view.keys.anthropic.source).toBe('settings');
    expect(view.keys.anthropic.preview).toContain('GSXX'); // last 4 of settings value
    expect(view.keys.anthropic.envShadowed).not.toBe(null);
    expect(view.keys.anthropic.envShadowed.preview).toContain('AAAA');
  });

  it('does not flag envShadowed when settings and env values match', () => {
    const sameValue = 'sk-ant-api03-IDENTICAL12';
    const view = redactSettings(
      { keys: { anthropic: sameValue } },
      { ANTHROPIC_API_KEY: sameValue }
    );
    expect(view.keys.anthropic.source).toBe('settings');
    expect(view.keys.anthropic.envShadowed).toBe(null);
  });

  it('marks an unset key with source:unset and empty preview', () => {
    const view = redactSettings({}, {});
    for (const p of SUPPORTED_PROVIDERS) {
      expect(view.keys[p].isSet).toBe(false);
      expect(view.keys[p].source).toBe('unset');
      expect(view.keys[p].preview).toBe('');
      expect(view.keys[p].envShadowed).toBe(null);
    }
  });

  it('applies the same source logic to service keys', () => {
    const view = redactSettings(
      { services: { pexels: 'pex-FROM-SETTINGS-1' } },
      { PEXELS_API_KEY: 'pex-FROM-ENV-AAAA' }
    );
    expect(view.services.pexels.source).toBe('settings');
    expect(view.services.pexels.envShadowed).not.toBe(null);
    expect(view.services.tavily.source).toBe('unset');
    expect(view.services.stadia.source).toBe('unset');
  });

  it('treats whitespace-only env values as unset', () => {
    const view = redactSettings({}, { ANTHROPIC_API_KEY: '   ' });
    expect(view.keys.anthropic.source).toBe('unset');
  });

  it('passes slot values through unchanged', () => {
    const view = redactSettings(
      { slots: { default: { provider: 'openai', model: 'gpt-4o' } } },
      {}
    );
    expect(view.slots.default).toEqual({ provider: 'openai', model: 'gpt-4o' });
  });

  it('returns null slots when not set', () => {
    const view = redactSettings({}, {});
    expect(view.slots.default).toBe(null);
    expect(view.slots.research).toBe(null);
  });

  it('never exposes the raw key value', () => {
    const rawKey = 'sk-ant-api03-SUPERSECRETVALUE';
    const view = redactSettings({ keys: { anthropic: rawKey } }, {});
    expect(JSON.stringify(view)).not.toContain(rawKey);
  });

  it('never exposes a raw env-only key value', () => {
    const rawKey = 'sk-ant-api03-ENVSECRETVALUE';
    const view = redactSettings({}, { ANTHROPIC_API_KEY: rawKey });
    expect(JSON.stringify(view)).not.toContain(rawKey);
  });
});

// ── SUPPORTED_PROVIDERS ───────────────────────────────────────────────────────

describe('SUPPORTED_PROVIDERS', () => {
  it('includes the three major providers', () => {
    expect(SUPPORTED_PROVIDERS).toContain('anthropic');
    expect(SUPPORTED_PROVIDERS).toContain('openai');
    expect(SUPPORTED_PROVIDERS).toContain('openrouter');
  });
});

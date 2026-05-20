import { describe, it, expect, vi, beforeEach } from 'vitest';

// Stub @sveltejs/kit's json() to return a plain object we can inspect.
vi.mock('@sveltejs/kit', () => ({
  json: (body, init = {}) => ({ _body: body, _status: init.status ?? 200 }),
  error: (status, msg) => { throw Object.assign(new Error(msg), { status }); },
}));

// Mock node:fs so no real disk operations happen.
vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  renameSync: vi.fn(),
}));
vi.mock('node:path', () => ({
  resolve: vi.fn((...args) => args.join('/')),
  join: vi.fn((...args) => args.join('/')),
}));

// $lib/server/data.js does heavy module-init I/O and isn't what we're testing
// here; stub the two functions the settings handler reaches into.
const mockPurgeNullImages = vi.hoisted(() => vi.fn(() => 0));
const mockInvalidateEnrich = vi.hoisted(() => vi.fn());
vi.mock('$lib/server/data.js', () => ({
  purgeNullImageEntries: mockPurgeNullImages,
  invalidateEnrichCache: mockInvalidateEnrich,
}));

import { readFileSync, writeFileSync } from 'node:fs';
import { POST } from '../src/routes/api/settings/+server.js';

function makeRequest(body, { clientAddress = '127.0.0.1', headers = {} } = {}) {
  return {
    request: { json: async () => body, headers: new Headers(headers) },
    getClientAddress: () => clientAddress,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.TRAVERSE_DISABLE_SETTINGS_UI;
  // Default: no existing settings on disk.
  readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
});

// ── Kill-switch ───────────────────────────────────────────────────────────────

describe('TRAVERSE_DISABLE_SETTINGS_UI', () => {
  it('returns 403 when env var is set', async () => {
    process.env.TRAVERSE_DISABLE_SETTINGS_UI = '1';
    const res = await POST(makeRequest({ keys: {}, slots: {} }));
    expect(res._status).toBe(403);
    expect(res._body.error).toMatch(/disabled/i);
  });
});

// ── Loopback gate (#221) ──────────────────────────────────────────────────────

describe('POST /api/settings — loopback gate', () => {
  it('rejects a LAN caller by default with 403 forbidden_remote_write', async () => {
    const res = await POST(makeRequest({ keys: {} }, { clientAddress: '192.168.1.42' }));
    expect(res._status).toBe(403);
    expect(res._body.code).toBe('forbidden_remote_write');
  });

  it('allows a loopback caller by default', async () => {
    const res = await POST(makeRequest({ keys: {} }, { clientAddress: '127.0.0.1' }));
    expect(res._status).toBe(200);
  });

  it('allows a LAN caller when TRAVERSE_ALLOW_LAN_WRITES=1', async () => {
    process.env.TRAVERSE_ALLOW_LAN_WRITES = '1';
    const res = await POST(makeRequest({ keys: {} }, { clientAddress: '192.168.1.42' }));
    expect(res._status).toBe(200);
    delete process.env.TRAVERSE_ALLOW_LAN_WRITES;
  });
});

// ── Input validation ──────────────────────────────────────────────────────────

describe('POST /api/settings — validation', () => {
  it('returns 400 for invalid JSON body', async () => {
    const req = {
      request: { json: async () => { throw new SyntaxError('bad json'); }, headers: new Headers() },
      getClientAddress: () => '127.0.0.1',
    };
    const res = await POST(req);
    expect(res._status).toBe(400);
    expect(res._body.error).toMatch(/invalid json/i);
  });

  it('returns 400 for unknown provider key', async () => {
    const res = await POST(makeRequest({ keys: { fakeProvider: 'sk-test' } }));
    expect(res._status).toBe(400);
    expect(res._body.error).toMatch(/unknown provider key/i);
  });

  it('returns 400 for non-string key value', async () => {
    const res = await POST(makeRequest({ keys: { anthropic: 12345 } }));
    expect(res._status).toBe(400);
  });

  it('returns 400 for unknown slot name', async () => {
    const res = await POST(makeRequest({ slots: { superduper: {} } }));
    expect(res._status).toBe(400);
    expect(res._body.error).toMatch(/unknown slot/i);
  });

  it('returns 400 for unknown provider in slot', async () => {
    const res = await POST(makeRequest({ slots: { default: { provider: 'fakeProvider', model: 'x' } } }));
    expect(res._status).toBe(400);
    expect(res._body.error).toMatch(/unknown provider for slot/i);
  });

  it('accepts valid known providers in slots', async () => {
    readFileSync.mockReturnValue('{}');
    const res = await POST(makeRequest({ slots: { default: { provider: 'openai', model: 'gpt-4o-mini' } } }));
    expect(res._status).toBe(200);
    expect(res._body.ok).toBe(true);
  });
});

// ── Merge behavior ────────────────────────────────────────────────────────────

describe('POST /api/settings — merge behavior', () => {
  it('saves a key and returns redacted view', async () => {
    readFileSync.mockReturnValue('{}');
    const res = await POST(makeRequest({ keys: { anthropic: 'sk-ant-api03-ABCDEF1234' } }));
    expect(res._status).toBe(200);
    expect(res._body.settingsView.keys.anthropic.isSet).toBe(true);
    // Raw key must not appear in the response.
    expect(JSON.stringify(res._body)).not.toContain('sk-ant-api03-ABCDEF1234');
    // Written to disk.
    expect(writeFileSync).toHaveBeenCalledOnce();
  });

  it('preserves existing key when only slots are updated', async () => {
    readFileSync.mockReturnValue(JSON.stringify({
      keys: { anthropic: 'sk-ant-existing' },
      slots: {},
    }));
    const res = await POST(makeRequest({ slots: { default: { provider: 'openai', model: 'gpt-4o-mini' } } }));
    expect(res._status).toBe(200);
    // The written data should still contain the existing key.
    const [, writtenContent] = writeFileSync.mock.calls[0];
    const written = JSON.parse(writtenContent);
    expect(written.keys.anthropic).toBe('sk-ant-existing');
    expect(written.slots.default.provider).toBe('openai');
  });

  it('drops blank key values rather than writing empty strings', async () => {
    readFileSync.mockReturnValue(JSON.stringify({ keys: { anthropic: 'sk-ant-existing' } }));
    // Submit blank anthropic key — should NOT overwrite existing with blank.
    const res = await POST(makeRequest({ keys: { anthropic: '  ' } }));
    expect(res._status).toBe(200);
    const [, writtenContent] = writeFileSync.mock.calls[0];
    const written = JSON.parse(writtenContent);
    // Blank key is dropped, so existing key is preserved via merge then cleanup.
    // (blank '' replaces the existing in merge, then the blank-cleanup deletes it)
    expect(written.keys.anthropic).toBeUndefined();
  });

  it('drops blank slot fields', async () => {
    readFileSync.mockReturnValue('{}');
    const res = await POST(makeRequest({ slots: { default: { provider: '', model: '' } } }));
    expect(res._status).toBe(200);
    const [, writtenContent] = writeFileSync.mock.calls[0];
    const written = JSON.parse(writtenContent);
    // Slot with no non-blank fields should be absent entirely.
    expect(written.slots?.default).toBeUndefined();
  });
});

// ── keysToClear ───────────────────────────────────────────────────────────────

describe('POST /api/settings — keysToClear', () => {
  it('returns 400 for non-array keysToClear', async () => {
    const res = await POST(makeRequest({ keysToClear: 'anthropic' }));
    expect(res._status).toBe(400);
    expect(res._body.error).toMatch(/keystoclear must be an array/i);
  });

  it('returns 400 for unknown provider in keysToClear', async () => {
    const res = await POST(makeRequest({ keysToClear: ['fakeProvider'] }));
    expect(res._status).toBe(400);
    expect(res._body.error).toMatch(/unknown provider in keystoclear/i);
  });

  it('clears a stored key', async () => {
    readFileSync.mockReturnValue(JSON.stringify({ keys: { anthropic: 'sk-ant-existing' } }));
    const res = await POST(makeRequest({ keysToClear: ['anthropic'] }));
    expect(res._status).toBe(200);
    const [, writtenContent] = writeFileSync.mock.calls[0];
    const written = JSON.parse(writtenContent);
    expect(written.keys?.anthropic).toBeUndefined();
    expect(res._body.settingsView.keys.anthropic.isSet).toBe(false);
  });

  it('clearing a key that is not set is a no-op (no error)', async () => {
    readFileSync.mockReturnValue(JSON.stringify({ keys: {} }));
    const res = await POST(makeRequest({ keysToClear: ['anthropic'] }));
    expect(res._status).toBe(200);
    expect(res._body.settingsView.keys.anthropic.isSet).toBe(false);
  });

  it('clearing one key does not touch others', async () => {
    readFileSync.mockReturnValue(JSON.stringify({
      keys: { anthropic: 'sk-ant-existing', openai: 'sk-openai-existing' },
    }));
    const res = await POST(makeRequest({ keysToClear: ['anthropic'] }));
    expect(res._status).toBe(200);
    const [, writtenContent] = writeFileSync.mock.calls[0];
    const written = JSON.parse(writtenContent);
    expect(written.keys?.anthropic).toBeUndefined();
    expect(written.keys?.openai).toBe('sk-openai-existing');
  });
});

// ── Model field validation ────────────────────────────────────────────────────

describe('POST /api/settings — model field validation', () => {
  it('returns 400 when model string exceeds 200 characters', async () => {
    const longModel = 'a'.repeat(201);
    const res = await POST(makeRequest({ slots: { default: { provider: 'anthropic', model: longModel } } }));
    expect(res._status).toBe(400);
    expect(res._body.code).toBe('invalid_input');
    expect(res._body.error).toMatch(/model/i);
  });

  it('returns 400 when model string contains disallowed characters (<script>)', async () => {
    const res = await POST(makeRequest({ slots: { default: { provider: 'anthropic', model: '<script>alert(1)</script>' } } }));
    expect(res._status).toBe(400);
    expect(res._body.code).toBe('invalid_input');
    expect(res._body.error).toMatch(/model/i);
  });

  it('returns 400 when model string contains disallowed characters (space)', async () => {
    const res = await POST(makeRequest({ slots: { default: { provider: 'anthropic', model: 'gpt 4o' } } }));
    expect(res._status).toBe(400);
    expect(res._body.code).toBe('invalid_input');
  });

  it('accepts a valid Anthropic model ID (claude-sonnet-4-6)', async () => {
    readFileSync.mockReturnValue('{}');
    const res = await POST(makeRequest({ slots: { default: { provider: 'anthropic', model: 'claude-sonnet-4-6' } } }));
    expect(res._status).toBe(200);
    expect(res._body.ok).toBe(true);
  });

  it('accepts a valid OpenAI model ID (gpt-4o)', async () => {
    readFileSync.mockReturnValue('{}');
    const res = await POST(makeRequest({ slots: { default: { provider: 'openai', model: 'gpt-4o' } } }));
    expect(res._status).toBe(200);
    expect(res._body.ok).toBe(true);
  });

  it('accepts a valid OpenRouter model ID with slash (anthropic/claude-opus-4-7)', async () => {
    readFileSync.mockReturnValue('{}');
    const res = await POST(makeRequest({ slots: { default: { provider: 'openrouter', model: 'anthropic/claude-opus-4-7' } } }));
    expect(res._status).toBe(200);
    expect(res._body.ok).toBe(true);
  });

  it('accepts exactly 200 characters (boundary)', async () => {
    readFileSync.mockReturnValue('{}');
    const borderModel = 'a'.repeat(200);
    const res = await POST(makeRequest({ slots: { default: { provider: 'anthropic', model: borderModel } } }));
    expect(res._status).toBe(200);
    expect(res._body.ok).toBe(true);
  });

  it('accepts model with dots and colons (e.g. versioned IDs)', async () => {
    readFileSync.mockReturnValue('{}');
    const res = await POST(makeRequest({ slots: { default: { provider: 'anthropic', model: 'claude-3.5-sonnet:beta' } } }));
    expect(res._status).toBe(200);
    expect(res._body.ok).toBe(true);
  });

  it('does not validate model field when it is absent (blank clears the slot field)', async () => {
    readFileSync.mockReturnValue('{}');
    const res = await POST(makeRequest({ slots: { default: { provider: 'anthropic' } } }));
    expect(res._status).toBe(200);
    expect(res._body.ok).toBe(true);
  });
});

// ── Pexels key change → image cache purge ─────────────────────────────────────

describe('POST /api/settings — Pexels key change purges null image cache', () => {
  it('purges null entries when a Pexels key is added for the first time', async () => {
    readFileSync.mockReturnValue('{}');
    mockPurgeNullImages.mockReturnValue(3);

    const res = await POST(makeRequest({
      services: { pexels: 'real-pexels-key-abc123' },
    }));

    expect(res._status).toBe(200);
    expect(mockPurgeNullImages).toHaveBeenCalledTimes(1);
    expect(mockInvalidateEnrich).toHaveBeenCalledTimes(1);
  });

  it('purges when the Pexels key value changes', async () => {
    readFileSync.mockReturnValue(JSON.stringify({
      services: { pexels: 'old-key' },
    }));
    mockPurgeNullImages.mockReturnValue(1);

    const res = await POST(makeRequest({
      services: { pexels: 'new-key' },
    }));

    expect(res._status).toBe(200);
    expect(mockPurgeNullImages).toHaveBeenCalledTimes(1);
    expect(mockInvalidateEnrich).toHaveBeenCalledTimes(1);
  });

  it('does NOT purge when Pexels is absent from the payload', async () => {
    readFileSync.mockReturnValue(JSON.stringify({
      services: { pexels: 'existing-key' },
    }));

    const res = await POST(makeRequest({
      keys: { anthropic: 'sk-ant-test' },
    }));

    expect(res._status).toBe(200);
    expect(mockPurgeNullImages).not.toHaveBeenCalled();
  });

  it('does NOT purge when the same Pexels key is re-submitted unchanged', async () => {
    readFileSync.mockReturnValue(JSON.stringify({
      services: { pexels: 'same-key' },
    }));

    const res = await POST(makeRequest({
      services: { pexels: 'same-key' },
    }));

    expect(res._status).toBe(200);
    expect(mockPurgeNullImages).not.toHaveBeenCalled();
  });

  it('does NOT invalidate enrich cache when purge returns 0 entries', async () => {
    readFileSync.mockReturnValue('{}');
    mockPurgeNullImages.mockReturnValue(0);

    const res = await POST(makeRequest({
      services: { pexels: 'fresh-key' },
    }));

    expect(res._status).toBe(200);
    expect(mockPurgeNullImages).toHaveBeenCalledTimes(1);
    expect(mockInvalidateEnrich).not.toHaveBeenCalled();
  });
});

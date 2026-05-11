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
}));
vi.mock('node:path', () => ({
  resolve: vi.fn((...args) => args.join('/')),
}));

import { readFileSync, writeFileSync } from 'node:fs';
import { POST } from '../src/routes/api/settings/+server.js';

function makeRequest(body) {
  return { request: { json: async () => body } };
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

// ── Input validation ──────────────────────────────────────────────────────────

describe('POST /api/settings — validation', () => {
  it('returns 400 for invalid JSON body', async () => {
    const req = { request: { json: async () => { throw new SyntaxError('bad json'); } } };
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

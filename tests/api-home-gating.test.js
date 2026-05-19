import { describe, it, expect, vi, beforeEach } from 'vitest';

// Test the 412 home_not_configured gate on AI action routes.

// Stub @sveltejs/kit's json() to return a plain object we can inspect.
vi.mock('@sveltejs/kit', () => ({
  json: (body, init = {}) => ({ _body: body, _status: init.status ?? 200 }),
  error: (status, msg) => { throw Object.assign(new Error(msg), { status }); },
}));

// ── fs mock ──
// Controlled per-test via mockExistsSync so we can simulate home.md present/absent.
const { mockExistsSync, mockReadFileSync } = vi.hoisted(() => ({
  mockExistsSync: vi.fn(),
  mockReadFileSync: vi.fn(),
}));

vi.mock('node:fs', () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  unlinkSync: vi.fn(),
  readdirSync: vi.fn(() => []),
  statSync: vi.fn(),
  renameSync: vi.fn(),
}));

// Also mock plain 'fs' (some routes use 'fs' instead of 'node:fs')
vi.mock('fs', () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  unlinkSync: vi.fn(),
  readdirSync: vi.fn(() => []),
  statSync: vi.fn(),
  renameSync: vi.fn(),
}));

// Stub path modules
vi.mock('node:path', async () => {
  const actual = await vi.importActual('node:path');
  return actual;
});

// ── SSE mock (seed + add use sseStream) ──
// The mock doesn't run the handler — it just records that sseStream was called.
// This lets the "guard passes" tests verify sseStream was invoked without
// running the full AI pipeline (which needs real chat() output).
vi.mock('$lib/server/sse.js', () => ({
  sseStream: vi.fn(async () => new Response('ok')),
  withHeartbeat: vi.fn(async (fn) => {
    const result = await fn();
    return result ?? { text: '', usage: {} };
  }),
}));

// ── Config mock — controls homeMdReady ──
const { mockGetFeatureAvailability } = vi.hoisted(() => ({
  mockGetFeatureAvailability: vi.fn(),
}));

vi.mock('$lib/server/config.js', () => ({
  getFeatureAvailability: mockGetFeatureAvailability,
  getEffectiveConfig: () => ({
    assistantName: 'Field guide',
    features: {
      seed: { provider: 'anthropic', model: 'claude-test' },
      add:  { provider: 'anthropic', model: 'claude-test' },
    },
  }),
}));

// ── data.js mock ──
vi.mock('$lib/server/data.js', () => ({
  ROOT: '/test-root',
  readHomeMd: () => '---\nhome_city: Test City\nhome_coords: [39.0, -94.0]\n---\n',
  parseFrontmatter: vi.fn(() => ({})),
  parseFrontmatterFields: vi.fn(() => ({})),
  invalidateEnrichCache: vi.fn(),
  rejectInvalidSlug: () => null,
  assertSafeIdeaPath: (p) => p,
}));

// ── Other mocks needed by the routes ──
vi.mock('$lib/server/destinations.js', () => ({
  collectExistingDestinations: vi.fn(() => []),
}));

vi.mock('$lib/server/ai.js', () => ({
  chat: vi.fn(async () => ({ text: '', usage: { input_tokens: 1, output_tokens: 1 } })),
  formatUsage: vi.fn(() => '[1 token]'),
}));

vi.mock('$lib/server/promises.js', () => ({
  HAND_DEFAULTS: {
    seed: { time_seconds: 20, tokens_range: [1000, 3000] },
    add:  { time_seconds: 12, tokens_range: [400, 800] },
  },
}));

vi.mock('$lib/utils/formatTokens.js', () => ({
  usageToTokens: vi.fn(() => 1),
}));

// ── Load route handlers ──
import { POST as seedPOST } from '../src/routes/api/actions/seed/+server.js';
import { POST as addPOST }  from '../src/routes/api/actions/add/+server.js';

function makeRequest(body = {}) {
  return { request: { json: async () => body } };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: home.md is absent → homeMdReady: false
  mockGetFeatureAvailability.mockReturnValue({ homeMdReady: false });
  mockExistsSync.mockReturnValue(false);
  mockReadFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
});

// ── seed ──────────────────────────────────────────────────────────────────────

describe('POST /api/actions/seed — home gating', () => {
  it('returns 412 with home_not_configured code when homeMdReady is false', async () => {
    const res = await seedPOST(makeRequest());
    expect(res._status).toBe(412);
    expect(res._body.code).toBe('home_not_configured');
  });

  it('proceeds past the guard (calls sseStream) when homeMdReady is true', async () => {
    const { sseStream } = await import('$lib/server/sse.js');
    mockGetFeatureAvailability.mockReturnValue({ homeMdReady: true });
    await seedPOST(makeRequest());
    expect(sseStream).toHaveBeenCalled();
  });
});

// ── add ───────────────────────────────────────────────────────────────────────

describe('POST /api/actions/add — home gating', () => {
  it('returns 412 with home_not_configured code when homeMdReady is false', async () => {
    const res = await addPOST(makeRequest({ destination: 'Somewhere' }));
    expect(res._status).toBe(412);
    expect(res._body.code).toBe('home_not_configured');
  });

  it('proceeds past the guard (calls sseStream) when homeMdReady is true', async () => {
    const { sseStream } = await import('$lib/server/sse.js');
    mockGetFeatureAvailability.mockReturnValue({ homeMdReady: true });
    await addPOST(makeRequest({ destination: 'Somewhere' }));
    expect(sseStream).toHaveBeenCalled();
  });
});

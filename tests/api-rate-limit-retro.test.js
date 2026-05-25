/**
 * Tests that verify the 429 rate-limit path for the retro endpoint:
 *   - PUT /api/actions/retro/[slug]   (retro bucket)
 *
 * Strategy: mock rateLimitResponse to return a real 429 Response so we can
 * verify the handler honours it without also having to satisfy every other
 * mock (fs, chat, …). A second set of tests confirms that when
 * rateLimitResponse returns null the handler proceeds normally — proving
 * the call-site wiring is correct, not just that the mock fires.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── @sveltejs/kit stub ────────────────────────────────────────────────────────

vi.mock('@sveltejs/kit', () => ({
  json: (body, init = {}) => {
    const status = init?.status ?? 200;
    return {
      status,
      headers: new Map(Object.entries(init?.headers ?? {})),
      async json() { return body; },
    };
  },
}));

// ── rate-limit mock ───────────────────────────────────────────────────────────

const { mockRateLimitResponse } = vi.hoisted(() => ({
  mockRateLimitResponse: vi.fn(),
}));

vi.mock('$lib/server/rate-limit.js', () => ({
  rateLimitResponse: mockRateLimitResponse,
}));

// ── fs mock ───────────────────────────────────────────────────────────────────

const { mockExistsSync, mockWriteFileSync } = vi.hoisted(() => ({
  mockExistsSync: vi.fn(),
  mockWriteFileSync: vi.fn(),
}));

vi.mock('node:fs', () => ({
  existsSync: mockExistsSync,
  writeFileSync: mockWriteFileSync,
  mkdirSync: vi.fn(),
}));

vi.mock('fs', () => ({
  existsSync: mockExistsSync,
  writeFileSync: mockWriteFileSync,
  mkdirSync: vi.fn(),
}));

// ── data mock ─────────────────────────────────────────────────────────────────

const { mockGetTripFiles, mockAtomicWrite, mockInvalidateEnrichCache } = vi.hoisted(() => ({
  mockGetTripFiles: vi.fn(),
  mockAtomicWrite: vi.fn(),
  mockInvalidateEnrichCache: vi.fn(),
}));

vi.mock('$lib/server/data.js', () => ({
  ROOT: '/test-root',
  DATA_DIR: '/test-root/data',
  rejectInvalidSlug: () => null,
  readHomeMd: () => '---\ntravelers: [test]\n---\n',
  getTripFiles: mockGetTripFiles,
  atomicWrite: mockAtomicWrite,
  invalidateEnrichCache: mockInvalidateEnrichCache,
}));

// ── ai + config mocks ─────────────────────────────────────────────────────────

const mockChat = vi.hoisted(() => vi.fn());

vi.mock('$lib/server/ai.js', () => ({
  chat: mockChat,
}));

vi.mock('$lib/server/config.js', () => ({
  getEffectiveConfig: () => ({
    features: { retro: { provider: 'anthropic', model: 'claude-test' } },
  }),
  getFeatureAvailability: () => ({ homeMdReady: true }),
}));

vi.mock('$lib/utils/formatTokens.js', () => ({
  usageToTokens: () => 100,
}));

vi.mock('$lib/server/promises.js', () => ({
  HAND_DEFAULTS: { 'retro-questions': {}, regeocode: {} },
  MAX_TOKENS: { 'retro-questions': 600, 'retro-save': 2000 },
}));

vi.mock('$lib/server/errors.js', () => ({
  TraverseError: class TraverseError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  },
}));

// ── helpers ───────────────────────────────────────────────────────────────────

/** Build a fake 429 Response (mirrors what rateLimitResponse() returns). */
function make429() {
  return {
    status: 429,
    headers: new Map([['Retry-After', '60']]),
    async json() {
      return { code: 'rate_limited', error: 'Too many requests', retryAfterSec: 60 };
    },
  };
}

function makeEvent(ip = '127.0.0.1') {
  return { getClientAddress: () => ip };
}

function makeRetroEvent(ip = '127.0.0.1', body = {}) {
  return {
    ...makeEvent(ip),
    params: { slug: 'test-trip' },
    request: { json: async () => body },
  };
}

// A completed trip file set that satisfies loadCompletedTrip().
function mockCompletedTrip() {
  mockExistsSync.mockImplementation((p) => {
    // dir exists, notes.md does not
    if (p.includes('notes.md')) return false;
    return true;
  });
  mockGetTripFiles.mockReturnValue({
    stage: 'completed',
    files: { overview: 'Great trip overview.' },
  });
}

// ── imports (after all mocks) ─────────────────────────────────────────────────

import { PUT } from '../src/routes/api/actions/retro/[slug]/+server.js';

// ── beforeEach ────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockRateLimitResponse.mockReturnValue(null); // default: not limited
  mockExistsSync.mockReturnValue(false);
  mockGetTripFiles.mockReturnValue(null);
});

// ═══════════════════════════════════════════════════════════════════════════════
// PUT /api/actions/retro/[slug]
// ═══════════════════════════════════════════════════════════════════════════════

describe('PUT /api/actions/retro/[slug] — rate limiting', () => {
  it('returns 429 when the retro bucket is exhausted', async () => {
    mockRateLimitResponse.mockReturnValue(make429());

    const res = await PUT(makeRetroEvent());

    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.code).toBe('rate_limited');
  });

  it('passes the event and retro endpoint + slugKey to rateLimitResponse', async () => {
    mockRateLimitResponse.mockReturnValue(make429());

    await PUT(makeRetroEvent('10.0.0.1'));

    expect(mockRateLimitResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: 'retro',
        slugKey: 'test-trip',
        event: expect.objectContaining({ getClientAddress: expect.any(Function) }),
      })
    );
  });

  it('does not call chat() when rate-limited', async () => {
    mockRateLimitResponse.mockReturnValue(make429());

    await PUT(makeRetroEvent());

    expect(mockChat).not.toHaveBeenCalled();
  });

  it('proceeds past the rate-limit check when not limited (calls chat)', async () => {
    mockRateLimitResponse.mockReturnValue(null); // not limited
    mockCompletedTrip();

    mockChat.mockResolvedValue({
      text: 'A nice trip summary.\n\n## What worked\nEverything.\n',
      usage: { input_tokens: 100, output_tokens: 200 },
    });

    const body = {
      questions: ['How was it?'],
      answers: ['Great!'],
      rating: 5,
      would_repeat: true,
    };

    const res = await PUT(makeRetroEvent('127.0.0.1', body));

    expect(mockChat).toHaveBeenCalled();
    expect(res.status).toBe(200);
  });
});


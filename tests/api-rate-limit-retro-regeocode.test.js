/**
 * Tests that verify the 429 rate-limit path for the two endpoints added in #267:
 *   - PUT /api/actions/retro/[slug]   (retro bucket)
 *   - POST /api/brochure/regeocode/[slug]  (geocode bucket)
 *
 * Strategy: mock rateLimitResponse to return a real 429 Response so we can
 * verify the handlers honour it without also having to satisfy every other
 * mock (fs, chat, brochure, …).  A second set of tests confirms that when
 * rateLimitResponse returns null the handlers proceed normally — proving
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

// ── brochure + sse mocks ──────────────────────────────────────────────────────

const { mockRegeocodeBrochureStops } = vi.hoisted(() => ({
  mockRegeocodeBrochureStops: vi.fn(),
}));

vi.mock('$lib/server/brochure.js', () => ({
  regeocodeBrochureStops: mockRegeocodeBrochureStops,
}));

// sseStream: call the callback synchronously so we can await the handler.
vi.mock('$lib/server/sse.js', () => ({
  sseStream: async (fn) => {
    const msgs = [];
    await fn((msg, done) => msgs.push({ msg, done: !!done }));
    return { status: 200, _msgs: msgs };
  },
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

function makeRegeoEvent(ip = '127.0.0.1') {
  return {
    ...makeEvent(ip),
    params: { slug: 'test-trip' },
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
import { POST } from '../src/routes/api/brochure/regeocode/[slug]/+server.js';

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

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/brochure/regeocode/[slug]
// ═══════════════════════════════════════════════════════════════════════════════

describe('POST /api/brochure/regeocode/[slug] — rate limiting', () => {
  it('returns 429 when the geocode bucket is exhausted', async () => {
    mockRateLimitResponse.mockReturnValue(make429());

    const res = await POST(makeRegeoEvent());

    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.code).toBe('rate_limited');
  });

  it('passes the event and geocode endpoint + slugKey to rateLimitResponse', async () => {
    mockRateLimitResponse.mockReturnValue(make429());

    await POST(makeRegeoEvent('10.0.0.2'));

    expect(mockRateLimitResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: 'geocode',
        slugKey: 'test-trip',
        event: expect.objectContaining({ getClientAddress: expect.any(Function) }),
      })
    );
  });

  it('does not call regeocodeBrochureStops when rate-limited', async () => {
    mockRateLimitResponse.mockReturnValue(make429());

    await POST(makeRegeoEvent());

    expect(mockRegeocodeBrochureStops).not.toHaveBeenCalled();
  });

  it('proceeds past the rate-limit check when not limited (calls regeocode)', async () => {
    mockRateLimitResponse.mockReturnValue(null); // not limited

    mockRegeocodeBrochureStops.mockResolvedValue({
      stopsAdded: 2,
      lodgingAdded: 0,
      stopsLocated: 3,
      stopsTotal: 4,
    });

    const res = await POST(makeRegeoEvent());

    expect(mockRegeocodeBrochureStops).toHaveBeenCalledWith('test-trip', expect.any(Object));
    expect(res.status).toBe(200);
  });
});

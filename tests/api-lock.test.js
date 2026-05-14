import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- fs mock ---
const mockWriteFileSync = vi.hoisted(() => vi.fn());

vi.mock('node:fs', () => ({
  writeFileSync: mockWriteFileSync,
}));

// --- data mock ---
const { mockReadPlanningTrip, mockSetLocked } = vi.hoisted(() => ({
  mockReadPlanningTrip: vi.fn(),
  mockSetLocked: vi.fn(),
}));

vi.mock('$lib/server/data.js', () => ({
  PLANNING_SECTIONS: ['overview', 'route', 'stops', 'logistics'],
  readPlanningTrip: mockReadPlanningTrip,
  setLocked: mockSetLocked,
}));

// --- AI / config mocks ---
const mockChat = vi.hoisted(() => vi.fn());

vi.mock('$lib/server/ai.js', () => ({
  chat: mockChat,
  formatUsage: (u) => `[${u.input}+${u.output} tokens]`,
}));

vi.mock('$lib/server/config.js', () => ({
  getEffectiveConfig: () => ({
    features: { lock: { provider: 'anthropic', model: 'claude-test' } },
  }),
}));

vi.mock('@sveltejs/kit', () => ({
  json: (body, init = {}) => ({ _body: body, _status: init.status ?? 200 }),
}));

// Mock sseStream to run the handler synchronously and capture sent messages.
// Returns { _messages } so tests can inspect what the handler sent.
// The send function captures (msg, done, tokens) matching the real sseStream signature.
vi.mock('$lib/server/sse.js', () => ({
  sseStream: async (handler) => {
    const messages = [];
    const send = (msg, done = false, tokens = null) => messages.push({ msg, done, tokens });
    try {
      await handler(send);
    } catch (err) {
      const isAbort = err.name === 'AbortError' || err.code === 'ABORT_ERR';
      if (!isAbort) send(`Error: ${err.message}`, true);
    }
    return { _messages: messages };
  },
}));

import { POST } from '../src/routes/api/lock/[slug]/+server.js';

const TRIP_STUB = {
  dir: '/test-root/planning/test-trip',
  sections: {
    overview: 'We drive north on Day 1.',
    route: 'Take I-70 west.',
    stops: null,
    logistics: null,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockReadPlanningTrip.mockReturnValue(TRIP_STUB);
  mockSetLocked.mockReturnValue(true);
  mockChat.mockResolvedValue({ text: '## Day 1 — Monday\n- 9:00 AM — Depart', usage: { input: 50, output: 20 } });
});

function makeRequest(slug = 'test-trip') {
  return { params: { slug }, request: { signal: undefined } };
}

// ── 404 ────────────────────────────────────────────────────────────────────────

describe('POST /api/lock/[slug]', () => {
  it('returns 404 when trip is not in planning stage', async () => {
    mockReadPlanningTrip.mockReturnValue(null);
    const res = await POST(makeRequest('missing-trip'));
    expect(res.status).toBe(404);
  });
});

// ── empty model output ─────────────────────────────────────────────────────────

describe('POST /api/lock/[slug] — empty model output', () => {
  it('sends error when chat() returns empty text', async () => {
    mockChat.mockResolvedValueOnce({ text: '', usage: null });
    const res = await POST(makeRequest());
    const errorMsg = res._messages.find(m => m.done && m.msg.startsWith('Error:'));
    expect(errorMsg).toBeDefined();
    expect(errorMsg.msg).toContain("The model didn't return itinerary content");
  });

  it('sends error when chat() returns only whitespace', async () => {
    mockChat.mockResolvedValueOnce({ text: '   \n  ', usage: null });
    const res = await POST(makeRequest());
    const errorMsg = res._messages.find(m => m.done && m.msg.startsWith('Error:'));
    expect(errorMsg).toBeDefined();
    expect(errorMsg.msg).toContain("The model didn't return itinerary content");
  });

  // Verify the guard is load-bearing: a non-empty result should NOT produce the error.
  it('does not send the empty-output error when chat() returns real text', async () => {
    const res = await POST(makeRequest());
    const errorMsg = res._messages.find(m => m.msg.includes("The model didn't return itinerary content"));
    expect(errorMsg).toBeUndefined();
  });
});

// ── cancel (AbortError from request.signal) ────────────────────────────────────

describe('POST /api/lock/[slug] — cancel', () => {
  it('does not send an Error message when the request is aborted', async () => {
    // Simulate an abort by rejecting chat() with an AbortError
    const abortErr = Object.assign(new Error('This operation was aborted'), { name: 'AbortError' });
    mockChat.mockRejectedValueOnce(abortErr);
    const res = await POST(makeRequest());
    const errMsg = res._messages.find(m => m.done && m.msg.startsWith('Error:'));
    expect(errMsg).toBeUndefined();
  });

  it('does not write itinerary.md when the request is aborted', async () => {
    const abortErr = Object.assign(new Error('This operation was aborted'), { name: 'AbortError' });
    mockChat.mockRejectedValueOnce(abortErr);
    await POST(makeRequest());
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it('does not call setLocked when the request is aborted', async () => {
    const abortErr = Object.assign(new Error('This operation was aborted'), { name: 'AbortError' });
    mockChat.mockRejectedValueOnce(abortErr);
    await POST(makeRequest());
    expect(mockSetLocked).not.toHaveBeenCalled();
  });
});

// ── typed-error failure envelope ───────────────────────────────────────────────

describe('POST /api/lock/[slug] — typed error codes', () => {
  it('sends an Error message containing the TraverseError code when chat() throws a known error', async () => {
    // The lock route wraps chat() errors — but empty_model_output is thrown
    // after chat(), so we test via the whitespace guard path.
    // For this test, simulate a TraverseError being thrown directly.
    const { TraverseError } = await import('../src/lib/server/errors.js');
    mockChat.mockRejectedValueOnce(new TraverseError('provider_error', 'Provider blew up'));
    const res = await POST(makeRequest());
    const errMsg = res._messages.find(m => m.done && m.msg.startsWith('Error:'));
    expect(errMsg).toBeDefined();
    // The error message should be surfaced to the client (not silently swallowed)
    expect(errMsg.msg).toContain('Provider blew up');
  });

  it('does not write itinerary.md when chat() throws a non-abort error', async () => {
    mockChat.mockRejectedValueOnce(new Error('Network blip'));
    await POST(makeRequest());
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it('does not call setLocked when chat() throws a non-abort error', async () => {
    mockChat.mockRejectedValueOnce(new Error('Network blip'));
    await POST(makeRequest());
    expect(mockSetLocked).not.toHaveBeenCalled();
  });
});

// ── success path ───────────────────────────────────────────────────────────────

describe('POST /api/lock/[slug] — success', () => {
  it('writes itinerary.md with the model output', async () => {
    mockChat.mockResolvedValueOnce({
      text: '## Day 1 — Monday\n- 9:00 AM — Depart\n## Day 2 — Tuesday\n- Drive home',
      usage: { input: 100, output: 40 },
    });
    await POST(makeRequest());
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      expect.stringContaining('itinerary.md'),
      '## Day 1 — Monday\n- 9:00 AM — Depart\n## Day 2 — Tuesday\n- Drive home\n'
    );
  });

  it('calls setLocked(slug, true) after writing the itinerary', async () => {
    await POST(makeRequest('my-trip'));
    expect(mockSetLocked).toHaveBeenCalledWith('my-trip', true);
  });

  it('sends the final Done message', async () => {
    const res = await POST(makeRequest());
    const done = res._messages.find(m => m.done);
    expect(done?.msg).toBe('Done — itinerary is set.');
  });

  it('passes sections from the trip to chat() in the prompt', async () => {
    await POST(makeRequest());
    const call = mockChat.mock.calls[0][0];
    const userMsg = call.messages[0].content;
    expect(userMsg).toContain('We drive north on Day 1.');
    expect(userMsg).toContain('Take I-70 west.');
  });

  it('trims trailing whitespace from itinerary before writing', async () => {
    mockChat.mockResolvedValueOnce({ text: '## Day 1\n\n  \n', usage: null });
    await POST(makeRequest());
    const [, written] = mockWriteFileSync.mock.calls[0];
    expect(written).toBe('## Day 1\n');
  });

  it('includes tokens in the done SSE event when usage is present', async () => {
    mockChat.mockResolvedValueOnce({
      text: '## Day 1\n- 9am Depart',
      usage: { input: 100, output: 50 },
    });
    const res = await POST(makeRequest());
    const done = res._messages.find(m => m.done);
    expect(done).toBeDefined();
    expect(done.msg).toBe('Done — itinerary is set.');
    // tokens = input + output = 150 (usageToTokens)
    expect(done.tokens).toBe(150);
  });
});

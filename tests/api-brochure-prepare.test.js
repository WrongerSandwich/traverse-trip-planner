import { describe, it, expect, vi, beforeEach } from 'vitest';

// Ambient Background contract for Brochure prepare (#82).
//
// - POST returns 202 Accepted immediately; the AI work continues in the
//   background.
// - assertNotRunning → returns 409 when a job with the same key is already in
//   flight.
// - startJob is called with workflow='brochure' before the background work
//   begins.
// - On success: completeJob is called with the job's token count and the
//   brochure draft is written to disk via prepareBrochure().
// - On failure: failJob is called with the TraverseError's code (or 'unknown').
// - The AbortController signal from startJob is forwarded to prepareBrochure
//   so the standard /api/jobs/cancel route can cancel mid-run.

// ── Jobs registry mock ─────────────────────────────────────────────────────
const {
  mockAssertNotRunning, mockStartJob, mockCompleteJob, mockFailJob,
} = vi.hoisted(() => ({
  mockAssertNotRunning: vi.fn(),
  mockStartJob: vi.fn(),
  mockCompleteJob: vi.fn(),
  mockFailJob: vi.fn(),
}));

vi.mock('$lib/server/jobs.js', () => ({
  assertNotRunning: mockAssertNotRunning,
  startJob: mockStartJob,
  completeJob: mockCompleteJob,
  failJob: mockFailJob,
}));

// ── Brochure layer mock ────────────────────────────────────────────────────
const mockPrepareBrochure = vi.hoisted(() => vi.fn());

vi.mock('$lib/server/brochure.js', () => ({
  prepareBrochure: mockPrepareBrochure,
}));

// ── Imports under test ─────────────────────────────────────────────────────
const { POST, _promise } = await import('../src/routes/api/brochure/prepare/[slug]/+server.js');
const { TraverseError } = await import('../src/lib/server/errors.js');

function makeRequest(slug) {
  return { params: { slug }, request: { signal: new AbortController().signal } };
}

beforeEach(() => {
  mockAssertNotRunning.mockReset();
  mockStartJob.mockReset();
  mockCompleteJob.mockReset();
  mockFailJob.mockReset();
  mockPrepareBrochure.mockReset();
  // Provide a default job handle so the route can read .controller.signal.
  mockStartJob.mockImplementation(() => ({
    workflow: 'brochure',
    slug: 'test-trip',
    startedAt: Date.now(),
    controller: new AbortController(),
    opts: {},
  }));
  mockPrepareBrochure.mockResolvedValue({
    data: { title: 'Test brochure' },
    usage: { input_tokens: 100, output_tokens: 200 },
  });
});

describe('POST /api/brochure/prepare/[slug]', () => {
  it('returns 202 Accepted immediately', async () => {
    const res = await POST(makeRequest('test-trip'));
    expect(res.status).toBe(202);
  });

  it('calls assertNotRunning("brochure", slug) before starting', async () => {
    await POST(makeRequest('test-trip'));
    expect(mockAssertNotRunning).toHaveBeenCalledWith('brochure', 'test-trip');
  });

  it('returns 409 when assertNotRunning throws TraverseError("already_running")', async () => {
    mockAssertNotRunning.mockImplementation(() => {
      throw new TraverseError('already_running', 'brochure already running for test-trip');
    });
    const res = await POST(makeRequest('test-trip'));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('already_running');
    expect(mockStartJob).not.toHaveBeenCalled();
    expect(mockPrepareBrochure).not.toHaveBeenCalled();
  });

  it('calls startJob("brochure", slug, {...}) once', async () => {
    await POST(makeRequest('test-trip'));
    expect(mockStartJob).toHaveBeenCalledTimes(1);
    expect(mockStartJob.mock.calls[0][0]).toBe('brochure');
    expect(mockStartJob.mock.calls[0][1]).toBe('test-trip');
  });

  it('forwards the job handle\'s AbortController signal to prepareBrochure', async () => {
    const controller = new AbortController();
    mockStartJob.mockReturnValue({
      workflow: 'brochure',
      slug: 'test-trip',
      startedAt: Date.now(),
      controller,
      opts: {},
    });
    await POST(makeRequest('test-trip'));
    await new Promise((r) => setTimeout(r, 20));

    expect(mockPrepareBrochure).toHaveBeenCalledWith('test-trip', expect.objectContaining({
      signal: controller.signal,
    }));
  });

  it('calls completeJob with the actual token count on success', async () => {
    mockPrepareBrochure.mockResolvedValue({
      data: {},
      usage: { input_tokens: 1500, output_tokens: 750 },
    });
    await POST(makeRequest('test-trip'));
    await new Promise((r) => setTimeout(r, 20));

    expect(mockCompleteJob).toHaveBeenCalledWith('brochure', 'test-trip', { tokens: 2250 });
    expect(mockFailJob).not.toHaveBeenCalled();
  });

  it('handles normalized adapter usage shape {input, output} on completeJob', async () => {
    mockPrepareBrochure.mockResolvedValue({
      data: {},
      usage: { input: 300, output: 200 },
    });
    await POST(makeRequest('test-trip'));
    await new Promise((r) => setTimeout(r, 20));

    expect(mockCompleteJob).toHaveBeenCalledWith('brochure', 'test-trip', { tokens: 500 });
  });

  it('records 0 tokens when no usage is returned', async () => {
    mockPrepareBrochure.mockResolvedValue({ data: {}, usage: undefined });
    await POST(makeRequest('test-trip'));
    await new Promise((r) => setTimeout(r, 20));

    expect(mockCompleteJob).toHaveBeenCalledWith('brochure', 'test-trip', { tokens: 0 });
  });

  it('calls failJob with the TraverseError code when prepareBrochure throws a TraverseError', async () => {
    mockPrepareBrochure.mockRejectedValue(new TraverseError('missing_overview', 'no overview.md'));
    await POST(makeRequest('test-trip'));
    await new Promise((r) => setTimeout(r, 20));

    expect(mockFailJob).toHaveBeenCalledWith('brochure', 'test-trip', expect.objectContaining({
      code: 'missing_overview',
    }));
    expect(mockCompleteJob).not.toHaveBeenCalled();
  });

  it('calls failJob with code "unknown" when a non-TraverseError throws', async () => {
    mockPrepareBrochure.mockRejectedValue(new Error('boom'));
    await POST(makeRequest('test-trip'));
    await new Promise((r) => setTimeout(r, 20));

    expect(mockFailJob).toHaveBeenCalledWith('brochure', 'test-trip', expect.objectContaining({
      code: 'unknown',
    }));
  });

  it('does NOT call failJob when chat() aborts (cancelJob owns the failJob call)', async () => {
    const abortErr = new Error('The operation was aborted');
    abortErr.name = 'AbortError';
    mockPrepareBrochure.mockRejectedValue(abortErr);

    await POST(makeRequest('test-trip'));
    await new Promise((r) => setTimeout(r, 20));

    // cancelJob() in $lib/server/jobs.js fires the controller AND calls failJob
    // itself; the route's catch should be a no-op for AbortError so we don't
    // double-record the failure event.
    expect(mockFailJob).not.toHaveBeenCalled();
    expect(mockCompleteJob).not.toHaveBeenCalled();
  });

  it('still returns 202 even when prepareBrochure rejects (work runs in background)', async () => {
    mockPrepareBrochure.mockRejectedValue(new Error('background failure'));
    const res = await POST(makeRequest('test-trip'));
    expect(res.status).toBe(202);
  });
});

describe('_promise export', () => {
  it('declares the promise contract for the trigger UI', () => {
    expect(_promise.verb).toBe('Prepare brochure');
    expect(_promise.time_seconds).toBeGreaterThan(0);
    expect(Array.isArray(_promise.tokens_range)).toBe(true);
  });
});

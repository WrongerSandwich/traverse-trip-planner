import { describe, it, expect, vi, beforeEach } from 'vitest';

// Ambient Background contract for Deepen-section (#83).
//
// - POST returns 202 Accepted immediately; the AI work continues in the
//   background.
// - assertNotRunning('deepen-section:{section}', slug) → 409 when a job with
//   the same section+slug key is already in flight. Using section as part of
//   the key lets route and stops run concurrently for the same trip.
// - startJob is called with workflow='deepen-section:{section}' before work begins.
// - On success: completeJob is called with token count; section file written to disk.
// - On failure: failJob is called with the TraverseError's code (or 'unknown').
// - The AbortController signal from startJob is forwarded to chat() so the
//   standard /api/jobs/cancel route can abort the model call mid-run.
// - AbortError → swallow (cancelJob owns the failure event; no double-record).

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

// ── fs mock (route reads overview.md and writes the section file) ──────────
const { mockExistsSync, mockReadFileSync, mockWriteFileSync } = vi.hoisted(() => ({
  mockExistsSync: vi.fn(),
  mockReadFileSync: vi.fn(),
  mockWriteFileSync: vi.fn(),
}));

vi.mock('node:fs', () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
}));

// ── Data / AI / search / config mocks ─────────────────────────────────────
vi.mock('$lib/server/data.js', () => ({
  ROOT: '/test-root',
  readHomeMd: () => '---\ntravelers: [you]\n---\n',
  parseFrontmatter: vi.fn(() => ({ title: 'Test Trip', status: 'exploring' })),
  invalidateEnrichCache: vi.fn(),
}));

const mockChat = vi.hoisted(() => vi.fn());

vi.mock('$lib/server/ai.js', () => ({
  chat: mockChat,
  formatUsage: () => '[10 tokens]',
}));

vi.mock('$lib/server/search.js', () => ({
  search: vi.fn(),
  searchToolDefinition: () => ({
    kind: 'normalized',
    name: 'web_search',
    description: 'search the web',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
  }),
}));

vi.mock('$lib/server/config.js', () => ({
  getEffectiveConfig: () => ({
    features: { deepen: { provider: 'anthropic', model: 'claude-test' } },
  }),
}));

// ── Imports under test ─────────────────────────────────────────────────────
import { POST, _promise } from '../src/routes/api/actions/deepen-section/[slug]/[section]/+server.js';
import { TraverseError } from '../src/lib/server/errors.js';

const OVERVIEW = '---\ntitle: Test Trip\nstatus: exploring\ndestination: Testville\n---\nGreat trip.';

function makeRequest(slug, section) {
  return { params: { slug, section }, request: { signal: new AbortController().signal } };
}

function makeJobHandle(section = 'stops', slug = 'test-trip') {
  return {
    workflow: `deepen-section:${section}`,
    slug,
    startedAt: Date.now(),
    controller: new AbortController(),
    opts: {},
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Reset mock implementations so a throw set in one test doesn't bleed into the next.
  mockAssertNotRunning.mockReset();
  mockStartJob.mockReset();
  mockCompleteJob.mockReset();
  mockFailJob.mockReset();
  mockExistsSync.mockReset();
  mockReadFileSync.mockReset();
  mockWriteFileSync.mockReset();
  mockChat.mockReset();
  // Trip dir exists (exploring/test-trip), overview.md exists, section files do NOT exist.
  // Check section files first (more specific) before the trip dir check.
  mockExistsSync.mockImplementation((p) => {
    if (p.includes('stops.md') || p.includes('route.md') || p.includes('logistics.md')) return false;
    if (p.endsWith('overview.md')) return true;
    if (p.includes('exploring/test-trip')) return true;
    return false;
  });
  mockReadFileSync.mockReturnValue(OVERVIEW);
  mockStartJob.mockImplementation(() => makeJobHandle());
  mockChat.mockResolvedValue({
    text: '<stops_md>## Stop A\nDetails here.</stops_md>',
    usage: { input_tokens: 1000, output_tokens: 500 },
  });
});

// ── Route contract ─────────────────────────────────────────────────────────

describe('POST /api/actions/deepen-section/[slug]/[section]', () => {
  it('returns 400 for an invalid section name', async () => {
    const res = await POST({ params: { slug: 'test-trip', section: 'invalid' }, request: { signal: new AbortController().signal } });
    expect(res.status).toBe(400);
  });

  it('returns 404 when trip directory is not found in exploring or planning', async () => {
    mockExistsSync.mockReturnValue(false);
    const res = await POST(makeRequest('missing-trip', 'stops'));
    expect(res.status).toBe(404);
    expect(mockStartJob).not.toHaveBeenCalled();
  });

  it('returns 202 Accepted immediately', async () => {
    const res = await POST(makeRequest('test-trip', 'stops'));
    expect(res.status).toBe(202);
  });

  it('calls assertNotRunning with section-scoped workflow key before starting', async () => {
    await POST(makeRequest('test-trip', 'stops'));
    expect(mockAssertNotRunning).toHaveBeenCalledWith('deepen-section:stops', 'test-trip');
  });

  it('uses section-scoped key for route section too', async () => {
    mockStartJob.mockImplementation(() => makeJobHandle('route'));
    mockChat.mockResolvedValue({
      text: '<route_md>## Day 1\nDrive here.</route_md>',
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    await POST(makeRequest('test-trip', 'route'));
    expect(mockAssertNotRunning).toHaveBeenCalledWith('deepen-section:route', 'test-trip');
  });

  it('returns 409 when assertNotRunning throws TraverseError("already_running")', async () => {
    mockAssertNotRunning.mockImplementation(() => {
      throw new TraverseError('already_running', 'deepen-section:stops already running for test-trip');
    });
    const res = await POST(makeRequest('test-trip', 'stops'));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('already_running');
    expect(mockStartJob).not.toHaveBeenCalled();
    expect(mockChat).not.toHaveBeenCalled();
  });

  it('calls startJob with the section-scoped workflow key and slug', async () => {
    await POST(makeRequest('test-trip', 'stops'));
    expect(mockStartJob).toHaveBeenCalledTimes(1);
    expect(mockStartJob.mock.calls[0][0]).toBe('deepen-section:stops');
    expect(mockStartJob.mock.calls[0][1]).toBe('test-trip');
  });

  it('forwards the job handle AbortController signal into chat()', async () => {
    const controller = new AbortController();
    mockStartJob.mockReturnValue({
      workflow: 'deepen-section:stops',
      slug: 'test-trip',
      startedAt: Date.now(),
      controller,
      opts: {},
    });
    await POST(makeRequest('test-trip', 'stops'));
    await new Promise((r) => setTimeout(r, 20));

    expect(mockChat).toHaveBeenCalledWith(expect.objectContaining({
      signal: controller.signal,
    }));
  });

  it('calls completeJob with the actual token count on success', async () => {
    mockChat.mockResolvedValue({
      text: '<stops_md>## Stop A\nDetails.</stops_md>',
      usage: { input_tokens: 1500, output_tokens: 750 },
    });
    await POST(makeRequest('test-trip', 'stops'));
    await new Promise((r) => setTimeout(r, 20));

    expect(mockCompleteJob).toHaveBeenCalledWith('deepen-section:stops', 'test-trip', { tokens: 2250 });
    expect(mockFailJob).not.toHaveBeenCalled();
  });

  it('handles normalized adapter usage shape {input, output} in completeJob', async () => {
    mockChat.mockResolvedValue({
      text: '<stops_md>## Stop A\nDetails.</stops_md>',
      usage: { input: 300, output: 200 },
    });
    await POST(makeRequest('test-trip', 'stops'));
    await new Promise((r) => setTimeout(r, 20));

    expect(mockCompleteJob).toHaveBeenCalledWith('deepen-section:stops', 'test-trip', { tokens: 500 });
  });

  it('records 0 tokens when no usage is returned', async () => {
    mockChat.mockResolvedValue({
      text: '<stops_md>## Stop A\nDetails.</stops_md>',
      usage: undefined,
    });
    await POST(makeRequest('test-trip', 'stops'));
    await new Promise((r) => setTimeout(r, 20));

    expect(mockCompleteJob).toHaveBeenCalledWith('deepen-section:stops', 'test-trip', { tokens: 0 });
  });

  it('writes the section file to disk on success', async () => {
    await POST(makeRequest('test-trip', 'stops'));
    await new Promise((r) => setTimeout(r, 20));

    expect(mockWriteFileSync).toHaveBeenCalledWith(
      expect.stringContaining('stops.md'),
      expect.stringContaining('Stop A'),
    );
  });

  it('calls failJob with TraverseError code when chat() throws a TraverseError', async () => {
    mockChat.mockRejectedValue(new TraverseError('no_section_content', 'no content returned'));
    await POST(makeRequest('test-trip', 'stops'));
    await new Promise((r) => setTimeout(r, 20));

    expect(mockFailJob).toHaveBeenCalledWith('deepen-section:stops', 'test-trip', expect.objectContaining({
      code: 'no_section_content',
    }));
    expect(mockCompleteJob).not.toHaveBeenCalled();
  });

  it('calls failJob with code "unknown" for generic Error failures', async () => {
    mockChat.mockRejectedValue(new Error('network timeout'));
    await POST(makeRequest('test-trip', 'stops'));
    await new Promise((r) => setTimeout(r, 20));

    expect(mockFailJob).toHaveBeenCalledWith('deepen-section:stops', 'test-trip', expect.objectContaining({
      code: 'unknown',
    }));
    expect(mockCompleteJob).not.toHaveBeenCalled();
  });

  it('does NOT call failJob when chat() aborts (cancelJob owns the failJob call)', async () => {
    const abortErr = new Error('The operation was aborted');
    abortErr.name = 'AbortError';
    mockChat.mockRejectedValue(abortErr);

    await POST(makeRequest('test-trip', 'stops'));
    await new Promise((r) => setTimeout(r, 20));

    // cancelJob() in $lib/server/jobs.js fires the controller AND calls failJob
    // itself; the route's catch must be a no-op for AbortError to avoid
    // double-recording the failure event.
    expect(mockFailJob).not.toHaveBeenCalled();
    expect(mockCompleteJob).not.toHaveBeenCalled();
  });

  it('still returns 202 even when the background work later fails', async () => {
    mockChat.mockRejectedValue(new Error('background failure'));
    const res = await POST(makeRequest('test-trip', 'stops'));
    expect(res.status).toBe(202);
  });
});

// ── _promise export ────────────────────────────────────────────────────────

describe('_promise export', () => {
  it('declares the promise contract for the trigger UI', () => {
    expect(_promise.verb).toBe('Research section');
    expect(_promise.time_seconds).toBeGreaterThan(0);
    expect(Array.isArray(_promise.tokens_range)).toBe(true);
  });
});

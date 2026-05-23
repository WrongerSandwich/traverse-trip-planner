import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- fs mock ---
const { mockExistsSync, mockReadFileSync, mockWriteFileSync, mockMkdirSync, mockUnlinkSync } = vi.hoisted(() => ({
  mockExistsSync: vi.fn(),
  mockReadFileSync: vi.fn(),
  mockWriteFileSync: vi.fn(),
  mockMkdirSync: vi.fn(),
  mockUnlinkSync: vi.fn(),
}));

vi.mock('node:fs', () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
  mkdirSync: mockMkdirSync,
  unlinkSync: mockUnlinkSync,
}));

// --- data mock ---
const {
  mockParseFrontmatter, mockParseFrontmatterFields,
  mockSetFrontmatterField, mockRemoveFrontmatterField,
  mockInvalidateEnrichCache,
} = vi.hoisted(() => ({
  mockParseFrontmatter: vi.fn(),
  mockParseFrontmatterFields: vi.fn(),
  mockSetFrontmatterField: vi.fn(),
  mockRemoveFrontmatterField: vi.fn(),
  mockInvalidateEnrichCache: vi.fn(),
}));

vi.mock('$lib/server/data.js', () => ({
  ROOT: '/test-root',
  readHomeMd: () => '---\ntravelers: [you]\npets_need_sitter: false\n---\n',
  parseFrontmatter: mockParseFrontmatter,
  parseFrontmatterFields: mockParseFrontmatterFields,
  setFrontmatterField: mockSetFrontmatterField,
  removeFrontmatterField: mockRemoveFrontmatterField,
  invalidateEnrichCache: mockInvalidateEnrichCache,
  rejectInvalidSlug: () => null,
  // atomicWrite is now used instead of writeFileSync for crash-safe writes.
  // In tests we map it to mockWriteFileSync so assertions on file writes
  // continue to work.
  atomicWrite: mockWriteFileSync,
}));

// --- AI / search / config mocks ---
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
  getFeatureAvailability: () => ({ homeMdReady: true }),
}));

// --- jobs mock (standardized Ambient Background registry) ---
const {
  mockAssertNotRunning, mockStartJob, mockCompleteJob, mockFailJob, mockCancelJob,
} = vi.hoisted(() => ({
  mockAssertNotRunning: vi.fn(),
  mockStartJob: vi.fn(),
  mockCompleteJob: vi.fn(),
  mockFailJob: vi.fn(),
  mockCancelJob: vi.fn(),
}));

vi.mock('$lib/server/jobs.js', () => ({
  assertNotRunning: mockAssertNotRunning,
  startJob: mockStartJob,
  completeJob: mockCompleteJob,
  failJob: mockFailJob,
  cancelJob: mockCancelJob,
}));

// --- extract-candidates mock (chained onto research; tested in api-deepen-extract.test.js) ---
const mockExtractCandidates = vi.hoisted(() => vi.fn());

vi.mock('$lib/server/extract-candidates.js', () => ({
  extractCandidates: mockExtractCandidates,
}));

// --- plan mock (re-research gate consults readPlan; null = no prior plan) ---
const mockReadPlan = vi.hoisted(() => vi.fn());

vi.mock('$lib/server/plan.js', () => ({
  readPlan: mockReadPlan,
}));

import { TraverseError } from '../src/lib/server/errors.js';
import { GET, POST, DELETE } from '../src/routes/api/actions/deepen/[slug]/+server.js';

const IDEA_CONTENT = '---\ntitle: Test Trip\nstatus: idea\ndestination: Testville\n---\nGreat idea.';

// A fake job handle with an AbortController — mirrors what startJob() returns.
function makeJobHandle() {
  const controller = new AbortController();
  return { workflow: 'deepen', slug: 'test-trip', startedAt: Date.now(), controller, opts: {} };
}

// Build a POST event the way SvelteKit does — needs `url` (for ?force=true
// parsing) as well as `params`. Tests that don't care about the URL still get
// a sensible default; pass `query` to override.
function postEvent({ slug = 'test-trip', query = '' } = {}) {
  return {
    params: { slug },
    url: new URL(`http://x/api/actions/deepen/${slug}${query}`),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: file not found. Override per test.
  mockExistsSync.mockReturnValue(false);
  mockReadFileSync.mockReturnValue(IDEA_CONTENT);
  mockParseFrontmatter.mockReturnValue({ title: 'Test Trip', status: 'idea' });
  mockParseFrontmatterFields.mockReturnValue({});
  mockSetFrontmatterField.mockImplementation((content, field, value) => `${content}\n${field}: ${value}`);
  mockRemoveFrontmatterField.mockImplementation((content, field) => content);
  // Default: assertNotRunning does nothing (not running), startJob returns a handle.
  mockAssertNotRunning.mockReturnValue(undefined);
  mockStartJob.mockReturnValue(makeJobHandle());
  // Default chat: resolves with minimal valid response.
  mockChat.mockResolvedValue({ text: '<overview_prose>prose</overview_prose>', usage: { input_tokens: 100, output_tokens: 50 } });
  // Default extract: resolves cleanly with no extra usage so the existing
  // research-only token assertions in this file stay correct.
  mockExtractCandidates.mockResolvedValue({ usage: undefined });
  // Default: no prior plan — guards in re-research gate stay out of the way.
  mockReadPlan.mockReturnValue(null);
});

// ── GET ────────────────────────────────────────────────────────────────────────

describe('GET /api/actions/deepen/[slug]', () => {
  it('returns 200 when the idea file exists', () => {
    mockExistsSync.mockReturnValue(true);
    const res = GET({ params: { slug: 'test-trip' } });
    expect(res.status).toBe(200);
  });

  it('returns 404 when the idea file does not exist', () => {
    mockExistsSync.mockReturnValue(false);
    const res = GET({ params: { slug: 'missing' } });
    expect(res.status).toBe(404);
  });
});

// ── POST ───────────────────────────────────────────────────────────────────────

describe('POST /api/actions/deepen/[slug]', () => {
  it('returns 404 when slug not found in ideas/', async () => {
    mockExistsSync.mockReturnValue(false);
    const res = await POST(postEvent({ slug: 'missing-trip' }));
    expect(res.status).toBe(404);
  });

  it('returns 409 with already_running code when assertNotRunning throws', async () => {
    mockExistsSync.mockReturnValue(true);
    mockAssertNotRunning.mockImplementation(() => {
      throw new TraverseError('already_running', 'deepen already running for test-trip');
    });
    const res = await POST(postEvent());
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('already_running');
  });

  it('calls assertNotRunning with workflow=deepen and the slug', async () => {
    mockExistsSync.mockReturnValue(true);
    await POST(postEvent());
    expect(mockAssertNotRunning).toHaveBeenCalledWith('deepen', 'test-trip');
  });

  it('calls startJob with workflow=deepen, slug, and est_seconds option', async () => {
    mockExistsSync.mockReturnValue(true);
    await POST(postEvent());
    expect(mockStartJob).toHaveBeenCalledWith('deepen', 'test-trip', expect.objectContaining({ est_seconds: expect.any(Number) }));
  });

  it('returns 202 Accepted on first POST', async () => {
    mockExistsSync.mockReturnValue(true);
    const res = await POST(postEvent());
    expect(res.status).toBe(202);
  });

  it('does NOT write researching:true — uses startJob instead', async () => {
    mockExistsSync.mockReturnValue(true);
    await POST(postEvent());
    // setFrontmatterField should NOT be called with 'researching'
    const calls = mockSetFrontmatterField.mock.calls;
    const researchingCall = calls.find(([, field]) => field === 'researching');
    expect(researchingCall).toBeUndefined();
  });

  it('fire-and-forget success path: calls completeJob with tokens', async () => {
    mockExistsSync.mockReturnValue(true);
    mockChat.mockResolvedValue({
      text: '<overview_prose>prose</overview_prose><route_md>route</route_md>',
      usage: { input_tokens: 200, output_tokens: 100 },
    });

    await POST(postEvent());
    await new Promise(r => setTimeout(r, 50));

    expect(mockCompleteJob).toHaveBeenCalledWith('deepen', 'test-trip', expect.objectContaining({ tokens: 300 }));
  });

  it('fire-and-forget success path: writes to planning/ and unlinks the idea file', async () => {
    mockExistsSync.mockReturnValue(true);
    mockChat.mockResolvedValue({
      text: '<overview_prose>prose</overview_prose><route_md>route</route_md>',
      usage: {},
    });

    await POST(postEvent());
    await new Promise(r => setTimeout(r, 50));

    expect(mockMkdirSync).toHaveBeenCalledWith(
      expect.stringContaining('planning/test-trip'),
      { recursive: true }
    );
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      expect.stringContaining('overview.md'),
      expect.stringContaining('prose')
    );
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      expect.stringContaining('route.md'),
      expect.stringContaining('route')
    );
    expect(mockUnlinkSync).toHaveBeenCalled();
  });

  it('fire-and-forget failure path: calls failJob with error code', async () => {
    mockExistsSync.mockReturnValue(true);
    mockChat.mockRejectedValue(new Error('network timeout'));

    await POST(postEvent());
    await new Promise(r => setTimeout(r, 50));

    expect(mockFailJob).toHaveBeenCalledWith('deepen', 'test-trip', expect.objectContaining({ code: expect.any(String) }));
  });

  it('fire-and-forget abort path: swallows AbortError without calling failJob', async () => {
    mockExistsSync.mockReturnValue(true);
    const err = new Error('The operation was aborted');
    err.name = 'AbortError';
    mockChat.mockRejectedValue(err);

    await POST(postEvent());
    await new Promise(r => setTimeout(r, 50));

    // cancelJob owns the failure event; the catch in the worker must NOT call failJob
    expect(mockFailJob).not.toHaveBeenCalled();
  });

  it('passes AbortController signal from job handle into chat()', async () => {
    mockExistsSync.mockReturnValue(true);
    const handle = makeJobHandle();
    mockStartJob.mockReturnValue(handle);

    let capturedSignal;
    mockChat.mockImplementation(({ signal }) => {
      capturedSignal = signal;
      return Promise.resolve({ text: '<overview_prose>p</overview_prose>', usage: {} });
    });

    await POST(postEvent());
    await new Promise(r => setTimeout(r, 50));

    expect(capturedSignal).toBe(handle.controller.signal);
  });

  // ── Re-research prose-overwrite gate (Task 7.2) ───────────────────────────
  //
  // When a prior plan.md carries non-empty field_guide_notes or gotchas, a
  // plain POST returns 409 with `error: 'plan_prose_present'`. Re-POSTing with
  // ?force=true bypasses the gate. Fresh trips (readPlan() === null) and trips
  // with empty plan prose are unaffected. The gate is intentionally permissive
  // for already_running so the existing 409 path still wins when both apply
  // (assertNotRunning runs first).

  it('returns 409 with plan_prose_present when prior plan has field_guide_notes', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadPlan.mockReturnValue({
      cover_query: '',
      field_guide_notes: 'Bring layers; the canyon is windy.',
      gotchas: '',
      days: [],
    });
    const res = await POST(postEvent());
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('plan_prose_present');
    expect(body.message).toMatch(/field guide notes/i);
    // Guard fires before the job starts.
    expect(mockStartJob).not.toHaveBeenCalled();
  });

  it('returns 409 with plan_prose_present when prior plan has gotchas', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadPlan.mockReturnValue({
      cover_query: '',
      field_guide_notes: '',
      gotchas: 'No service past Mile 42.',
      days: [],
    });
    const res = await POST(postEvent());
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('plan_prose_present');
    expect(mockStartJob).not.toHaveBeenCalled();
  });

  it('bypasses the prose-overwrite gate when ?force=true is set', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadPlan.mockReturnValue({
      cover_query: '',
      field_guide_notes: 'Bring layers; the canyon is windy.',
      gotchas: 'No service past Mile 42.',
      days: [],
    });
    const res = await POST(postEvent({ query: '?force=true' }));
    expect(res.status).toBe(202);
    expect(mockStartJob).toHaveBeenCalledWith('deepen', 'test-trip', expect.any(Object));
  });

  it('proceeds normally when prior plan exists but prose fields are empty', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadPlan.mockReturnValue({
      cover_query: 'mountain pass',
      field_guide_notes: '',
      gotchas: '',
      days: [{ index: 1, title: 'Day 1', stop_ids: [], lodging_id: null }],
    });
    const res = await POST(postEvent());
    expect(res.status).toBe(202);
    expect(mockStartJob).toHaveBeenCalled();
  });

  it('proceeds normally when no prior plan exists (fresh idea)', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadPlan.mockReturnValue(null);
    const res = await POST(postEvent());
    expect(res.status).toBe(202);
    expect(mockStartJob).toHaveBeenCalled();
  });
});

// ── DELETE ─────────────────────────────────────────────────────────────────────

describe('DELETE /api/actions/deepen/[slug]', () => {
  it('returns 200 and calls cancelJob', async () => {
    const res = await DELETE({ params: { slug: 'test-trip' } });
    expect(res.status).toBe(200);
    expect(mockCancelJob).toHaveBeenCalledWith('deepen', 'test-trip');
  });

  it('does not reference cancelRegistry (legacy mechanism is gone)', async () => {
    // If cancelRegistry were still in the module, cancelJob would not be the
    // primary cancel mechanism. This test verifies that after DELETE, cancelJob
    // was called — implying jobs.js owns cancellation.
    mockExistsSync.mockReturnValue(true);
    const res = await DELETE({ params: { slug: 'stale-trip' } });
    expect(res.status).toBe(200);
    expect(mockCancelJob).toHaveBeenCalledWith('deepen', 'stale-trip');
    // Should NOT be calling removeFrontmatterField directly — that's jobs.js's job
    expect(mockRemoveFrontmatterField).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- fs mock ---
const { mockExistsSync, mockReadFileSync, mockWriteFileSync, mockMkdirSync, mockUnlinkSync, mockRenameSync, mockStatSync } = vi.hoisted(() => ({
  mockExistsSync: vi.fn(),
  mockReadFileSync: vi.fn(),
  mockWriteFileSync: vi.fn(),
  mockMkdirSync: vi.fn(),
  mockUnlinkSync: vi.fn(),
  mockRenameSync: vi.fn(),
  mockStatSync: vi.fn(),
}));

vi.mock('node:fs', () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
  mkdirSync: mockMkdirSync,
  unlinkSync: mockUnlinkSync,
  renameSync: mockRenameSync,
  statSync: mockStatSync,
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
  DATA_DIR: '/test-root/data',
  readHomeMd: () => '---\ntravelers: [you]\npets_need_sitter: false\n---\n',
  parseFrontmatter: mockParseFrontmatter,
  parseFrontmatterFields: mockParseFrontmatterFields,
  setFrontmatterField: mockSetFrontmatterField,
  removeFrontmatterField: mockRemoveFrontmatterField,
  invalidateEnrichCache: mockInvalidateEnrichCache,
  rejectInvalidSlug: () => null,
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

// --- realize-plan mock (post-LLM half of the unified pipeline) ---
// The chat call now lives entirely in doResearch(); realizePlan() is the
// merge + geocode + atomic-write step on a pre-parsed extract block.
const mockRealizePlan = vi.hoisted(() => vi.fn(() => Promise.resolve({ renames: [] })));

vi.mock('$lib/server/realize-plan.js', () => ({
  realizePlan: mockRealizePlan,
}));

// --- geocode-candidates kickoff mock (issue #382) ---
// The deepen handler fires this after realizePlan() returns; we mock at the
// endpoint module boundary so the worker doesn't actually start a job.
const mockStartGeocodeCandidatesJob = vi.hoisted(() => vi.fn(() => null));

vi.mock('../src/routes/api/actions/geocode-candidates/[slug]/+server.js', () => ({
  _startGeocodeCandidatesJob: mockStartGeocodeCandidatesJob,
}));

// --- plan mock (re-research gate consults readPlan; null = no prior plan) ---
const mockReadPlan = vi.hoisted(() => vi.fn());

vi.mock('$lib/server/plan.js', () => ({
  readPlan: mockReadPlan,
}));

import { TraverseError } from '../src/lib/server/errors.js';
import { GET, POST, DELETE, _collectDirtySections as collectDirtySections } from '../src/routes/api/actions/deepen/[slug]/+server.js';

const IDEA_CONTENT = '---\ntitle: Test Trip\nstatus: idea\ndestination: Testville\n---\nGreat idea.';
const OVERVIEW_WITH_LAST_RUN = '---\ntitle: Test Trip\nstatus: planning\nlast_run_success_at: 2026-05-20T12:00:00.000Z\n---\nProse.';

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

// Build a fully-formed unified envelope for tests that don't care about the
// content — just need parsing to succeed. doResearch() now requires all six
// tags (overview_prose + plan + candidates are mandatory; the others are
// optional).
const VALID_ENVELOPE = [
  '<overview_prose>prose</overview_prose>',
  '<plan>',
  'cover_query: test',
  'field_guide_notes: []',
  'gotchas: []',
  '</plan>',
  '<candidates>',
  'stops: []',
  'lodging: []',
  '</candidates>',
].join('\n');

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
  // Default chat: resolves with a fully-formed unified envelope so the
  // six-section parser in doResearch() doesn't throw.
  mockChat.mockResolvedValue({ text: VALID_ENVELOPE, usage: { input_tokens: 100, output_tokens: 50 } });
  // Reset the geocode-candidates kickoff mock so each test starts fresh.
  mockStartGeocodeCandidatesJob.mockReset();
  mockStartGeocodeCandidatesJob.mockReturnValue(null);
  // Default realize: resolves cleanly with no renames.
  mockRealizePlan.mockResolvedValue({ renames: [] });
  // Default: no prior plan — re-research gate stays out of the way.
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
  it('returns 404 when slug not found in ideas/ or planning/', async () => {
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

  it('after realizePlan() returns, fires _startGeocodeCandidatesJob for the slug (issue #382)', async () => {
    mockExistsSync.mockReturnValue(true);
    await POST(postEvent());
    await new Promise(r => setTimeout(r, 50));
    expect(mockStartGeocodeCandidatesJob).toHaveBeenCalledWith('test-trip');
  });

  it('does not call _startGeocodeCandidatesJob when realizePlan throws', async () => {
    mockExistsSync.mockReturnValue(true);
    mockRealizePlan.mockRejectedValue(new Error('realize boom'));
    await POST(postEvent());
    await new Promise(r => setTimeout(r, 50));
    expect(mockStartGeocodeCandidatesJob).not.toHaveBeenCalled();
  });

    it('fire-and-forget success path: calls completeJob with tokens', async () => {
    mockExistsSync.mockReturnValue(true);
    mockChat.mockResolvedValue({
      text: VALID_ENVELOPE,
      usage: { input_tokens: 200, output_tokens: 100 },
    });

    await POST(postEvent());
    await new Promise(r => setTimeout(r, 50));

    expect(mockCompleteJob).toHaveBeenCalledWith('deepen', 'test-trip', expect.objectContaining({ tokens: 300 }));
  });

  it('makes exactly ONE chat() call per deepen run (no second extract leg)', async () => {
    mockExistsSync.mockImplementation(p => p.endsWith('ideas/test-trip.md'));
    mockChat.mockResolvedValue({ text: VALID_ENVELOPE, usage: {} });

    await POST(postEvent());
    await new Promise(r => setTimeout(r, 50));

    expect(mockChat).toHaveBeenCalledTimes(1);
  });

  it('passes label "deepen" and maxTokens 12000 (the unified envelope budget) into chat()', async () => {
    mockExistsSync.mockImplementation(p => p.endsWith('ideas/test-trip.md'));
    mockChat.mockResolvedValue({ text: VALID_ENVELOPE, usage: {} });

    await POST(postEvent());
    await new Promise(r => setTimeout(r, 50));

    expect(mockChat).toHaveBeenCalledWith(expect.objectContaining({
      label: 'deepen',
      maxTokens: 12000,
    }));
  });

  it('asks the model for the six unified-envelope tags in its system prompt', async () => {
    mockExistsSync.mockImplementation(p => p.endsWith('ideas/test-trip.md'));
    mockChat.mockResolvedValue({ text: VALID_ENVELOPE, usage: {} });

    await POST(postEvent());
    await new Promise(r => setTimeout(r, 50));

    const call = mockChat.mock.calls[0][0];
    const system = call.system ?? '';
    // The new prompt asks for six top-level tags.
    expect(system).toContain('<overview_prose>');
    expect(system).toContain('<frontmatter>');
    expect(system).toContain('<route_md>');
    expect(system).toContain('<logistics_md>');
    expect(system).toContain('<plan>');
    expect(system).toContain('<candidates>');
  });

  it('parses the response and forwards parsed plan + candidates to realizePlan()', async () => {
    mockExistsSync.mockImplementation(p => p.endsWith('ideas/test-trip.md'));
    mockChat.mockResolvedValue({
      text: [
        '<overview_prose>prose</overview_prose>',
        '<plan>',
        'cover_query: glacier alpine lake',
        'field_guide_notes:',
        '  - Bring layers',
        'gotchas: []',
        '</plan>',
        '<candidates>',
        'stops:',
        '  - name: Lake McDonald',
        '    category: outdoors',
        'lodging: []',
        '</candidates>',
      ].join('\n'),
      usage: {},
    });

    await POST(postEvent());
    await new Promise(r => setTimeout(r, 50));

    expect(mockRealizePlan).toHaveBeenCalledTimes(1);
    const [slug, parsed, opts] = mockRealizePlan.mock.calls[0];
    expect(slug).toBe('test-trip');
    expect(parsed).toEqual({
      plan: expect.objectContaining({
        cover_query: 'glacier alpine lake',
        field_guide_notes: ['Bring layers'],
      }),
      candidates: expect.objectContaining({
        stops: [expect.objectContaining({ name: 'Lake McDonald', category: 'outdoors' })],
        lodging: [],
      }),
    });
    expect(opts).toEqual(expect.objectContaining({ signal: expect.anything() }));
  });

  it('fire-and-forget success path: stages prose .tmp files, then renames; idea unlinked last', async () => {
    mockExistsSync.mockImplementation(p => p.endsWith('ideas/test-trip.md'));
    mockChat.mockResolvedValue({
      text: [
        '<overview_prose>prose</overview_prose>',
        '<route_md>route</route_md>',
        '<plan>',
        'field_guide_notes: []',
        'gotchas: []',
        '</plan>',
        '<candidates>',
        'stops: []',
        'lodging: []',
        '</candidates>',
      ].join('\n'),
      usage: {},
    });

    await POST(postEvent());
    await new Promise(r => setTimeout(r, 50));

    expect(mockMkdirSync).toHaveBeenCalledWith(
      expect.stringContaining('planning/test-trip'),
      { recursive: true }
    );
    // Stage writes go to .tmp files first.
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      expect.stringContaining('overview.md.tmp'),
      expect.stringContaining('prose')
    );
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      expect.stringContaining('route.md.tmp'),
      expect.stringContaining('route')
    );
    // Then renamed into place.
    expect(mockRenameSync).toHaveBeenCalledWith(
      expect.stringContaining('overview.md.tmp'),
      expect.stringContaining('overview.md')
    );
    expect(mockRenameSync).toHaveBeenCalledWith(
      expect.stringContaining('route.md.tmp'),
      expect.stringContaining('route.md')
    );
    // Idea file unlinked after all renames succeed.
    expect(mockUnlinkSync).toHaveBeenCalled();
  });

  it('does not write stops.md even when model emits a <stops_md> block (legacy tag is ignored)', async () => {
    mockExistsSync.mockImplementation(p => p.endsWith('ideas/test-trip.md'));
    mockChat.mockResolvedValue({
      text: [
        '<overview_prose>prose</overview_prose>',
        '<stops_md>## Stop A\nGreat stop.</stops_md>',
        '<plan>',
        'field_guide_notes: []',
        'gotchas: []',
        '</plan>',
        '<candidates>',
        'stops: []',
        'lodging: []',
        '</candidates>',
      ].join('\n'),
      usage: {},
    });

    await POST(postEvent());
    await new Promise(r => setTimeout(r, 50));

    const writtenPaths = mockWriteFileSync.mock.calls.map(([p]) => p);
    const stopsWrites = writtenPaths.filter(p => p.endsWith('stops.md'));
    expect(stopsWrites).toHaveLength(0);
  });

  it('write failure mid-prose-stage: cleans up .tmp files, leaves idea intact, job fails', async () => {
    // Idea file present; simulate writeFileSync throwing on the second call
    // (after overview.md.tmp is staged, route.md.tmp write fails).
    mockExistsSync.mockImplementation(p => p.endsWith('ideas/test-trip.md'));
    mockChat.mockResolvedValue({
      text: [
        '<overview_prose>prose</overview_prose>',
        '<route_md>route</route_md>',
        '<plan>',
        'field_guide_notes: []',
        'gotchas: []',
        '</plan>',
        '<candidates>',
        'stops: []',
        'lodging: []',
        '</candidates>',
      ].join('\n'),
      usage: {},
    });

    let writeCallCount = 0;
    mockWriteFileSync.mockImplementation((path) => {
      writeCallCount++;
      if (writeCallCount === 2) throw new Error('ENOSPC: no space left on device');
    });

    await POST(postEvent());
    await new Promise(r => setTimeout(r, 50));

    // No renames should have happened — staging failed before any rename.
    expect(mockRenameSync).not.toHaveBeenCalled();
    // Temp cleanup: any staged .tmp files should have been unlinked.
    const unlinkCalls = mockUnlinkSync.mock.calls.map(([p]) => p);
    const tmpCleaned = unlinkCalls.some(p => p.endsWith('.tmp'));
    expect(tmpCleaned).toBe(true);
    // The idea file should NOT have been unlinked (rollback succeeded).
    const ideaUnlinked = unlinkCalls.some(p => p.endsWith('ideas/test-trip.md'));
    expect(ideaUnlinked).toBe(false);
    // realizePlan never ran (we failed in the prose-stage phase).
    expect(mockRealizePlan).not.toHaveBeenCalled();
    // The overall job must fail, not complete.
    expect(mockFailJob).toHaveBeenCalled();
    expect(mockCompleteJob).not.toHaveBeenCalled();
  });

  it('realizePlan failure: leaves idea intact, no plan.yaml visible, job fails', async () => {
    // The unified envelope is the whole-pipeline contract: when the post-
    // LLM half fails, the idea file MUST NOT be unlinked. That guarantees
    // the trip stays recoverable by re-running deepen.
    mockExistsSync.mockImplementation(p => p.endsWith('ideas/test-trip.md'));
    mockChat.mockResolvedValue({ text: VALID_ENVELOPE, usage: {} });
    mockRealizePlan.mockRejectedValue(new Error('realize boom'));

    await POST(postEvent());
    await new Promise(r => setTimeout(r, 50));

    // idea file must NOT be unlinked — the pipeline failed mid-flow.
    const unlinkCalls = mockUnlinkSync.mock.calls.map(([p]) => p);
    const ideaUnlinked = unlinkCalls.some(p => p.endsWith('ideas/test-trip.md'));
    expect(ideaUnlinked).toBe(false);
    // Job fails (not completes) because the overall job threw.
    expect(mockFailJob).toHaveBeenCalled();
    expect(mockCompleteJob).not.toHaveBeenCalled();
  });

  it('planning-stage trip: runs full unified pipeline (chat + realizePlan), keeps idea-unlink off', async () => {
    // The old extract-only branch is gone. Planning-stage POST now ALWAYS
    // re-runs research (gated by plan_prose_present when prose is dirty).
    // idea file absent; planning/overview.md present; plan.md present
    mockExistsSync.mockImplementation(p => {
      if (p.endsWith('ideas/test-trip.md'))                   return false;
      if (p.endsWith('planning/test-trip/overview.md'))       return true;
      if (p.endsWith('planning/test-trip/plan.md'))           return true;
      return false;
    });
    mockReadFileSync.mockReturnValue(OVERVIEW_WITH_LAST_RUN);
    mockParseFrontmatter.mockReturnValue({ last_run_success_at: '2026-05-20T12:00:00.000Z' });
    mockChat.mockResolvedValue({ text: VALID_ENVELOPE, usage: { input_tokens: 100, output_tokens: 50 } });

    await POST(postEvent());
    await new Promise(r => setTimeout(r, 50));

    // Chat runs.
    expect(mockChat).toHaveBeenCalledTimes(1);
    // idea file should NOT be unlinked in re-research mode (no idea file exists).
    const unlinkCalls = mockUnlinkSync.mock.calls.map(([p]) => p);
    const ideaUnlinked = unlinkCalls.some(p => p.endsWith('ideas/test-trip.md'));
    expect(ideaUnlinked).toBe(false);
    // realizePlan still runs.
    expect(mockRealizePlan).toHaveBeenCalled();
    expect(mockCompleteJob).toHaveBeenCalled();
  });

  it('planning-stage trip with no plan.md: ALSO runs full pipeline (extract-only branch retired)', async () => {
    // Before #380 this hit the extract-only branch (skip chat, just call
    // extractCandidates). After #380 there is no such branch — the
    // planning-stage POST always runs the full unified pipeline.
    mockExistsSync.mockImplementation(p => {
      if (p.endsWith('ideas/test-trip.md'))                   return false;
      if (p.endsWith('planning/test-trip/overview.md'))       return true;
      if (p.endsWith('planning/test-trip/plan.md'))           return false;
      if (p.endsWith('planning/test-trip/plan.yaml'))         return false;
      return false;
    });
    mockReadFileSync.mockReturnValue(OVERVIEW_WITH_LAST_RUN);
    mockParseFrontmatter.mockReturnValue({ last_run_success_at: '2026-05-20T12:00:00.000Z' });

    await POST(postEvent());
    await new Promise(r => setTimeout(r, 50));

    // Chat ran — the old skip-chat behavior is gone.
    expect(mockChat).toHaveBeenCalledTimes(1);
    expect(mockRealizePlan).toHaveBeenCalled();
    expect(mockCompleteJob).toHaveBeenCalled();
  });

  it('returns 404 when neither ideas/<slug>.md nor planning/<slug>/overview.md exists', async () => {
    mockExistsSync.mockReturnValue(false);
    const res = await POST(postEvent({ slug: 'totally-missing' }));
    expect(res.status).toBe(404);
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
      return Promise.resolve({ text: VALID_ENVELOPE, usage: {} });
    });

    await POST(postEvent());
    await new Promise(r => setTimeout(r, 50));

    expect(capturedSignal).toBe(handle.controller.signal);
  });

  // ── Re-research prose-overwrite gate ─────────────────────────────────────
  //
  // Gate fires whenever the planning overview exists and dirty prose is
  // detected. The old extract-only branch (which used to bypass the gate
  // entirely) is gone after #380, so the gate now also applies to the
  // "planning trip with no plan.md" case.
  // ?force=true bypasses the gate entirely.

  it('returns 409 with plan_prose_present when re-researching a trip with field_guide_notes', async () => {
    // planning/overview.md present + plan.md present → re-research mode
    mockExistsSync.mockImplementation(p => {
      if (p.endsWith('ideas/test-trip.md'))                 return false;
      if (p.endsWith('planning/test-trip/overview.md'))     return true;
      if (p.endsWith('planning/test-trip/plan.md'))         return true;
      return false;
    });
    mockReadFileSync.mockReturnValue(OVERVIEW_WITH_LAST_RUN);
    mockParseFrontmatter.mockReturnValue({ title: 'Test Trip', status: 'planning', last_run_success_at: '2026-05-20T12:00:00.000Z' });
    mockReadPlan.mockReturnValue({
      cover_query: null,
      field_guide_notes: 'Bring layers; the canyon is windy.',
      gotchas: '',
      days: [],
    });
    const res = await POST(postEvent());
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('plan_prose_present');
    expect(body.dirty_sections).toContain('plan');
    expect(body.message).toMatch(/re-research will overwrite/i);
    // Gate fires before the job starts.
    expect(mockStartJob).not.toHaveBeenCalled();
  });

  it('returns 409 and includes dirty_sections array in the response body', async () => {
    mockExistsSync.mockImplementation(p => {
      if (p.endsWith('ideas/test-trip.md'))                 return false;
      if (p.endsWith('planning/test-trip/overview.md'))     return true;
      if (p.endsWith('planning/test-trip/plan.md'))         return true;
      return false;
    });
    mockReadFileSync.mockReturnValue(OVERVIEW_WITH_LAST_RUN);
    mockParseFrontmatter.mockReturnValue({ last_run_success_at: '2026-05-20T12:00:00.000Z' });
    mockReadPlan.mockReturnValue({
      field_guide_notes: 'Bring layers.',
      gotchas: '',
      days: [],
    });
    const res = await POST(postEvent());
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(Array.isArray(body.dirty_sections)).toBe(true);
    expect(body.dirty_sections.length).toBeGreaterThan(0);
  });

  it('returns 202 with ?force=true even when re-researching a trip with plan prose', async () => {
    mockExistsSync.mockImplementation(p => {
      if (p.endsWith('ideas/test-trip.md'))                 return false;
      if (p.endsWith('planning/test-trip/overview.md'))     return true;
      if (p.endsWith('planning/test-trip/plan.md'))         return true;
      return false;
    });
    mockReadFileSync.mockReturnValue(OVERVIEW_WITH_LAST_RUN);
    mockParseFrontmatter.mockReturnValue({ last_run_success_at: '2026-05-20T12:00:00.000Z' });
    mockReadPlan.mockReturnValue({
      cover_query: null,
      field_guide_notes: 'Bring layers.',
      gotchas: 'No service past Mile 42.',
      days: [],
    });
    mockChat.mockResolvedValue({ text: '<overview_prose>prose</overview_prose>', usage: {} });
    const res = await POST(postEvent({ query: '?force=true' }));
    expect(res.status).toBe(202);
    expect(mockStartJob).toHaveBeenCalled();
  });

  it('proceeds without gate when re-researching a trip with empty plan prose fields and no dirty sections', async () => {
    mockExistsSync.mockImplementation(p => {
      if (p.endsWith('ideas/test-trip.md'))                 return false;
      if (p.endsWith('planning/test-trip/overview.md'))     return true;
      if (p.endsWith('planning/test-trip/plan.md'))         return true;
      return false;
    });
    // overview has last_run_success_at; sections are absent (safeStat returns null)
    mockReadFileSync.mockReturnValue(OVERVIEW_WITH_LAST_RUN);
    mockParseFrontmatter.mockReturnValue({ last_run_success_at: '2026-05-20T12:00:00.000Z' });
    mockReadPlan.mockReturnValue({
      cover_query: 'mountain pass',
      field_guide_notes: '',
      gotchas: '',
      days: [{ index: 1, title: 'Day 1', stop_ids: [], lodging_id: null }],
    });
    mockChat.mockResolvedValue({ text: '<overview_prose>prose</overview_prose>', usage: {} });
    const res = await POST(postEvent());
    expect(res.status).toBe(202);
    expect(mockStartJob).toHaveBeenCalled();
  });

  it('gate passes through to 202 when planning overview exists but no dirty prose', async () => {
    // After #380 the gate fires on every planning-stage POST (the old
    // "extract-only recovery" carve-out is gone). Without dirty prose the
    // gate is a no-op and the job starts normally.
    mockExistsSync.mockImplementation(p => {
      if (p.endsWith('ideas/test-trip.md'))                 return false;
      if (p.endsWith('planning/test-trip/overview.md'))     return true;
      if (p.endsWith('planning/test-trip/plan.md'))         return false;
      if (p.endsWith('planning/test-trip/plan.yaml'))       return false;
      return false;
    });
    mockReadFileSync.mockReturnValue(OVERVIEW_WITH_LAST_RUN);
    mockParseFrontmatter.mockReturnValue({ last_run_success_at: '2026-05-20T12:00:00.000Z' });
    // No prior plan and no dirty section mtimes → dirty list empty → gate passes.
    mockReadPlan.mockReturnValue(null);
    const res = await POST(postEvent());
    expect(res.status).toBe(202);
    expect(mockStartJob).toHaveBeenCalled();
  });

  // ── Empty-response retry ────────────────────────────────────────────────
  //
  // Models like gemini-3.x-pro-preview occasionally exit the tool-use loop
  // with empty final content. doResearch() retries once before giving up.

  it('retries the chat call once when the first response is empty text', async () => {
    mockExistsSync.mockImplementation(p => p.endsWith('ideas/test-trip.md'));
    mockChat
      .mockResolvedValueOnce({ text: '', usage: { input: 1000, output: 500 } })
      .mockResolvedValueOnce({ text: VALID_ENVELOPE, usage: { input: 1200, output: 600 } });

    await POST(postEvent());
    await new Promise(r => setTimeout(r, 50));

    expect(mockChat).toHaveBeenCalledTimes(2);
    expect(mockFailJob).not.toHaveBeenCalled();
    expect(mockCompleteJob).toHaveBeenCalledWith('deepen', 'test-trip', expect.objectContaining({
      // Accumulated usage across both attempts: (1000+500) + (1200+600) = 3300.
      tokens: 3300,
    }));
  });

  it('fails after one retry when both responses are empty', async () => {
    mockExistsSync.mockImplementation(p => p.endsWith('ideas/test-trip.md'));
    mockChat
      .mockResolvedValueOnce({ text: '', usage: { input: 1000, output: 500 } })
      .mockResolvedValueOnce({ text: '', usage: { input: 1100, output: 550 } });

    await POST(postEvent());
    await new Promise(r => setTimeout(r, 50));

    expect(mockChat).toHaveBeenCalledTimes(2);
    expect(mockFailJob).toHaveBeenCalledWith('deepen', 'test-trip', expect.objectContaining({
      code: expect.any(String),
    }));
  });

  it('retries when the first response has content but is missing <plan> / <candidates> tags', async () => {
    // Post-#417: missing-tags is now treated the same as empty/invalid-YAML —
    // opus emission has real per-attempt variance, and retrying once is cheap
    // insurance against a transient truncation. The old contract (fail fast)
    // was wrong about how the model behaves.
    mockExistsSync.mockImplementation(p => p.endsWith('ideas/test-trip.md'));
    mockChat
      .mockResolvedValueOnce({ text: 'I cannot help with that.', usage: { input: 1000, output: 50 } })
      .mockResolvedValueOnce({ text: VALID_ENVELOPE, usage: { input: 1200, output: 600 } });

    await POST(postEvent());
    await new Promise(r => setTimeout(r, 50));

    expect(mockChat).toHaveBeenCalledTimes(2);
    expect(mockFailJob).not.toHaveBeenCalled();
    expect(mockCompleteJob).toHaveBeenCalled();
  });

  it('fails after one retry when both responses are missing tags', async () => {
    mockExistsSync.mockImplementation(p => p.endsWith('ideas/test-trip.md'));
    mockChat
      .mockResolvedValueOnce({ text: 'I cannot help with that.', usage: { input: 1000, output: 50 } })
      .mockResolvedValueOnce({ text: 'Still cannot help.', usage: { input: 1000, output: 50 } });

    await POST(postEvent());
    await new Promise(r => setTimeout(r, 50));

    expect(mockChat).toHaveBeenCalledTimes(2);
    expect(mockFailJob).toHaveBeenCalledWith('deepen', 'test-trip', expect.objectContaining({
      code: 'model_returned_invalid_yaml',
    }));
  });

  // ── YAML-failure retry (issue #417) ────────────────────────────────────
  //
  // Opus reliably emits long description values wrapped onto column-1
  // continuation lines, which strict YAML reads as a new implicit key.
  // cleanupModelYaml() fixes the common shape pre-parse; this loop retries
  // once if the cleaned output is still unparseable.

  it('retries when the first response has unparseable YAML in <plan> / <candidates>', async () => {
    mockExistsSync.mockImplementation(p => p.endsWith('ideas/test-trip.md'));
    const brokenYaml = [
      '<overview_prose>prose</overview_prose>',
      '<plan>',
      'cover_query: "test"',
      'field_guide_notes: []',
      'gotchas:',
      '  -',
      '"unclosed string at column 1',
      '</plan>',
      '<candidates>',
      'stops: []',
      'lodging: []',
      '</candidates>',
    ].join('\n');
    mockChat
      .mockResolvedValueOnce({ text: brokenYaml, usage: { input: 1000, output: 500 } })
      .mockResolvedValueOnce({ text: VALID_ENVELOPE, usage: { input: 1200, output: 600 } });

    await POST(postEvent());
    await new Promise(r => setTimeout(r, 50));

    expect(mockChat).toHaveBeenCalledTimes(2);
    expect(mockFailJob).not.toHaveBeenCalled();
    expect(mockCompleteJob).toHaveBeenCalled();
  });

  it('cleanupModelYaml fixes the column-1 wrapping shape inline (no retry needed)', async () => {
    // The most common opus failure: `description:` followed by content on
    // the next line at column 1. cleanupModelYaml folds it back inline and
    // the parse succeeds on attempt 1.
    mockExistsSync.mockImplementation(p => p.endsWith('ideas/test-trip.md'));
    const wrappedYaml = [
      '<overview_prose>prose</overview_prose>',
      '<plan>',
      'cover_query: "test"',
      'field_guide_notes: []',
      'gotchas: []',
      '</plan>',
      '<candidates>',
      'stops:',
      '  - name: "Wrapped Place"',
      '    category: historic',
      '    description:',
      'A description that opus wrapped to column 1, breaking strict YAML.',
      'lodging: []',
      '</candidates>',
    ].join('\n');
    mockChat.mockResolvedValueOnce({ text: wrappedYaml, usage: { input: 1000, output: 500 } });

    await POST(postEvent());
    await new Promise(r => setTimeout(r, 50));

    expect(mockChat).toHaveBeenCalledTimes(1);
    expect(mockFailJob).not.toHaveBeenCalled();
    expect(mockRealizePlan).toHaveBeenCalledWith(
      'test-trip',
      expect.objectContaining({
        candidates: expect.objectContaining({
          stops: [expect.objectContaining({
            description: 'A description that opus wrapped to column 1, breaking strict YAML.',
          })],
        }),
      }),
      expect.anything(),
    );
  });

});

// ── _collectDirtySections ──────────────────────────────────────────────────────
//
// Unit tests for the exported helper that drives the widened gate. Uses the
// injectable `stat` option to avoid touching real fs mtimes.

describe('_collectDirtySections (re-research gate logic)', () => {
  const LAST_RUN = new Date('2026-05-20T12:00:00.000Z').getTime(); // reference timestamp

  function makeOverviewContent(lastRunAt) {
    return `---\ntitle: Test Trip\nstatus: planning\nlast_run_success_at: ${lastRunAt}\n---\nProse.`;
  }

  beforeEach(() => {
    mockReadPlan.mockReturnValue(null); // default: no plan prose
  });

  it('returns [] when no plan prose and no sections are dirty', () => {
    mockReadFileSync.mockReturnValue(makeOverviewContent('2026-05-20T12:00:00.000Z'));
    mockParseFrontmatter.mockReturnValue({ last_run_success_at: '2026-05-20T12:00:00.000Z' });
    // All section mtimes are BEFORE last_run (i.e. not dirty)
    const stat = () => ({ mtimeMs: LAST_RUN - 1000 });
    const result = collectDirtySections('test-trip', { stat });
    expect(result).toEqual([]);
  });

  it('returns ["plan"] when field_guide_notes is non-empty', () => {
    mockReadPlan.mockReturnValue({ field_guide_notes: 'Some notes.', gotchas: '', days: [] });
    mockReadFileSync.mockReturnValue(makeOverviewContent('2026-05-20T12:00:00.000Z'));
    mockParseFrontmatter.mockReturnValue({ last_run_success_at: '2026-05-20T12:00:00.000Z' });
    const stat = () => ({ mtimeMs: LAST_RUN - 1000 });
    const result = collectDirtySections('test-trip', { stat });
    expect(result).toContain('plan');
  });

  it('returns ["plan"] when gotchas is non-empty', () => {
    mockReadPlan.mockReturnValue({ field_guide_notes: '', gotchas: 'Watch the ferry schedule.', days: [] });
    mockReadFileSync.mockReturnValue(makeOverviewContent('2026-05-20T12:00:00.000Z'));
    mockParseFrontmatter.mockReturnValue({ last_run_success_at: '2026-05-20T12:00:00.000Z' });
    const stat = () => ({ mtimeMs: LAST_RUN - 1000 });
    const result = collectDirtySections('test-trip', { stat });
    expect(result).toContain('plan');
  });

  it('returns ["overview"] when overview.md mtime > last_run_success_at', () => {
    mockReadFileSync.mockReturnValue(makeOverviewContent('2026-05-20T12:00:00.000Z'));
    mockParseFrontmatter.mockReturnValue({ last_run_success_at: '2026-05-20T12:00:00.000Z' });
    const stat = (p) => {
      if (p.endsWith('overview.md')) return { mtimeMs: LAST_RUN + 5000 }; // newer
      return { mtimeMs: LAST_RUN - 1000 }; // not dirty
    };
    const result = collectDirtySections('test-trip', { stat });
    expect(result).toContain('overview');
    expect(result).not.toContain('route');
    expect(result).not.toContain('logistics');
  });

  it('returns ["route"] when route.md mtime > last_run_success_at', () => {
    mockReadFileSync.mockReturnValue(makeOverviewContent('2026-05-20T12:00:00.000Z'));
    mockParseFrontmatter.mockReturnValue({ last_run_success_at: '2026-05-20T12:00:00.000Z' });
    const stat = (p) => {
      if (p.endsWith('route.md')) return { mtimeMs: LAST_RUN + 5000 }; // newer
      return { mtimeMs: LAST_RUN - 1000 };
    };
    const result = collectDirtySections('test-trip', { stat });
    expect(result).toContain('route');
    expect(result).not.toContain('overview');
    expect(result).not.toContain('logistics');
  });

  it('returns ["logistics"] when logistics.md mtime > last_run_success_at', () => {
    mockReadFileSync.mockReturnValue(makeOverviewContent('2026-05-20T12:00:00.000Z'));
    mockParseFrontmatter.mockReturnValue({ last_run_success_at: '2026-05-20T12:00:00.000Z' });
    const stat = (p) => {
      if (p.endsWith('logistics.md')) return { mtimeMs: LAST_RUN + 5000 }; // newer
      return { mtimeMs: LAST_RUN - 1000 };
    };
    const result = collectDirtySections('test-trip', { stat });
    expect(result).toContain('logistics');
    expect(result).not.toContain('overview');
    expect(result).not.toContain('route');
  });

  it('returns multiple sections when several are dirty', () => {
    mockReadPlan.mockReturnValue({ field_guide_notes: 'notes', gotchas: '', days: [] });
    mockReadFileSync.mockReturnValue(makeOverviewContent('2026-05-20T12:00:00.000Z'));
    mockParseFrontmatter.mockReturnValue({ last_run_success_at: '2026-05-20T12:00:00.000Z' });
    const stat = (p) => {
      if (p.endsWith('overview.md')) return { mtimeMs: LAST_RUN + 1000 };
      if (p.endsWith('route.md'))    return { mtimeMs: LAST_RUN + 2000 };
      return { mtimeMs: LAST_RUN - 1000 };
    };
    const result = collectDirtySections('test-trip', { stat });
    expect(result).toContain('plan');
    expect(result).toContain('overview');
    expect(result).toContain('route');
    expect(result).not.toContain('logistics');
  });

  it('skips mtime check when last_run_success_at is absent from overview frontmatter', () => {
    // No last_run_success_at → can't compare → skip section-mtime checks
    mockReadFileSync.mockReturnValue('---\ntitle: Test Trip\nstatus: planning\n---\nProse.');
    mockParseFrontmatter.mockReturnValue({ title: 'Test Trip', status: 'planning' });
    const stat = () => ({ mtimeMs: Date.now() + 99999 }); // would be dirty if checked
    const result = collectDirtySections('test-trip', { stat });
    // Without last_run_success_at there's nothing to compare against — no section dirtiness
    expect(result).toEqual([]);
  });

  it('returns [] when stat returns null for a section (file absent)', () => {
    mockReadFileSync.mockReturnValue(makeOverviewContent('2026-05-20T12:00:00.000Z'));
    mockParseFrontmatter.mockReturnValue({ last_run_success_at: '2026-05-20T12:00:00.000Z' });
    const stat = () => null; // all section stats return null → can't be dirty
    const result = collectDirtySections('test-trip', { stat });
    expect(result).toEqual([]);
  });

  it('returns [] when overview.md cannot be read (no overview → no mtime checks)', () => {
    mockReadFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
    const stat = () => ({ mtimeMs: Date.now() + 99999 });
    const result = collectDirtySections('test-trip', { stat });
    expect(result).toEqual([]);
  });

  it('does not include "plan" when plan prose fields are empty strings', () => {
    mockReadPlan.mockReturnValue({ field_guide_notes: '', gotchas: '', days: [] });
    mockReadFileSync.mockReturnValue(makeOverviewContent('2026-05-20T12:00:00.000Z'));
    mockParseFrontmatter.mockReturnValue({ last_run_success_at: '2026-05-20T12:00:00.000Z' });
    const stat = () => ({ mtimeMs: LAST_RUN - 1000 });
    const result = collectDirtySections('test-trip', { stat });
    expect(result).not.toContain('plan');
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

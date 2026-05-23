import { describe, it, expect, vi, beforeEach } from 'vitest';

// Task 2.2: After research succeeds, the same background 'deepen' job must
// chain extractCandidates() to populate plan.md + candidates.md. The caller
// never sees two passes — there's still one Ambient Background job.
//
// Contract under test:
// - doResearch resolves → extractCandidates(slug, { signal }) runs next.
// - completeJob receives tokens = research_tokens + extract_tokens.
// - doResearch rejects → extractCandidates is NOT called; failJob fires with
//   the research error.
// - extractCandidates rejects → failJob fires with the extractor's error code;
//   the already-written prose files stay on disk (no rollback).

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
  mockParseFrontmatter, mockParseFrontmatterFields, mockInvalidateEnrichCache,
} = vi.hoisted(() => ({
  mockParseFrontmatter: vi.fn(),
  mockParseFrontmatterFields: vi.fn(),
  mockInvalidateEnrichCache: vi.fn(),
}));

vi.mock('$lib/server/data.js', () => ({
  ROOT: '/test-root',
  readHomeMd: () => '---\ntravelers: [you]\npets_need_sitter: false\n---\n',
  parseFrontmatter: mockParseFrontmatter,
  parseFrontmatterFields: mockParseFrontmatterFields,
  invalidateEnrichCache: mockInvalidateEnrichCache,
  rejectInvalidSlug: () => null,
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

// --- jobs mock ---
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

// --- extract-candidates mock (the new dependency under test) ---
const mockExtractCandidates = vi.hoisted(() => vi.fn());

vi.mock('$lib/server/extract-candidates.js', () => ({
  extractCandidates: mockExtractCandidates,
}));

// --- plan mock (re-research gate consults readPlan; null = no prior plan) ---
const mockReadPlan = vi.hoisted(() => vi.fn(() => null));

vi.mock('$lib/server/plan.js', () => ({
  readPlan: mockReadPlan,
}));

import { TraverseError } from '../src/lib/server/errors.js';
import { POST } from '../src/routes/api/actions/deepen/[slug]/+server.js';

const IDEA_CONTENT = '---\ntitle: Test Trip\nstatus: idea\ndestination: Testville\n---\nGreat idea.';

function makeJobHandle() {
  const controller = new AbortController();
  return { workflow: 'deepen', slug: 'test-trip', startedAt: Date.now(), controller, opts: {} };
}

// Default research response: minimal valid <overview_prose> so doResearch
// returns successfully. usage = 300 tokens (200 + 100).
const RESEARCH_USAGE = { input_tokens: 200, output_tokens: 100 };
const EXTRACT_USAGE = { input_tokens: 80, output_tokens: 40 };

beforeEach(() => {
  vi.clearAllMocks();
  mockExistsSync.mockReturnValue(true); // idea file exists
  mockReadFileSync.mockReturnValue(IDEA_CONTENT);
  mockParseFrontmatter.mockReturnValue({ title: 'Test Trip', status: 'idea' });
  mockParseFrontmatterFields.mockReturnValue({});
  mockAssertNotRunning.mockReturnValue(undefined);
  mockStartJob.mockReturnValue(makeJobHandle());
  mockChat.mockResolvedValue({
    text: '<overview_prose>prose body</overview_prose>',
    usage: RESEARCH_USAGE,
  });
  mockExtractCandidates.mockResolvedValue({ usage: EXTRACT_USAGE });
});

describe('POST /api/actions/deepen/[slug] — chained extractor', () => {
  it('calls extractCandidates after research succeeds, passing the same slug and the job abort signal', async () => {
    const handle = makeJobHandle();
    mockStartJob.mockReturnValue(handle);

    await POST({ params: { slug: 'test-trip' }, url: new URL('http://x/api/actions/deepen/test-trip') });
    await new Promise((r) => setTimeout(r, 50));

    expect(mockExtractCandidates).toHaveBeenCalledTimes(1);
    expect(mockExtractCandidates).toHaveBeenCalledWith(
      'test-trip',
      expect.objectContaining({ signal: handle.controller.signal }),
    );
  });

  it('completeJob receives the SUM of research + extract token counts', async () => {
    await POST({ params: { slug: 'test-trip' }, url: new URL('http://x/api/actions/deepen/test-trip') });
    await new Promise((r) => setTimeout(r, 50));

    // 200 + 100 (research) + 80 + 40 (extract) = 420
    expect(mockCompleteJob).toHaveBeenCalledWith(
      'deepen',
      'test-trip',
      expect.objectContaining({ tokens: 420 }),
    );
    expect(mockFailJob).not.toHaveBeenCalled();
  });

  it('does NOT call extractCandidates when research fails, and calls failJob with the research error', async () => {
    mockChat.mockRejectedValue(new TraverseError('rate_limited', 'too many requests'));

    await POST({ params: { slug: 'test-trip' }, url: new URL('http://x/api/actions/deepen/test-trip') });
    await new Promise((r) => setTimeout(r, 50));

    expect(mockExtractCandidates).not.toHaveBeenCalled();
    expect(mockFailJob).toHaveBeenCalledWith(
      'deepen',
      'test-trip',
      expect.objectContaining({ code: 'rate_limited' }),
    );
    expect(mockCompleteJob).not.toHaveBeenCalled();
  });

  it('calls failJob (not completeJob) when extractCandidates fails after research succeeded', async () => {
    mockExtractCandidates.mockRejectedValue(
      new TraverseError('model_returned_invalid_yaml', 'extract-candidates: missing <extract> block'),
    );

    await POST({ params: { slug: 'test-trip' }, url: new URL('http://x/api/actions/deepen/test-trip') });
    await new Promise((r) => setTimeout(r, 50));

    // Research still ran and wrote files — those stay. But the job overall fails.
    expect(mockExtractCandidates).toHaveBeenCalledTimes(1);
    expect(mockFailJob).toHaveBeenCalledWith(
      'deepen',
      'test-trip',
      expect.objectContaining({ code: 'model_returned_invalid_yaml' }),
    );
    expect(mockCompleteJob).not.toHaveBeenCalled();
  });

  it('handles missing extract usage as 0 tokens (research tokens still counted)', async () => {
    mockExtractCandidates.mockResolvedValue({ usage: undefined });

    await POST({ params: { slug: 'test-trip' }, url: new URL('http://x/api/actions/deepen/test-trip') });
    await new Promise((r) => setTimeout(r, 50));

    // Just the research's 300 tokens.
    expect(mockCompleteJob).toHaveBeenCalledWith(
      'deepen',
      'test-trip',
      expect.objectContaining({ tokens: 300 }),
    );
  });
});

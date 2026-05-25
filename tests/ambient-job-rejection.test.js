import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Regression test for issue #264:
//   Ambient-job .then(completeJob).catch(failJob) chains can produce unhandled
//   promise rejections when completeJob or failJob itself throws (e.g. disk I/O
//   failure in clearRunningFlag → atomicWrite). Node 15+ treats unhandled
//   rejections as fatal, so a single disk hiccup during job completion was able
//   to kill the server.
//
// Fix: each handler uses the two-callback .then(onFulfilled, onRejected) form
// and wraps the inner completeJob/failJob call in try/catch so any throw inside
// those helpers cannot propagate further.
//
// These tests verify that a throw inside completeJob or failJob after a
// successful/failed background operation does NOT produce an unhandledRejection
// process event.

// ─── Shared mock state (hoisted so vi.mock factories can close over it) ──────

const { mockCompleteJob, mockFailJob } = vi.hoisted(() => ({
  mockCompleteJob: vi.fn(),
  mockFailJob: vi.fn(),
}));

const { mockAssertNotRunning, mockStartJob, mockCancelJob } = vi.hoisted(() => ({
  mockAssertNotRunning: vi.fn(),
  mockStartJob: vi.fn(),
  mockCancelJob: vi.fn(),
}));

vi.mock('$lib/server/jobs.js', () => ({
  assertNotRunning: mockAssertNotRunning,
  startJob: mockStartJob,
  completeJob: mockCompleteJob,
  failJob: mockFailJob,
  cancelJob: mockCancelJob,
}));

// fs mock: needed by deepen and deepen-section
const { mockExistsSync, mockReadFileSync, mockWriteFileSync, mockMkdirSync, mockUnlinkSync, mockRenameSync, mockStatSync } =
  vi.hoisted(() => ({
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

// data mock
vi.mock('$lib/server/data.js', () => ({
  ROOT: '/test-root',
  readHomeMd: () => '---\ntravelers: [you]\npets_need_sitter: false\n---\n',
  parseFrontmatter: vi.fn(() => ({ title: 'Test Trip', status: 'idea' })),
  parseFrontmatterFields: vi.fn(() => ({})),
  setFrontmatterField: vi.fn((c, f, v) => `${c}\n${f}: ${v}`),
  removeFrontmatterField: vi.fn((c) => c),
  invalidateEnrichCache: vi.fn(),
  rejectInvalidSlug: () => null,
  findTripLocation: vi.fn((slug) =>
    slug === 'missing-trip'
      ? null
      : { kind: 'dir', path: `/test-root/planning/${slug}`, stage: 'planning' }
  ),
}));

// AI / search / config mocks
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

// realize-plan mock (post-LLM half of the unified deepen pipeline; this
// file only cares about completeJob/failJob bookkeeping, so a no-op
// resolution is enough).
const mockRealizePlan = vi.hoisted(() => vi.fn());
vi.mock('$lib/server/realize-plan.js', () => ({
  realizePlan: mockRealizePlan,
}));

// plan.js mock (deepen consults readPlan for the re-research prose gate;
// null = no prior plan, so the gate stays out of the way).
vi.mock('$lib/server/plan.js', () => ({
  readPlan: () => null,
}));

// ─── Imports under test ───────────────────────────────────────────────────────

import { POST as deepenPost } from '../src/routes/api/actions/deepen/[slug]/+server.js';
import { POST as deepenSectionPost } from '../src/routes/api/actions/deepen-section/[slug]/[section]/+server.js';
import { TraverseError } from '../src/lib/server/errors.js';

// ─── Shared helpers ───────────────────────────────────────────────────────────

const IDEA_CONTENT =
  '---\ntitle: Test Trip\nstatus: idea\ndestination: Testville\n---\nGreat idea.';
const OVERVIEW_CONTENT =
  '---\ntitle: Test Trip\nstatus: planning\ndestination: Testville\n---\nGreat trip.';

function flushMicrotasks() {
  return new Promise((r) => setTimeout(r, 50));
}

// ─── Shared process-event capture ────────────────────────────────────────────

let unhandledRejections = [];
function onUnhandledRejection(reason) {
  unhandledRejections.push(reason);
}

beforeEach(() => {
  unhandledRejections = [];
  process.on('unhandledRejection', onUnhandledRejection);
  // resetAllMocks clears both recorded calls AND mock implementations, so a
  // mockImplementation set in one test (e.g. making completeJob throw) cannot
  // bleed into the next test. clearAllMocks only clears call history.
  vi.resetAllMocks();

  // Restore default job handle after resetAllMocks clears it.
  mockStartJob.mockReturnValue({
    workflow: 'deepen',
    slug: 'test-trip',
    startedAt: Date.now(),
    controller: new AbortController(),
    opts: {},
  });

  // Default fs state: idea file exists (deepen), trip dir + overview exist (deepen-section)
  mockExistsSync.mockImplementation((p) => {
    if (p.includes('route.md') || p.includes('logistics.md'))
      return false;
    return true; // idea file, trip dir, overview.md all exist by default
  });
  mockReadFileSync.mockReturnValue(IDEA_CONTENT);

  // Default chat: valid unified envelope that doResearch can parse.
  mockChat.mockResolvedValue({
    text: [
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
    ].join('\n'),
    usage: { input_tokens: 100, output_tokens: 50 },
  });

  // Default realize: success with no renames (keeps existing token math).
  mockRealizePlan.mockResolvedValue({ renames: [] });
});

afterEach(() => {
  process.off('unhandledRejection', onUnhandledRejection);
});

// ─── Deepen ───────────────────────────────────────────────────────────────────

describe('deepen handler', () => {
  it('does not produce unhandledRejection when completeJob throws after worker success', async () => {
    mockCompleteJob.mockImplementation(() => {
      throw new Error('ENOSPC: disk full');
    });

    await deepenPost({ params: { slug: 'test-trip' }, url: new URL('http://x/api/actions/deepen/test-trip') });
    await flushMicrotasks();

    expect(unhandledRejections).toHaveLength(0);
  });

  it('does not produce unhandledRejection when failJob throws after worker failure', async () => {
    mockChat.mockRejectedValue(new Error('network timeout'));
    mockFailJob.mockImplementation(() => {
      throw new Error('EACCES: permission denied');
    });

    await deepenPost({ params: { slug: 'test-trip' }, url: new URL('http://x/api/actions/deepen/test-trip') });
    await flushMicrotasks();

    expect(unhandledRejections).toHaveLength(0);
  });

  it('calls completeJob after a successful worker run', async () => {
    await deepenPost({ params: { slug: 'test-trip' }, url: new URL('http://x/api/actions/deepen/test-trip') });
    await flushMicrotasks();

    expect(mockCompleteJob).toHaveBeenCalledWith(
      'deepen',
      'test-trip',
      expect.objectContaining({ tokens: expect.any(Number) }),
    );
  });

  it('calls failJob (not completeJob) after a TraverseError in the worker', async () => {
    mockChat.mockRejectedValue(new TraverseError('model_error', 'bad response'));

    await deepenPost({ params: { slug: 'test-trip' }, url: new URL('http://x/api/actions/deepen/test-trip') });
    await flushMicrotasks();

    expect(mockFailJob).toHaveBeenCalledWith(
      'deepen',
      'test-trip',
      expect.objectContaining({ code: 'model_error' }),
    );
    expect(mockCompleteJob).not.toHaveBeenCalled();
  });
});

// ─── Deepen-section ───────────────────────────────────────────────────────────

describe('deepen-section handler', () => {
  beforeEach(() => {
    // Override readFileSync to return overview content for this handler
    mockReadFileSync.mockReturnValue(OVERVIEW_CONTENT);
    // Provide a section-specific chat response
    mockChat.mockResolvedValue({
      text: '<route_md>Scenic drive through rolling hills.</route_md>',
      usage: { input_tokens: 1000, output_tokens: 500 },
    });
  });

  it('does not produce unhandledRejection when completeJob throws after worker success', async () => {
    mockCompleteJob.mockImplementation(() => {
      throw new Error('ENOSPC: disk full');
    });

    await deepenSectionPost({ params: { slug: 'test-trip', section: 'route' } });
    await flushMicrotasks();

    expect(unhandledRejections).toHaveLength(0);
  });

  it('does not produce unhandledRejection when failJob throws after worker failure', async () => {
    mockChat.mockRejectedValue(new Error('network timeout'));
    mockFailJob.mockImplementation(() => {
      throw new Error('EBUSY: resource busy or locked');
    });

    await deepenSectionPost({ params: { slug: 'test-trip', section: 'route' } });
    await flushMicrotasks();

    expect(unhandledRejections).toHaveLength(0);
  });
});


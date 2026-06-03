import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- jobs mock (Ambient Background registry) ---
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

// --- enrich-job mock ---
const mockEnrichCandidatesJob = vi.hoisted(() => vi.fn());

vi.mock('$lib/server/enrich-job.js', () => ({
  enrichCandidatesJob: mockEnrichCandidatesJob,
}));

// --- stop-prep kickoff mock (auto-trigger after enrich) ---
const mockStartStopPrepJob = vi.hoisted(() => vi.fn());

vi.mock('../src/routes/api/actions/stop-prep/[slug]/+server.js', () => ({
  _startStopPrepJob: mockStartStopPrepJob,
}));

// --- data mock ---
vi.mock('$lib/server/data.js', () => ({
  rejectInvalidSlug: () => null,
}));

// --- errors mock ---
const { TraverseError } = vi.hoisted(() => {
  const TE = class extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  };
  return { TraverseError: TE };
});

vi.mock('$lib/server/errors.js', () => ({
  TraverseError,
}));

// --- promises mock ---
vi.mock('$lib/server/promises.js', () => ({
  HAND_DEFAULTS: {
    'enrich-candidates': { time_seconds: 90 },
  },
}));

// --- abort utils mock ---
vi.mock('$lib/utils/abort.js', () => ({
  isAbort: (err) => err instanceof DOMException && err.name === 'AbortError',
}));

// --- rate-limit mock ---
vi.mock('$lib/server/rate-limit.js', () => ({
  rateLimitResponse: () => null,
}));

// --- config mock ---
vi.mock('$lib/server/config.js', () => ({
  getFeatureAvailability: () => ({ homeMdReady: true }),
}));

import { _startEnrichCandidatesJob } from '../src/routes/api/actions/enrich-candidates/[slug]/+server.js';

// A fake job handle with an AbortController — mirrors what startJob() returns.
function makeJobHandle() {
  const controller = new AbortController();
  return { workflow: 'enrich-candidates', slug: 'test-trip', startedAt: Date.now(), controller, opts: {} };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: assertNotRunning does nothing (not running)
  mockAssertNotRunning.mockReturnValue(undefined);
  // Default: startJob returns a handle
  mockStartJob.mockReturnValue(makeJobHandle());
  // Default: enrich job succeeds
  mockEnrichCandidatesJob.mockResolvedValue({ enriched: 1, attempted: 1, failed: 0, skipped: 0, tokens: 10 });
  // Default: completeJob succeeds
  mockCompleteJob.mockReturnValue(undefined);
  // Reset stop-prep kickoff mock
  mockStartStopPrepJob.mockReset();
  mockStartStopPrepJob.mockReturnValue(null);
});

describe('_startEnrichCandidatesJob chain (stop-prep auto-trigger)', () => {
  it('fires _startEnrichCandidatesJob and kicks off the inner async IIFE', () => {
    const job = _startEnrichCandidatesJob('test-trip');
    expect(job).not.toBeNull();
    expect(mockStartJob).toHaveBeenCalledWith(
      'enrich-candidates',
      'test-trip',
      expect.objectContaining({ est_seconds: expect.any(Number) })
    );
  });

  it('after enrichCandidatesJob succeeds and completeJob is called, fires _startStopPrepJob', async () => {
    mockEnrichCandidatesJob.mockResolvedValue({ enriched: 1, attempted: 1, failed: 0, skipped: 0, tokens: 10 });

    _startEnrichCandidatesJob('test-trip');
    // Give the async IIFE time to run
    await new Promise(r => setTimeout(r, 50));

    // completeJob should have been called
    expect(mockCompleteJob).toHaveBeenCalledWith('enrich-candidates', 'test-trip', expect.objectContaining({ tokens: 10 }));
    // stop-prep kickoff should have been called
    expect(mockStartStopPrepJob).toHaveBeenCalledWith('test-trip');
  });

  it('does NOT fire _startStopPrepJob when enrichCandidatesJob throws', async () => {
    mockEnrichCandidatesJob.mockRejectedValue(new Error('enrichment failed'));

    _startEnrichCandidatesJob('test-trip');
    // Give the async IIFE time to run and fail
    await new Promise(r => setTimeout(r, 50));

    // failJob should have been called instead of completeJob
    expect(mockFailJob).toHaveBeenCalled();
    // stop-prep should NOT have been called
    expect(mockStartStopPrepJob).not.toHaveBeenCalled();
  });

  it('does NOT fire _startStopPrepJob when enrichCandidatesJob is aborted', async () => {
    // Simulate the case where the enrich job is aborted
    const abortErr = new DOMException('Aborted', 'AbortError');
    mockEnrichCandidatesJob.mockRejectedValue(abortErr);

    _startEnrichCandidatesJob('test-trip');
    // Give the async IIFE time to run
    await new Promise(r => setTimeout(r, 50));

    // When aborted, failJob is never called (it returns early), and stop-prep should not fire
    expect(mockCompleteJob).not.toHaveBeenCalled();
    // stop-prep should NOT have been called on abort
    expect(mockStartStopPrepJob).not.toHaveBeenCalled();
  });

  it('still fires _startStopPrepJob even when completeJob throws', async () => {
    // completeJob throws a disk error; the chain should still proceed.
    mockEnrichCandidatesJob.mockResolvedValue({ enriched: 1, attempted: 1, failed: 0, skipped: 0, tokens: 10 });
    mockCompleteJob.mockImplementationOnce(() => {
      throw new Error('disk write failed');
    });

    _startEnrichCandidatesJob('test-trip');
    await new Promise(r => setTimeout(r, 50));

    // completeJob was attempted
    expect(mockCompleteJob).toHaveBeenCalledWith('enrich-candidates', 'test-trip', expect.objectContaining({ tokens: 10 }));
    // stop-prep SHOULD still have been kicked off despite completeJob throwing
    expect(mockStartStopPrepJob).toHaveBeenCalledWith('test-trip');
  });
});

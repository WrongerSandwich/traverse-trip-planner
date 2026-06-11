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

// --- geocode-job mock ---
const mockGeocodeCandidatesJob = vi.hoisted(() => vi.fn());

vi.mock('$lib/server/geocode-job.js', () => ({
  geocodeCandidatesJob: mockGeocodeCandidatesJob,
}));

// --- enrich-candidates kickoff mock (Task 9: auto-trigger after geocode) ---
const mockStartEnrichCandidatesJob = vi.hoisted(() => vi.fn());

vi.mock('../src/routes/api/actions/enrich-candidates/[slug]/+server.js', () => ({
  _startEnrichCandidatesJob: mockStartEnrichCandidatesJob,
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
    'geocode-candidates': { time_seconds: 30 },
  },
}));

// --- abort utils mock ---
vi.mock('$lib/utils/abort.js', () => ({
  isAbort: (err) => err instanceof DOMException && err.name === 'AbortError',
}));

import { _startGeocodeCandidatesJob } from '../src/routes/api/actions/geocode-candidates/[slug]/+server.js';

// A fake job handle with an AbortController — mirrors what startJob() returns.
function makeJobHandle() {
  const controller = new AbortController();
  return { workflow: 'geocode-candidates', slug: 'test-trip', startedAt: Date.now(), controller, opts: {} };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: assertNotRunning does nothing (not running)
  mockAssertNotRunning.mockReturnValue(undefined);
  // Default: startJob returns a handle
  mockStartJob.mockReturnValue(makeJobHandle());
  // Default: geocode job succeeds
  mockGeocodeCandidatesJob.mockResolvedValue(undefined);
  // Default: completeJob succeeds
  mockCompleteJob.mockReturnValue(undefined);
  // Reset enrich-candidates kickoff mock
  mockStartEnrichCandidatesJob.mockReset();
  mockStartEnrichCandidatesJob.mockReturnValue(null);
});

describe('_startGeocodeCandidatesJob chain (Task 9: #403)', () => {
  it('fires _startGeocodeCandidatesJob and kicks off the inner async IIFE', () => {
    const job = _startGeocodeCandidatesJob('test-trip');
    expect(job).not.toBeNull();
    expect(mockStartJob).toHaveBeenCalledWith(
      'geocode-candidates',
      'test-trip',
      expect.objectContaining({ est_seconds: expect.any(Number) })
    );
  });

  it('after geocodeCandidatesJob succeeds and completeJob is called, fires _startEnrichCandidatesJob', async () => {
    mockGeocodeCandidatesJob.mockResolvedValue(undefined);

    _startGeocodeCandidatesJob('test-trip');
    // Give the async IIFE time to run
    await new Promise(r => setTimeout(r, 50));

    // completeJob should have been called (no partial failures → empty result)
    expect(mockCompleteJob).toHaveBeenCalledWith('geocode-candidates', 'test-trip', {});
    // enrich-candidates kickoff should have been called
    expect(mockStartEnrichCandidatesJob).toHaveBeenCalledWith('test-trip');
  });

  it('threads partial-failure counts from the job summary into completeJob (#488)', async () => {
    // The job can complete with swallowed partial failures (some stops couldn't
    // be pinned / addressed). The endpoint must forward that count so the
    // detail banner can note it rather than the data silently looking complete.
    mockGeocodeCandidatesJob.mockResolvedValue({ geocodeFailures: 2, reverseFailures: 1 });

    _startGeocodeCandidatesJob('test-trip');
    await new Promise(r => setTimeout(r, 50));

    expect(mockCompleteJob).toHaveBeenCalledWith('geocode-candidates', 'test-trip', { partial_failures: 3 });
  });

  it('does NOT fire _startEnrichCandidatesJob when geocodeCandidatesJob throws', async () => {
    mockGeocodeCandidatesJob.mockRejectedValue(new Error('geocoding failed'));

    _startGeocodeCandidatesJob('test-trip');
    // Give the async IIFE time to run and fail
    await new Promise(r => setTimeout(r, 50));

    // failJob should have been called instead of completeJob
    expect(mockFailJob).toHaveBeenCalled();
    // enrich-candidates should NOT have been called
    expect(mockStartEnrichCandidatesJob).not.toHaveBeenCalled();
  });

  it('does NOT fire _startEnrichCandidatesJob when geocodeCandidatesJob is aborted', async () => {
    // Simulate the case where the geocode job is aborted
    const abortErr = new DOMException('Aborted', 'AbortError');
    mockGeocodeCandidatesJob.mockRejectedValue(abortErr);

    _startGeocodeCandidatesJob('test-trip');
    // Give the async IIFE time to run
    await new Promise(r => setTimeout(r, 50));

    // When aborted, failJob is never called (it returns early), and enrich should not fire
    // Note: The completeJob mock was not called either since the error was thrown
    expect(mockCompleteJob).not.toHaveBeenCalled();
    // enrich-candidates should NOT have been called on abort
    expect(mockStartEnrichCandidatesJob).not.toHaveBeenCalled();
  });

  it('still fires _startEnrichCandidatesJob even when completeJob throws (Fix 1 — #403)', async () => {
    // completeJob throws a disk error; the chain should still proceed.
    mockGeocodeCandidatesJob.mockResolvedValue(undefined);
    mockCompleteJob.mockImplementationOnce(() => {
      throw new Error('disk write failed');
    });

    _startGeocodeCandidatesJob('test-trip');
    await new Promise(r => setTimeout(r, 50));

    // completeJob was attempted
    expect(mockCompleteJob).toHaveBeenCalledWith('geocode-candidates', 'test-trip', {});
    // enrich-candidates SHOULD still have been kicked off despite completeJob throwing
    expect(mockStartEnrichCandidatesJob).toHaveBeenCalledWith('test-trip');
  });
});

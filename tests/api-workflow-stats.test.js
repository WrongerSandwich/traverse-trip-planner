import { describe, it, expect, vi, beforeEach } from 'vitest';

// Stub @sveltejs/kit's json() to return a plain object we can inspect.
vi.mock('@sveltejs/kit', () => ({
  json: (body, init = {}) => ({ _body: body, _status: init.status ?? 200 }),
}));

// Mock the workflow-stats module so the endpoint test doesn't touch the
// real on-disk file. We control exactly what `getAllStats()` returns.
vi.mock('$lib/server/workflow-stats.js', () => ({
  getAllStats: vi.fn(),
  MAX_SAMPLES_PER_LABEL: 50,
  STALE_WINDOW_MS: 14 * 24 * 60 * 60 * 1000,
  MIN_SAMPLES: 10,
  DRIFT_RATIO: 2,
}));

import { getAllStats } from '$lib/server/workflow-stats.js';
import { GET } from '../src/routes/api/workflow-stats/+server.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/workflow-stats', () => {
  it('returns the aggregated stats and config constants', () => {
    getAllStats.mockReturnValue({
      seed: {
        sample_count: 12,
        window_start: 1000,
        window_end: 2000,
        p10_seconds: 15,
        p50_seconds: 18,
        p90_seconds: 25,
        p10_tokens: 1500,
        p50_tokens: 2000,
        p90_tokens: 2800,
      },
    });
    const res = GET();
    expect(res._status).toBe(200);
    expect(res._body.stats.seed.p50_seconds).toBe(18);
    expect(res._body.config.min_samples).toBe(10);
    expect(res._body.config.drift_ratio).toBe(2);
    expect(res._body.config.max_samples_per_label).toBe(50);
    expect(res._body.config.stale_window_ms).toBe(14 * 24 * 60 * 60 * 1000);
  });

  it('returns an empty stats object when nothing has been recorded', () => {
    getAllStats.mockReturnValue({});
    const res = GET();
    expect(res._status).toBe(200);
    expect(res._body.stats).toEqual({});
  });
});

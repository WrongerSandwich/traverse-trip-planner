import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  derivePillState,
  diffJobs,
  createJobsClient,
} from '../src/lib/utils/jobs-store.js';

// ─── derivePillState — pure state-machine helper ─────────────────────────────

describe('derivePillState', () => {
  it('returns hidden when there are no jobs and no live failures', () => {
    const result = derivePillState({
      jobs: [],
      failures: [],
      dismissedKeys: new Set(),
    });
    expect(result.variant).toBe('hidden');
    expect(result.count).toBe(0);
  });

  it('returns running (amber) with job count when ≥1 job is in flight', () => {
    const result = derivePillState({
      jobs: [
        { workflow: 'brochure', slug: 'hannibal-twain', startedAt: Date.now() },
        { workflow: 'deepen', slug: 'marfa-tx', startedAt: Date.now() },
      ],
      failures: [],
      dismissedKeys: new Set(),
    });
    expect(result.variant).toBe('running');
    expect(result.count).toBe(2);
  });

  it('returns failed (red, sticky) when ≥1 failure since last clear', () => {
    const result = derivePillState({
      jobs: [],
      failures: [{ workflow: 'brochure', slug: 'hannibal-twain', code: 'provider_error' }],
      dismissedKeys: new Set(),
    });
    expect(result.variant).toBe('failed');
    expect(result.count).toBe(1);
  });

  it('prefers running variant when both running and failures present', () => {
    const result = derivePillState({
      jobs: [{ workflow: 'brochure', slug: 'a', startedAt: Date.now() }],
      failures: [{ workflow: 'deepen', slug: 'b', code: 'timeout' }],
      dismissedKeys: new Set(),
    });
    expect(result.variant).toBe('running');
    expect(result.count).toBe(1);
  });

  it('ignores failures whose key has been dismissed', () => {
    const result = derivePillState({
      jobs: [],
      failures: [{ workflow: 'brochure', slug: 'hannibal-twain', code: 'provider_error' }],
      dismissedKeys: new Set(['brochure:hannibal-twain']),
    });
    expect(result.variant).toBe('hidden');
    expect(result.count).toBe(0);
  });

  it('counts only undismissed failures', () => {
    const result = derivePillState({
      jobs: [],
      failures: [
        { workflow: 'brochure', slug: 'a', code: 'provider_error' },
        { workflow: 'deepen', slug: 'b', code: 'timeout' },
      ],
      dismissedKeys: new Set(['brochure:a']),
    });
    expect(result.variant).toBe('failed');
    expect(result.count).toBe(1);
  });
});

// ─── diffJobs — detect started/completed/failed transitions ──────────────────

describe('diffJobs', () => {
  it('returns empty arrays when nothing changed', () => {
    const prev = [{ workflow: 'brochure', slug: 'a', startedAt: 1 }];
    const next = [{ workflow: 'brochure', slug: 'a', startedAt: 1 }];
    const recent = [];
    const result = diffJobs(prev, next, recent);
    expect(result.started).toEqual([]);
    expect(result.completed).toEqual([]);
    expect(result.failed).toEqual([]);
  });

  it('detects newly started jobs', () => {
    const prev = [];
    const next = [{ workflow: 'brochure', slug: 'a', startedAt: 1 }];
    const result = diffJobs(prev, next, []);
    expect(result.started).toHaveLength(1);
    expect(result.started[0].slug).toBe('a');
  });

  it('classifies disappeared jobs by matching against recent event log', () => {
    const prev = [
      { workflow: 'brochure', slug: 'a', startedAt: 1 },
      { workflow: 'deepen', slug: 'b', startedAt: 2 },
    ];
    const next = [];
    const recent = [
      { workflow: 'brochure', slug: 'a', outcome: 'success', tokens: 3200, at: 100 },
      { workflow: 'deepen', slug: 'b', outcome: 'failure', code: 'provider_error', at: 110 },
    ];
    const result = diffJobs(prev, next, recent);
    expect(result.completed).toHaveLength(1);
    expect(result.completed[0].slug).toBe('a');
    expect(result.completed[0].tokens).toBe(3200);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].slug).toBe('b');
    expect(result.failed[0].code).toBe('provider_error');
  });

  it('treats disappeared jobs without a matching event as failed-unknown', () => {
    // Defensive: if a job vanishes but no event arrived (e.g. server restart),
    // we surface it as a failure with code `unknown` so the user is not left
    // wondering.
    const prev = [{ workflow: 'brochure', slug: 'a', startedAt: 1 }];
    const next = [];
    const result = diffJobs(prev, next, []);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].code).toBe('unknown');
  });
});

// ─── createJobsClient — polling + cancel + lifecycle ─────────────────────────

describe('createJobsClient', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function makeFetchMock(responses) {
    // Each call returns the next scripted response in order; once exhausted,
    // returns an empty snapshot.
    let i = 0;
    return vi.fn(async (url, init) => {
      const body = responses[i++] || { jobs: [], recent: [] };
      return {
        ok: true,
        status: 200,
        json: async () => body,
        url,
        init,
      };
    });
  }

  it('fetches /api/jobs on start() and exposes the snapshot', async () => {
    const fetchMock = makeFetchMock([
      { jobs: [{ workflow: 'brochure', slug: 'a', startedAt: 1, title: 'A trip' }], recent: [] },
    ]);
    const client = createJobsClient({ fetch: fetchMock, pollIntervalMs: 10000 });
    await client.refresh();
    expect(fetchMock).toHaveBeenCalledWith('/api/jobs', expect.any(Object));
    const state = client.getState();
    expect(state.jobs).toHaveLength(1);
    expect(state.jobs[0].title).toBe('A trip');
  });

  it('polls every pollIntervalMs while started', async () => {
    const fetchMock = makeFetchMock([
      { jobs: [], recent: [] },
      { jobs: [], recent: [] },
      { jobs: [], recent: [] },
    ]);
    const client = createJobsClient({ fetch: fetchMock, pollIntervalMs: 10000 });
    client.start();
    await vi.advanceTimersByTimeAsync(0); // initial fetch
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(10000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    client.stop();
  });

  it('stop() cancels the interval', async () => {
    const fetchMock = makeFetchMock([
      { jobs: [], recent: [] },
      { jobs: [], recent: [] },
    ]);
    const client = createJobsClient({ fetch: fetchMock, pollIntervalMs: 10000 });
    client.start();
    await vi.advanceTimersByTimeAsync(0);
    client.stop();
    await vi.advanceTimersByTimeAsync(60000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('records failures into state when a job disappears with failure event', async () => {
    const fetchMock = makeFetchMock([
      { jobs: [{ workflow: 'brochure', slug: 'a', startedAt: 1, title: 'A' }], recent: [] },
      { jobs: [], recent: [{ workflow: 'brochure', slug: 'a', outcome: 'failure', code: 'provider_error', at: Date.now() }] },
    ]);
    const client = createJobsClient({ fetch: fetchMock, pollIntervalMs: 10000 });
    await client.refresh();
    expect(client.getState().failures).toHaveLength(0);
    await client.refresh();
    const state = client.getState();
    expect(state.failures).toHaveLength(1);
    expect(state.failures[0].code).toBe('provider_error');
  });

  it('records successes into state when a job completes', async () => {
    const fetchMock = makeFetchMock([
      { jobs: [{ workflow: 'brochure', slug: 'a', startedAt: 1, title: 'A' }], recent: [] },
      { jobs: [], recent: [{ workflow: 'brochure', slug: 'a', outcome: 'success', tokens: 3200, at: Date.now() }] },
    ]);
    const client = createJobsClient({ fetch: fetchMock, pollIntervalMs: 10000 });
    await client.refresh();
    await client.refresh();
    const state = client.getState();
    expect(state.successes).toHaveLength(1);
    expect(state.successes[0].slug).toBe('a');
    expect(state.successes[0].tokens).toBe(3200);
  });

  it('dismissFailure removes the failure from the pill count via dismissedKeys', async () => {
    const fetchMock = makeFetchMock([
      { jobs: [{ workflow: 'brochure', slug: 'a', startedAt: 1, title: 'A' }], recent: [] },
      { jobs: [], recent: [{ workflow: 'brochure', slug: 'a', outcome: 'failure', code: 'provider_error', at: Date.now() }] },
    ]);
    const client = createJobsClient({ fetch: fetchMock, pollIntervalMs: 10000 });
    await client.refresh();
    await client.refresh();
    expect(client.getPillState().variant).toBe('failed');

    client.dismissFailure('brochure:a');
    expect(client.getPillState().variant).toBe('hidden');
  });

  it('dismissSuccess removes the success toast from the state', async () => {
    const fetchMock = makeFetchMock([
      { jobs: [{ workflow: 'brochure', slug: 'a', startedAt: 1, title: 'A' }], recent: [] },
      { jobs: [], recent: [{ workflow: 'brochure', slug: 'a', outcome: 'success', tokens: 3200, at: Date.now() }] },
    ]);
    const client = createJobsClient({ fetch: fetchMock, pollIntervalMs: 10000 });
    await client.refresh();
    await client.refresh();
    expect(client.getState().successes).toHaveLength(1);

    client.dismissSuccess('brochure:a');
    expect(client.getState().successes).toHaveLength(0);
  });

  it('cancel() POSTs to /api/jobs/cancel with the workflow + slug', async () => {
    const fetchMock = makeFetchMock([
      { jobs: [], recent: [] },
      { jobs: [], recent: [] },
    ]);
    const client = createJobsClient({ fetch: fetchMock, pollIntervalMs: 10000 });
    await client.cancel('brochure', 'hannibal-twain');

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/jobs/cancel',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ workflow: 'brochure', slug: 'hannibal-twain' }),
      }),
    );
  });

  it('subscribe notifies on state changes and returns an unsubscriber', async () => {
    const fetchMock = makeFetchMock([
      { jobs: [{ workflow: 'brochure', slug: 'a', startedAt: 1, title: 'A' }], recent: [] },
    ]);
    const client = createJobsClient({ fetch: fetchMock, pollIntervalMs: 10000 });
    const updates = [];
    const unsub = client.subscribe((s) => updates.push(s.jobs.length));
    await client.refresh();
    expect(updates[updates.length - 1]).toBe(1);
    unsub();
    await client.refresh();
    // Last update count unchanged after unsub
    expect(updates[updates.length - 1]).toBe(1);
  });

  it('autoCloseDrawerWhenIdle: closes the drawer when there are no more jobs', async () => {
    const fetchMock = makeFetchMock([
      { jobs: [{ workflow: 'brochure', slug: 'a', startedAt: 1, title: 'A' }], recent: [] },
      { jobs: [], recent: [{ workflow: 'brochure', slug: 'a', outcome: 'success', tokens: 1000, at: Date.now() }] },
    ]);
    const client = createJobsClient({ fetch: fetchMock, pollIntervalMs: 10000 });
    await client.refresh();
    client.openDrawer();
    expect(client.getState().drawerOpen).toBe(true);
    await client.refresh();
    expect(client.getState().drawerOpen).toBe(false);
  });

  it('successes auto-expire after 6 seconds via pruneStale()', async () => {
    const fetchMock = makeFetchMock([
      { jobs: [{ workflow: 'brochure', slug: 'a', startedAt: 1, title: 'A' }], recent: [] },
      { jobs: [], recent: [{ workflow: 'brochure', slug: 'a', outcome: 'success', tokens: 1000, at: Date.now() }] },
    ]);
    const client = createJobsClient({ fetch: fetchMock, pollIntervalMs: 10000, successTtlMs: 6000 });
    await client.refresh();
    await client.refresh();
    expect(client.getState().successes).toHaveLength(1);
    // Simulate clock advance and call pruneStale
    const originalNow = Date.now;
    try {
      Date.now = () => originalNow() + 7000;
      client.pruneStale();
      expect(client.getState().successes).toHaveLength(0);
    } finally {
      Date.now = originalNow;
    }
  });
});

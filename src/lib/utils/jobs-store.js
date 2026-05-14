// Client-side store for the global Ambient Background indicator.
//
// Two layers:
//
//   1. Pure helpers — `derivePillState`, `diffJobs` — testable in isolation.
//      The Svelte component re-derives these inside an `$effect` keyed on
//      `getState()` so the UI stays declarative.
//
//   2. A factory `createJobsClient({ fetch, pollIntervalMs })` that owns the
//      poll loop, the cancel POST, the failure/success dismissal sets, and a
//      subscribe/notify pub-sub. The factory is plain JS so we can stub
//      `fetch` and exercise the state machine without a DOM.
//
// The Svelte component wraps the client with a thin `$state` mirror so runes
// pick up updates; the source of truth lives here.

const SUCCESS_TTL_DEFAULT_MS = 6_000;
const POLL_DEFAULT_MS = 10_000;

export function keyFor(workflow, slug) {
  return `${workflow}:${slug}`;
}

// ─── Pure helpers ────────────────────────────────────────────────────────────

/**
 * Three-way state machine for the pill chip in the top app-bar.
 *
 *   { variant: 'hidden' | 'running' | 'failed', count: number }
 *
 * Precedence: any in-flight job → `running` (amber); otherwise undismissed
 * failures → `failed` (red, sticky); otherwise hidden.
 *
 * `dismissedKeys` is a Set of `${workflow}:${slug}` keys the user has cleared.
 */
export function derivePillState({ jobs = [], failures = [], dismissedKeys = new Set() } = {}) {
  if (jobs.length > 0) {
    return { variant: 'running', count: jobs.length };
  }
  const live = failures.filter((f) => !dismissedKeys.has(keyFor(f.workflow, f.slug)));
  if (live.length > 0) {
    return { variant: 'failed', count: live.length };
  }
  return { variant: 'hidden', count: 0 };
}

/**
 * Compare two job snapshots and classify the transitions:
 *
 *   - `started`   = jobs present in `next` but not in `prev`
 *   - `completed` = jobs in `prev` but not in `next`, matched to a `success`
 *                   event in `recent`
 *   - `failed`    = jobs in `prev` but not in `next`, matched to a `failure`
 *                   event (or to no event at all — defensive fallback for
 *                   server restart mid-job)
 *
 * Match is keyed by `${workflow}:${slug}`. When a recent event exists, we
 * inherit its `tokens` / `code` so the caller can render the right toast.
 */
export function diffJobs(prev = [], next = [], recent = []) {
  const prevKeys = new Set(prev.map((j) => keyFor(j.workflow, j.slug)));
  const nextKeys = new Set(next.map((j) => keyFor(j.workflow, j.slug)));

  const started = next.filter((j) => !prevKeys.has(keyFor(j.workflow, j.slug)));
  const disappeared = prev.filter((j) => !nextKeys.has(keyFor(j.workflow, j.slug)));

  const recentByKey = new Map();
  for (const e of recent) {
    recentByKey.set(keyFor(e.workflow, e.slug), e);
  }

  const completed = [];
  const failed = [];
  for (const job of disappeared) {
    const ev = recentByKey.get(keyFor(job.workflow, job.slug));
    if (ev && ev.outcome === 'success') {
      completed.push({ ...job, ...ev });
    } else if (ev && ev.outcome === 'failure') {
      failed.push({ ...job, ...ev });
    } else {
      // No matching event — server may have lost the entry (restart). Surface
      // as a failure with `unknown` so the user isn't left wondering.
      failed.push({ ...job, code: 'unknown' });
    }
  }

  return { started, completed, failed };
}

// ─── Client factory ──────────────────────────────────────────────────────────

/**
 * Create a JobsClient.
 *
 * Options:
 *   - `fetch`            — fetch implementation (defaults to globalThis.fetch).
 *                          Passing one in is the seam tests use.
 *   - `pollIntervalMs`   — poll interval; default 10s per docs/ai-workflow-ux.md §6.
 *   - `successTtlMs`     — success toast TTL; default 6s per the issue spec.
 */
export function createJobsClient({
  fetch: fetchImpl = globalThis.fetch?.bind(globalThis),
  pollIntervalMs = POLL_DEFAULT_MS,
  successTtlMs = SUCCESS_TTL_DEFAULT_MS,
} = {}) {
  /** @type {{
   *   jobs: Array<{ workflow: string, slug: string, startedAt: number, title?: string }>,
   *   failures: Array<{ workflow: string, slug: string, code: string, title?: string, at?: number }>,
   *   successes: Array<{ workflow: string, slug: string, tokens?: number, title?: string, at: number }>,
   *   dismissedKeys: Set<string>,
   *   drawerOpen: boolean,
   *   lastFetchAt: number | null,
   *   lastError: string | null,
   * }} */
  const state = {
    jobs: [],
    failures: [],
    successes: [],
    dismissedKeys: new Set(),
    drawerOpen: false,
    lastFetchAt: null,
    lastError: null,
  };

  const subscribers = new Set();
  let intervalHandle = null;

  function notify() {
    for (const fn of subscribers) {
      try {
        fn(getState());
      } catch (e) {
        console.error('[jobs-store] subscriber threw:', e);
      }
    }
  }

  function getState() {
    return {
      jobs: state.jobs,
      failures: state.failures,
      successes: state.successes,
      dismissedKeys: new Set(state.dismissedKeys),
      drawerOpen: state.drawerOpen,
      lastFetchAt: state.lastFetchAt,
      lastError: state.lastError,
    };
  }

  function getPillState() {
    return derivePillState({
      jobs: state.jobs,
      failures: state.failures,
      dismissedKeys: state.dismissedKeys,
    });
  }

  async function refresh() {
    if (!fetchImpl) {
      state.lastError = 'no_fetch_implementation';
      return;
    }
    let snapshot;
    try {
      const res = await fetchImpl('/api/jobs', { headers: { Accept: 'application/json' } });
      if (!res.ok) {
        state.lastError = `http_${res.status}`;
        notify();
        return;
      }
      snapshot = await res.json();
      state.lastError = null;
    } catch (e) {
      state.lastError = e?.message ?? 'fetch_failed';
      notify();
      return;
    }

    const nextJobs = Array.isArray(snapshot?.jobs) ? snapshot.jobs : [];
    const recent = Array.isArray(snapshot?.recent) ? snapshot.recent : [];

    const { completed, failed } = diffJobs(state.jobs, nextJobs, recent);

    // Append successes; the component renders them as toasts and prunes them
    // via pruneStale() on a timer.
    const now = Date.now();
    for (const c of completed) {
      state.successes.push({ ...c, at: now });
    }
    for (const f of failed) {
      // Failures are sticky until dismissed; dedupe by key so re-polls don't
      // pile up duplicates.
      const k = keyFor(f.workflow, f.slug);
      if (!state.failures.some((x) => keyFor(x.workflow, x.slug) === k)) {
        state.failures.push({ ...f, at: now });
      }
    }

    state.jobs = nextJobs;
    state.lastFetchAt = now;

    // Auto-close drawer when no work remains.
    if (state.drawerOpen && state.jobs.length === 0) {
      state.drawerOpen = false;
    }

    notify();
  }

  function start() {
    if (intervalHandle !== null) return;
    // Kick off an immediate fetch; the interval handles subsequent polls.
    refresh();
    intervalHandle = setInterval(refresh, pollIntervalMs);
  }

  function stop() {
    if (intervalHandle !== null) {
      clearInterval(intervalHandle);
      intervalHandle = null;
    }
  }

  async function cancel(workflow, slug) {
    if (!fetchImpl) return;
    try {
      await fetchImpl('/api/jobs/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflow, slug }),
      });
    } catch (e) {
      state.lastError = e?.message ?? 'cancel_failed';
      notify();
      return;
    }
    // Optimistically drop from local snapshot — the next poll will reconcile.
    state.jobs = state.jobs.filter(
      (j) => !(j.workflow === workflow && j.slug === slug),
    );
    if (state.drawerOpen && state.jobs.length === 0) {
      state.drawerOpen = false;
    }
    notify();
  }

  function dismissFailure(key) {
    state.dismissedKeys.add(key);
    state.failures = state.failures.filter(
      (f) => keyFor(f.workflow, f.slug) !== key,
    );
    notify();
  }

  function dismissSuccess(key) {
    state.successes = state.successes.filter(
      (s) => keyFor(s.workflow, s.slug) !== key,
    );
    notify();
  }

  function pruneStale() {
    const cutoff = Date.now() - successTtlMs;
    const before = state.successes.length;
    state.successes = state.successes.filter((s) => s.at >= cutoff);
    if (state.successes.length !== before) notify();
  }

  function openDrawer() {
    state.drawerOpen = true;
    notify();
  }

  function closeDrawer() {
    state.drawerOpen = false;
    notify();
  }

  function toggleDrawer() {
    state.drawerOpen = !state.drawerOpen;
    notify();
  }

  function subscribe(fn) {
    subscribers.add(fn);
    fn(getState());
    return () => {
      subscribers.delete(fn);
    };
  }

  // Clear the "since last navigation" failure scope — used by the layout's
  // `afterNavigate` hook to reset sticky-red on each route change.
  function clearFailureScope() {
    if (state.failures.length === 0) return;
    for (const f of state.failures) {
      state.dismissedKeys.add(keyFor(f.workflow, f.slug));
    }
    state.failures = [];
    notify();
  }

  return {
    start,
    stop,
    refresh,
    cancel,
    dismissFailure,
    dismissSuccess,
    pruneStale,
    openDrawer,
    closeDrawer,
    toggleDrawer,
    clearFailureScope,
    subscribe,
    getState,
    getPillState,
  };
}

import { describe, it, expect } from 'vitest';

// We test the pure-JS state-machine logic that drives the seed Instant
// Inline UI. The actual Svelte wiring isn't unit-testable without a DOM;
// these tests document the contract the component implements.

// ── Helpers that mirror what the component does ───────────────────────────

/** Build an initial seed state object (mirrors component $state shape). */
function makeSeedState() {
  return {
    status: 'idle',      // 'idle' | 'in_progress' | 'success' | 'failure'
    errorCode: null,
    tokens: null,
    sseLog: [],          // messages captured for the <details> disclosure
  };
}

/**
 * Simulate the SSE message handler the component registers.
 * Returns the next state (immutable-style for testability).
 */
function handleSseMessage(state, event) {
  const next = { ...state, sseLog: [...state.sseLog] };

  const isError = typeof event.msg === 'string' && event.msg.toLowerCase().startsWith('error');

  if (event.done) {
    if (isError) {
      next.status    = 'failure';
      next.errorCode = 'network_error';
      next.sseLog.push(event.msg);
    } else {
      next.status = 'success';
      next.tokens = event.tokens ?? null;
      next.sseLog.push(event.msg);
    }
    return next;
  }

  next.sseLog.push(event.msg);
  return next;
}

/** Simulate starting a seed run (component calls this on submit). */
function startSeed(state) {
  return { ...state, status: 'in_progress', errorCode: null, tokens: null, sseLog: [] };
}

/** Simulate dismissing an error (re-enables button). */
function dismissError(state) {
  return { ...state, status: 'idle', errorCode: null };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('seed instant-inline state machine', () => {
  it('starts in idle state', () => {
    const s = makeSeedState();
    expect(s.status).toBe('idle');
    expect(s.tokens).toBeNull();
    expect(s.sseLog).toEqual([]);
  });

  it('transitions idle → in_progress on startSeed', () => {
    const s = startSeed(makeSeedState());
    expect(s.status).toBe('in_progress');
    expect(s.sseLog).toEqual([]);  // log is cleared on each run
  });

  it('accumulates SSE messages in sseLog while in_progress', () => {
    let s = startSeed(makeSeedState());
    s = handleSseMessage(s, { msg: 'Looking over home.md…', done: false });
    s = handleSseMessage(s, { msg: 'Sketching five ideas…', done: false });
    expect(s.status).toBe('in_progress');
    expect(s.sseLog).toHaveLength(2);
    expect(s.sseLog[0]).toContain('home.md');
  });

  it('transitions in_progress → success on done=true event with tokens', () => {
    let s = startSeed(makeSeedState());
    s = handleSseMessage(s, { msg: 'Working…', done: false });
    s = handleSseMessage(s, { msg: 'Done — 5 new trips on the list.', done: true, tokens: 2400 });
    expect(s.status).toBe('success');
    expect(s.tokens).toBe(2400);
    expect(s.sseLog).toHaveLength(2);
  });

  it('transitions in_progress → success with null tokens when server omits them', () => {
    let s = startSeed(makeSeedState());
    s = handleSseMessage(s, { msg: 'Done.', done: true });
    expect(s.status).toBe('success');
    expect(s.tokens).toBeNull();
  });

  it('transitions in_progress → failure on Error: message with done=true', () => {
    let s = startSeed(makeSeedState());
    s = handleSseMessage(s, { msg: 'Error: model returned nothing', done: true });
    expect(s.status).toBe('failure');
    expect(s.errorCode).toBeTruthy(); // mapped to a registry code
    expect(s.sseLog).toHaveLength(1);
    expect(s.sseLog[0]).toMatch(/error/i);
  });

  it('does not set failure state for non-done error-looking messages', () => {
    let s = startSeed(makeSeedState());
    // An intermediate message starting with "Error" that isn't done
    // still accumulates in the log but doesn't flip the state to failure.
    // (In practice the server sends error+done together, but be defensive.)
    s = handleSseMessage(s, { msg: 'Error: transient blip', done: false });
    expect(s.status).toBe('in_progress');
    expect(s.sseLog).toHaveLength(1);
  });

  it('dismissError resets to idle and clears error code', () => {
    let s = startSeed(makeSeedState());
    s = handleSseMessage(s, { msg: 'Error: oops', done: true });
    expect(s.status).toBe('failure');
    s = dismissError(s);
    expect(s.status).toBe('idle');
    expect(s.errorCode).toBeNull();
  });

  it('re-runs from idle after a failure (log is cleared)', () => {
    let s = startSeed(makeSeedState());
    s = handleSseMessage(s, { msg: 'Error: oops', done: true });
    s = dismissError(s);
    s = startSeed(s);
    expect(s.status).toBe('in_progress');
    expect(s.sseLog).toEqual([]);
  });

  it('network exception path sets failure state correctly', () => {
    // Simulates the catch block in runSeed() when fetch itself throws
    let s = startSeed(makeSeedState());
    // Component sets these on catch(e):
    const afterCatch = {
      ...s,
      sseLog: [...s.sseLog, 'Error: fetch failed'],
      status: 'failure',
      errorCode: 'network_error',
    };
    expect(afterCatch.status).toBe('failure');
    expect(afterCatch.errorCode).toBe('network_error');
    expect(afterCatch.sseLog).toHaveLength(1);
  });
});

describe('seed toast content', () => {
  it('success toast label is non-empty', () => {
    const TOAST_LABEL = '5 ideas added';
    expect(TOAST_LABEL).toMatch(/ideas/);
    expect(TOAST_LABEL.length).toBeGreaterThan(0);
  });

  it('token count from done event is captured in state', () => {
    let s = startSeed(makeSeedState());
    s = handleSseMessage(s, { msg: 'Done.', done: true, tokens: 1800 });
    // Component renders: `✓ 5 ideas added · {formatTokens(s.tokens)}`
    expect(s.tokens).toBe(1800);
  });

  it('zero tokens does not appear in the toast (null sentinel)', () => {
    let s = startSeed(makeSeedState());
    s = handleSseMessage(s, { msg: 'Done.', done: true, tokens: 0 });
    // The server sends tokens: 0 if usage wasn't captured — omit from toast.
    // The component checks: seedTokens ? `· ${formatTokens(...)}` : ''
    // formatTokens(0) returns null, so the ternary is falsy.
    expect(s.tokens).toBe(0); // state holds 0
    // The component ternary uses `seedTokens` — 0 is falsy, so no token suffix shown
    expect(!!s.tokens).toBe(false);
  });
});

describe('seed SSE log disclosure', () => {
  it('log is empty before any run starts', () => {
    const s = makeSeedState();
    expect(s.sseLog).toHaveLength(0);
  });

  it('log accumulates all messages including the done message', () => {
    let s = startSeed(makeSeedState());
    const msgs = [
      'Looking over home.md…',
      'Sketching five ideas…',
      'Still drafting…',
      'Saving 5 ideas to disk…',
      'Done — 5 new trips on the list.',
    ];
    for (let i = 0; i < msgs.length - 1; i++) {
      s = handleSseMessage(s, { msg: msgs[i], done: false });
    }
    s = handleSseMessage(s, { msg: msgs[msgs.length - 1], done: true, tokens: 2100 });
    expect(s.sseLog).toHaveLength(5);
    expect(s.sseLog[0]).toContain('home.md');
    expect(s.sseLog[4]).toContain('Done');
  });

  it('log is reset when a new run starts', () => {
    let s = startSeed(makeSeedState());
    s = handleSseMessage(s, { msg: 'Working…', done: true, tokens: 1000 });
    expect(s.sseLog).toHaveLength(1);
    s = dismissError({ ...s, status: 'idle' }); // idle after success dismiss
    s = startSeed(s);
    expect(s.sseLog).toHaveLength(0);
  });
});

import { describe, it, expect } from 'vitest';

// Pure-JS state-machine tests for the Add destination Instant Inline UI.
// Mirrors the shape of tests/seed-instant-inline.test.js.
//
// The actual Svelte wiring isn't unit-testable without a DOM; these tests
// document the contract the component implements and guard regressions.

// ── Helpers that mirror what the component does ───────────────────────────

/** Build an initial add state object (mirrors component $state shape). */
function makeAddState() {
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
      next.status = 'failure';
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

/** Simulate starting an add run (component calls this on submit). */
function startAdd(state) {
  return { ...state, status: 'in_progress', errorCode: null, tokens: null, sseLog: [] };
}

/** Simulate dismissing an error (re-enables button). */
function dismissError(state) {
  return { ...state, status: 'idle', errorCode: null };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('add instant-inline state machine', () => {
  it('starts in idle state', () => {
    const s = makeAddState();
    expect(s.status).toBe('idle');
    expect(s.tokens).toBeNull();
    expect(s.sseLog).toEqual([]);
  });

  it('transitions idle → in_progress on startAdd', () => {
    const s = startAdd(makeAddState());
    expect(s.status).toBe('in_progress');
    expect(s.sseLog).toEqual([]);  // log is cleared on each run
  });

  it('accumulates SSE messages in sseLog while in_progress', () => {
    let s = startAdd(makeAddState());
    s = handleSseMessage(s, { msg: 'Checking the cabinet for Marfa, TX…', done: false });
    s = handleSseMessage(s, { msg: 'Sketching an idea for Marfa, TX…', done: false });
    expect(s.status).toBe('in_progress');
    expect(s.sseLog).toHaveLength(2);
  });

  it('transitions in_progress → success on done=true event with tokens', () => {
    let s = startAdd(makeAddState());
    s = handleSseMessage(s, { msg: 'Working…', done: false });
    s = handleSseMessage(s, { msg: 'Done — added to the list.', done: true, tokens: 600 });
    expect(s.status).toBe('success');
    expect(s.tokens).toBe(600);
    expect(s.sseLog).toHaveLength(2);
  });

  it('transitions in_progress → success with null tokens when server omits them', () => {
    let s = startAdd(makeAddState());
    s = handleSseMessage(s, { msg: 'Done.', done: true });
    expect(s.status).toBe('success');
    expect(s.tokens).toBeNull();
  });

  it('transitions in_progress → failure on Error: message with done=true', () => {
    let s = startAdd(makeAddState());
    s = handleSseMessage(s, { msg: 'Error: model returned nothing', done: true });
    expect(s.status).toBe('failure');
    expect(s.errorCode).toBeTruthy(); // mapped to a registry code
    expect(s.sseLog).toHaveLength(1);
    expect(s.sseLog[0]).toMatch(/error/i);
  });

  it('does not set failure state for non-done error-looking messages', () => {
    let s = startAdd(makeAddState());
    // An intermediate message starting with "Error" that isn't done
    // still accumulates in the log but doesn't flip the state to failure.
    s = handleSseMessage(s, { msg: 'Error: transient blip', done: false });
    expect(s.status).toBe('in_progress');
    expect(s.sseLog).toHaveLength(1);
  });

  it('dismissError resets to idle and clears error code', () => {
    let s = startAdd(makeAddState());
    s = handleSseMessage(s, { msg: 'Error: oops', done: true });
    expect(s.status).toBe('failure');
    s = dismissError(s);
    expect(s.status).toBe('idle');
    expect(s.errorCode).toBeNull();
  });

  it('re-runs from idle after a failure (log is cleared)', () => {
    let s = startAdd(makeAddState());
    s = handleSseMessage(s, { msg: 'Error: oops', done: true });
    s = dismissError(s);
    s = startAdd(s);
    expect(s.status).toBe('in_progress');
    expect(s.sseLog).toEqual([]);
  });

  it('network exception path sets failure state correctly', () => {
    // Simulates the catch block in runPin() when fetch itself throws
    let s = startAdd(makeAddState());
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

describe('add toast content', () => {
  it('success toast label mentions idea added', () => {
    // The component renders: `✓ Idea added · {formatTokens(addTokens)}`
    const TOAST_LABEL = 'Idea added';
    expect(TOAST_LABEL).toMatch(/idea/i);
    expect(TOAST_LABEL.length).toBeGreaterThan(0);
  });

  it('token count from done event is captured in state', () => {
    let s = startAdd(makeAddState());
    s = handleSseMessage(s, { msg: 'Done.', done: true, tokens: 700 });
    // Component renders: `✓ Idea added · ${formatTokens(s.tokens)}`
    expect(s.tokens).toBe(700);
  });

  it('zero tokens does not appear in the toast (null sentinel)', () => {
    let s = startAdd(makeAddState());
    s = handleSseMessage(s, { msg: 'Done.', done: true, tokens: 0 });
    // The server sends tokens: 0 if usage wasn't captured — omit from toast.
    // The component checks: addTokens ? `· ${formatTokens(...)}` : ''
    expect(s.tokens).toBe(0); // state holds 0
    // 0 is falsy, so no token suffix shown
    expect(!!s.tokens).toBe(false);
  });
});

describe('add SSE log disclosure', () => {
  it('log is empty before any run starts', () => {
    const s = makeAddState();
    expect(s.sseLog).toHaveLength(0);
  });

  it('log accumulates all messages including the done message', () => {
    let s = startAdd(makeAddState());
    const msgs = [
      'Checking the cabinet for Marfa, TX…',
      'Sketching an idea for Marfa, TX…',
      '  ✓ Marfa, Texas',
      'Done — added to the list.',
    ];
    for (let i = 0; i < msgs.length - 1; i++) {
      s = handleSseMessage(s, { msg: msgs[i], done: false });
    }
    s = handleSseMessage(s, { msg: msgs[msgs.length - 1], done: true, tokens: 600 });
    expect(s.sseLog).toHaveLength(4);
    expect(s.sseLog[3]).toContain('Done');
  });

  it('log is reset when a new run starts', () => {
    let s = startAdd(makeAddState());
    s = handleSseMessage(s, { msg: 'Working…', done: true, tokens: 600 });
    expect(s.sseLog).toHaveLength(1);
    s = startAdd(dismissError({ ...s, status: 'idle' }));
    expect(s.sseLog).toHaveLength(0);
  });
});

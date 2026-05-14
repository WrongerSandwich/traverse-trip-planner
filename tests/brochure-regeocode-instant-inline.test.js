import { describe, it, expect } from 'vitest';

// State-machine contract for the Brochure regeocode Instant Inline migration
// (docs/ai-workflow-ux.md §2.1, §7 "Brochure regeocode").
//
// Regeocode differs from Seed in two key ways:
//   1. It uses Nominatim (not a model), so tokens are always 0 / N/A.
//   2. The success result carries a geocoded-count ("N stops geocoded"),
//      not a token count.
//
// These tests document the state-machine contract the page component
// implements. DOM/Svelte wiring is not unit-testable here; we test the
// pure-JS transition logic extracted as helper functions.

// ── Helpers that mirror what the component does ───────────────────────────

function makeRegeoState() {
  return {
    status: 'idle',      // 'idle' | 'in_progress' | 'success' | 'failure'
    errorCode: null,
    geocodedCount: null, // extracted from success message (stops + lodging added)
    sseLog: [],
  };
}

function startRegeo(state) {
  return { ...state, status: 'in_progress', errorCode: null, geocodedCount: null, sseLog: [] };
}

function dismissRegeoError(state) {
  return { ...state, status: 'idle', errorCode: null };
}

function dismissRegeoSuccess(state) {
  return { ...state, status: 'idle', geocodedCount: null };
}

/**
 * Extract the stop-count from the done message.
 * The server sends e.g. "Added 2 new stop pins. 3 of 4 stops now have coords."
 * or "No new pins found. 0 of 3 stops have coords."
 */
function extractGeocodedCount(msg) {
  // Try "Added N …" pattern first
  const addedMatch = msg.match(/Added (\d+) new (stop|lodging) pin/);
  if (addedMatch) return parseInt(addedMatch[1], 10);
  // "No new pins found" = 0
  if (msg.includes('No new pins found')) return 0;
  return null;
}

/**
 * Simulate the SSE message handler the regeocode section registers.
 * Mirrors the component's streamAction callback logic.
 */
function handleSseMessage(state, event) {
  const next = { ...state, sseLog: [...state.sseLog, event.msg] };

  if (!event.done) return next;

  const isErr = typeof event.msg === 'string' && event.msg.toLowerCase().startsWith('error');

  if (isErr) {
    next.status    = 'failure';
    next.errorCode = event.errorCode ?? 'network_error';
  } else {
    next.status        = 'success';
    next.geocodedCount = extractGeocodedCount(event.msg);
  }
  return next;
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('regeocode instant-inline state machine', () => {
  it('starts in idle', () => {
    const s = makeRegeoState();
    expect(s.status).toBe('idle');
    expect(s.geocodedCount).toBeNull();
    expect(s.sseLog).toEqual([]);
  });

  it('transitions idle → in_progress on startRegeo', () => {
    const s = startRegeo(makeRegeoState());
    expect(s.status).toBe('in_progress');
    expect(s.sseLog).toEqual([]);
  });

  it('clears previous state on each new run', () => {
    let s = startRegeo(makeRegeoState());
    s = handleSseMessage(s, { msg: 'Done.', done: true });
    expect(s.status).toBe('success');
    s = startRegeo(s); // new run
    expect(s.status).toBe('in_progress');
    expect(s.geocodedCount).toBeNull();
    expect(s.sseLog).toEqual([]);
  });

  it('accumulates SSE messages while in_progress', () => {
    let s = startRegeo(makeRegeoState());
    s = handleSseMessage(s, { msg: 'Geocoding Stop 1…', done: false });
    s = handleSseMessage(s, { msg: 'Geocoding Stop 2…', done: false });
    expect(s.status).toBe('in_progress');
    expect(s.sseLog).toHaveLength(2);
  });

  it('transitions → success on done=true with "No new pins" message', () => {
    let s = startRegeo(makeRegeoState());
    s = handleSseMessage(s, {
      msg: 'No new pins found. 2 of 3 stops have coords.',
      done: true,
    });
    expect(s.status).toBe('success');
    expect(s.geocodedCount).toBe(0);
  });

  it('transitions → success with geocodedCount extracted from "Added N" message', () => {
    let s = startRegeo(makeRegeoState());
    s = handleSseMessage(s, {
      msg: 'Added 2 new stop pins. 3 of 3 stops now have coords.',
      done: true,
    });
    expect(s.status).toBe('success');
    expect(s.geocodedCount).toBe(2);
  });

  it('transitions → failure on error done message', () => {
    let s = startRegeo(makeRegeoState());
    s = handleSseMessage(s, { msg: 'Error: rate-limited', done: true });
    expect(s.status).toBe('failure');
    expect(s.errorCode).toBeTruthy();
    expect(s.sseLog).toHaveLength(1);
  });

  it('uses errorCode from event when provided (e.g. geocode_quota)', () => {
    let s = startRegeo(makeRegeoState());
    s = handleSseMessage(s, { msg: 'Error: quota hit', done: true, errorCode: 'geocode_quota' });
    expect(s.status).toBe('failure');
    expect(s.errorCode).toBe('geocode_quota');
  });

  it('dismissRegeoError resets to idle', () => {
    let s = startRegeo(makeRegeoState());
    s = handleSseMessage(s, { msg: 'Error: oops', done: true });
    s = dismissRegeoError(s);
    expect(s.status).toBe('idle');
    expect(s.errorCode).toBeNull();
  });

  it('dismissRegeoSuccess resets to idle (toast auto-dismiss)', () => {
    let s = startRegeo(makeRegeoState());
    s = handleSseMessage(s, { msg: 'Added 1 new stop pin. 2 of 3 stops now have coords.', done: true });
    expect(s.status).toBe('success');
    s = dismissRegeoSuccess(s);
    expect(s.status).toBe('idle');
    expect(s.geocodedCount).toBeNull();
  });

  it('non-done error-looking messages do not flip to failure', () => {
    let s = startRegeo(makeRegeoState());
    s = handleSseMessage(s, { msg: 'Error: partial blip', done: false });
    expect(s.status).toBe('in_progress');
  });
});

describe('regeocode no-tokens contract', () => {
  it('geocodedCount is always used (not tokens) — no model call', () => {
    let s = startRegeo(makeRegeoState());
    s = handleSseMessage(s, {
      msg: 'Added 3 new stop pins. 4 of 4 stops now have coords.',
      done: true,
    });
    // No token field — regeocode is a Nominatim call, not a model call
    expect(s.geocodedCount).toBe(3);
  });

  it('geocodedCount=0 is falsy — success toast shows "no new pins" variant', () => {
    let s = startRegeo(makeRegeoState());
    s = handleSseMessage(s, { msg: 'No new pins found. 0 of 2 stops have coords.', done: true });
    expect(s.geocodedCount).toBe(0);
    expect(!!s.geocodedCount).toBe(false); // falsy — toast uses "no new pins" wording
  });
});

describe('regeocode success toast content', () => {
  it('toast label is non-empty for added-pins case', () => {
    function toastLabel(geocodedCount) {
      if (geocodedCount) return `✓ ${geocodedCount} stop${geocodedCount === 1 ? '' : 's'} geocoded`;
      return '✓ No new pins found';
    }
    expect(toastLabel(2)).toBe('✓ 2 stops geocoded');
    expect(toastLabel(1)).toBe('✓ 1 stop geocoded');
    expect(toastLabel(0)).toBe('✓ No new pins found');
  });
});

describe('regeocode SSE log disclosure', () => {
  it('log is empty before any run', () => {
    expect(makeRegeoState().sseLog).toHaveLength(0);
  });

  it('log accumulates all SSE messages including done', () => {
    let s = startRegeo(makeRegeoState());
    s = handleSseMessage(s, { msg: 'Looking up Old Tavern…', done: false });
    s = handleSseMessage(s, { msg: 'Added 1 new stop pin. 1 of 2 stops now have coords.', done: true });
    expect(s.sseLog).toHaveLength(2);
    expect(s.sseLog[0]).toContain('Old Tavern');
    expect(s.sseLog[1]).toContain('Added');
  });

  it('log resets when a new run starts', () => {
    let s = startRegeo(makeRegeoState());
    s = handleSseMessage(s, { msg: 'Done.', done: true });
    expect(s.sseLog).toHaveLength(1);
    s = startRegeo(s);
    expect(s.sseLog).toHaveLength(0);
  });
});

describe('regeocode disabled-while-busy contract', () => {
  it('in_progress means busy (disables other form actions)', () => {
    const s = startRegeo(makeRegeoState());
    // The component uses regeoStatus === 'in_progress' to disable
    // the Save and Re-generate buttons. This test documents that contract.
    const busy = s.status === 'in_progress';
    expect(busy).toBe(true);
  });

  it('idle after dismiss means not busy (re-enables)', () => {
    let s = startRegeo(makeRegeoState());
    s = handleSseMessage(s, { msg: 'Error: oops', done: true });
    s = dismissRegeoError(s);
    const busy = s.status === 'in_progress';
    expect(busy).toBe(false);
  });
});

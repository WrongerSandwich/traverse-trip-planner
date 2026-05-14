import { describe, it, expect } from 'vitest';

// Pure state machine tests for the Chat Instant Inline alignment.
// These mirror the pattern in tests/seed-instant-inline.test.js.
//
// Covers: per-turn loading state, typed error codes, token surfacing.
// The actual Svelte wiring isn't unit-testable without a DOM; these tests
// document the contract the component implements.

// ── Helpers that mirror what the component does ───────────────────────────

function makeChatState() {
  return {
    busy: false,
    errorCode: null,
    errorContext: null,
    lastInput: '',
  };
}

/** Simulate starting a send (component sets chatBusy = true, clears error) */
function startSend(state, text) {
  return { ...state, busy: true, errorCode: null, errorContext: null, lastInput: text };
}

/** Simulate a successful response from the server */
function handleSuccess(state) {
  return { ...state, busy: false, errorCode: null, errorContext: null };
}

/** Simulate a server error response { error: code, context? } */
function handleError(state, { code, context } = {}) {
  return {
    ...state,
    busy: false,
    errorCode: code ?? 'network_error',
    errorContext: context ?? null,
  };
}

/** Simulate retry: clears error, re-starts send with lastInput */
function retry(state) {
  return { ...state, errorCode: null, errorContext: null };
}

/** Simulate dismiss: clears error */
function dismiss(state) {
  return { ...state, errorCode: null, errorContext: null };
}

// ── Core state tests ──────────────────────────────────────────────────────

describe('chat instant-inline loading state', () => {
  it('starts idle — not busy, no error', () => {
    const s = makeChatState();
    expect(s.busy).toBe(false);
    expect(s.errorCode).toBeNull();
  });

  it('transitions idle → busy on startSend', () => {
    const s = startSend(makeChatState(), 'Hello');
    expect(s.busy).toBe(true);
    expect(s.lastInput).toBe('Hello');
  });

  it('clears busy and error on success', () => {
    let s = startSend(makeChatState(), 'Hello');
    s = handleSuccess(s);
    expect(s.busy).toBe(false);
    expect(s.errorCode).toBeNull();
  });

  it('clears error code when starting a new send', () => {
    let s = handleError(makeChatState(), { code: 'network_error' });
    expect(s.errorCode).toBe('network_error');
    s = startSend(s, 'Retry text');
    expect(s.errorCode).toBeNull();
    expect(s.busy).toBe(true);
  });
});

// ── Error handling ────────────────────────────────────────────────────────

describe('chat error handling — typed codes', () => {
  it('sets errorCode on network_error', () => {
    let s = startSend(makeChatState(), 'Hello');
    s = handleError(s, { code: 'network_error' });
    expect(s.busy).toBe(false);
    expect(s.errorCode).toBe('network_error');
  });

  it('defaults to network_error when server returns no code', () => {
    let s = startSend(makeChatState(), 'Hello');
    s = handleError(s, {});
    expect(s.errorCode).toBe('network_error');
  });

  it('sets provider_error with interpolation context', () => {
    let s = startSend(makeChatState(), 'Hello');
    s = handleError(s, {
      code: 'provider_error',
      context: { provider: 'Anthropic', summary: 'Rate limited' },
    });
    expect(s.errorCode).toBe('provider_error');
    expect(s.errorContext).toEqual({ provider: 'Anthropic', summary: 'Rate limited' });
  });

  it('sets empty_model_output code from server', () => {
    let s = startSend(makeChatState(), 'Hello');
    s = handleError(s, { code: 'empty_model_output' });
    expect(s.errorCode).toBe('empty_model_output');
  });

  it('retry clears error code and context', () => {
    let s = handleError(makeChatState(), {
      code: 'provider_error',
      context: { provider: 'OpenAI', summary: 'Timeout' },
    });
    s = retry(s);
    expect(s.errorCode).toBeNull();
    expect(s.errorContext).toBeNull();
  });

  it('dismiss clears error code and context', () => {
    let s = handleError(makeChatState(), { code: 'network_error' });
    s = dismiss(s);
    expect(s.errorCode).toBeNull();
    expect(s.errorContext).toBeNull();
  });
});

// ── Token surfacing per turn ──────────────────────────────────────────────

describe('chat token surfacing per turn', () => {
  it('assistant message carries tokens field from server response', () => {
    const msg = {
      role: 'assistant',
      content: 'Here is what I found.',
      tokens: 1234,
      updated: [],
    };
    expect(msg.tokens).toBe(1234);
  });

  it('zero tokens does not render (0 is falsy, formatTokens returns null for 0)', () => {
    const msg = { role: 'assistant', content: 'Hello', tokens: 0 };
    // Component guards: {#if msg.tokens} — 0 is falsy, no display
    expect(!!msg.tokens).toBe(false);
  });

  it('null tokens does not render', () => {
    const msg = { role: 'assistant', content: 'Hello', tokens: null };
    expect(!!msg.tokens).toBe(false);
  });

  it('positive token counts are truthy and display', () => {
    const msg = { role: 'assistant', content: 'Hello', tokens: 800 };
    expect(!!msg.tokens).toBe(true);
  });
});

// ── Retry with preserved input ────────────────────────────────────────────

describe('chat retry preserves last input', () => {
  it('lastInput is set on startSend', () => {
    const s = startSend(makeChatState(), 'Add a note about parking.');
    expect(s.lastInput).toBe('Add a note about parking.');
  });

  it('lastInput survives an error (enables retry with same text)', () => {
    let s = startSend(makeChatState(), 'Add a note about parking.');
    s = handleError(s, { code: 'network_error' });
    expect(s.lastInput).toBe('Add a note about parking.');
    // Retry re-uses lastInput to replay the send
    const retried = startSend(retry(s), s.lastInput);
    expect(retried.lastInput).toBe('Add a note about parking.');
    expect(retried.busy).toBe(true);
  });
});

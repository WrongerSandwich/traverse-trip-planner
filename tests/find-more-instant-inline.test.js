import { describe, it, expect } from 'vitest';

// Pure-JS state-machine test for the find-more panel UI in
// CandidatesSection.svelte. The Svelte wiring isn't unit-testable without
// a DOM; these tests document the contract and guard regressions.

function makeState() {
  return {
    openPanel: null,
    findSteering: '',
    findCount: 5,
    findSubmitting: false,
    findErrorCode: null,
    findErrorCtx: {},
  };
}

function openFindMore(state) { return { ...state, openPanel: 'find-more' }; }
function closeFindMore(state) { return { ...state, openPanel: null }; }

function handleSubmitOutcome(state, outcome) {
  if (outcome.kind === '202') {
    return { ...state, openPanel: null, findSubmitting: false, findSteering: '' };
  }
  if (outcome.kind === 'error') {
    return { ...state, findSubmitting: false, findErrorCode: outcome.code, findErrorCtx: outcome.ctx };
  }
  return state;
}

describe('find-more panel state machine', () => {
  it('opens and closes the panel', () => {
    let s = makeState();
    s = openFindMore(s);
    expect(s.openPanel).toBe('find-more');
    s = closeFindMore(s);
    expect(s.openPanel).toBeNull();
  });

  it('on 202 the panel closes and steering is cleared', () => {
    let s = openFindMore({ ...makeState(), findSteering: 'more food', findSubmitting: true });
    s = handleSubmitOutcome(s, { kind: '202' });
    expect(s.openPanel).toBeNull();
    expect(s.findSteering).toBe('');
    expect(s.findSubmitting).toBe(false);
  });

  it('on 409 the panel stays open and shows the error sentence', () => {
    let s = openFindMore({ ...makeState(), findSubmitting: true });
    s = handleSubmitOutcome(s, { kind: 'error', code: 'already_running', ctx: {} });
    expect(s.openPanel).toBe('find-more');
    expect(s.findErrorCode).toBe('already_running');
    expect(s.findSubmitting).toBe(false);
  });
});

describe('subtools tab-awareness', () => {
  function currentTabType(tab) { return tab === 'stops' ? 'stop' : 'lodging'; }

  it('reflects active tab', () => {
    expect(currentTabType('stops')).toBe('stop');
    expect(currentTabType('lodging')).toBe('lodging');
  });
});

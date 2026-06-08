import { describe, it, expect } from 'vitest';
import { buildCaptureContext } from '../src/lib/server/retro-capture.js';

function fixture() {
  return {
    plan: { days: [
      { number: 1, stops: ['mill', 'museum'], log: 'Rained all afternoon' },
      { number: 2, stops: ['trail'] },
    ] },
    candidates: { stops: [
      { id: 'mill', name: 'Old Mill', status: 'visited', note: 'Closed early' },
      { id: 'museum', name: 'History Museum', status: 'skipped' },
      { id: 'trail', name: 'River Trail' },
    ], lodging: [] },
  };
}

describe('buildCaptureContext', () => {
  it('builds a prompt block summarizing status + notes + day logs', () => {
    const { promptBlock } = buildCaptureContext(fixture());
    expect(promptBlock).toMatch(/Old Mill/);
    expect(promptBlock).toMatch(/visited/);
    expect(promptBlock).toMatch(/Closed early/);
    expect(promptBlock).toMatch(/skipped/);
    expect(promptBlock).toMatch(/Rained all afternoon/);
  });

  it('builds a verbatim ## In-trip notes section from logs + notes only', () => {
    const { verbatimSection } = buildCaptureContext(fixture());
    expect(verbatimSection).toMatch(/^## In-trip notes/m);
    expect(verbatimSection).toMatch(/Rained all afternoon/);
    expect(verbatimSection).toMatch(/Old Mill/);
    expect(verbatimSection).toMatch(/Closed early/);
    // A skipped stop with no note contributes nothing to the verbatim section.
    expect(verbatimSection).not.toMatch(/History Museum/);
  });

  it('returns empty block + null section when nothing was captured', () => {
    const empty = { plan: { days: [{ number: 1, stops: ['a'] }] }, candidates: { stops: [{ id: 'a', name: 'A' }], lodging: [] } };
    const out = buildCaptureContext(empty);
    expect(out.promptBlock).toBe('');
    expect(out.verbatimSection).toBe(null);
  });

  it('tolerates missing plan/candidates', () => {
    expect(buildCaptureContext({ plan: null, candidates: null }))
      .toEqual({ promptBlock: '', verbatimSection: null });
  });
});

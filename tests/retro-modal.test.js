import { describe, it, expect } from 'vitest';
import { failureSentence } from '../src/lib/errors-registry.js';
import { formatTokens } from '../src/lib/workflow-status/core.js';

// Mirrors classifyError() in RetroModal.svelte — inline for test isolation.
function classifyError(res, text) {
  if (!res) return { code: 'network_error', ctx: {} };
  if (res.status === 409) return { code: 'file_conflict', ctx: { artifact: 'notes.md' } };
  if (res.status === 404) return { code: 'trip_not_found', ctx: {} };
  if (res.status === 502) return { code: 'empty_model_output', ctx: {} };
  if (res.status === 400) return { code: 'invalid_input', ctx: { reason: text || 'Bad request' } };
  return { code: 'network_error', ctx: {} };
}

describe('retro modal: error classification', () => {
  it('maps 409 to file_conflict with notes.md as the artifact', () => {
    const { code, ctx } = classifyError({ status: 409 }, '');
    expect(code).toBe('file_conflict');
    expect(ctx.artifact).toBe('notes.md');
  });

  it('maps 404 to trip_not_found', () => {
    expect(classifyError({ status: 404 }, '').code).toBe('trip_not_found');
  });

  it('maps 502 to empty_model_output', () => {
    expect(classifyError({ status: 502 }, '').code).toBe('empty_model_output');
  });

  it('maps 400 to invalid_input and carries the response text as the reason', () => {
    const { code, ctx } = classifyError({ status: 400 }, 'Missing questions');
    expect(code).toBe('invalid_input');
    expect(ctx.reason).toBe('Missing questions');
  });

  it('maps null (network failure) to network_error', () => {
    expect(classifyError(null, 'fetch failed').code).toBe('network_error');
  });

  it('maps an unexpected status (e.g. 500) to network_error', () => {
    expect(classifyError({ status: 500 }, '').code).toBe('network_error');
  });
});

describe('retro modal: registry-based error sentences', () => {
  it('file_conflict sentence mentions notes.md when artifact is interpolated', () => {
    const sentence = failureSentence('file_conflict', { artifact: 'notes.md' });
    expect(sentence).toContain('notes.md');
    expect(sentence).toMatch(/already exists/i);
  });

  it('network_error sentence references connection/reach', () => {
    const sentence = failureSentence('network_error', {});
    expect(sentence).toMatch(/connection|reach/i);
  });

  it('empty_model_output sentence references model output', () => {
    const sentence = failureSentence('empty_model_output', {});
    expect(sentence).toMatch(/model returned/i);
  });

  it('trip_not_found sentence is non-empty', () => {
    const sentence = failureSentence('trip_not_found', {});
    expect(typeof sentence).toBe('string');
    expect(sentence.length).toBeGreaterThan(0);
  });

  it('invalid_input sentence interpolates the reason', () => {
    const sentence = failureSentence('invalid_input', { reason: 'missing target_date' });
    expect(sentence).toContain('missing target_date');
  });

  it('unknown code returns generic fallback (never empty string)', () => {
    const sentence = failureSentence('not_a_real_code', {});
    expect(typeof sentence).toBe('string');
    expect(sentence.length).toBeGreaterThan(0);
  });
});

describe('retro modal: aggregated token display', () => {
  it('sums POST and PUT token counts', () => {
    const postTokens = 350;
    const putTokens  = 1_200;
    const total = postTokens + putTokens;
    expect(total).toBe(1_550);
    expect(formatTokens(total)).toBe('1.6k tokens');
  });

  it('handles zero PUT tokens (only POST tokens accumulated)', () => {
    const total = 480 + 0;
    expect(formatTokens(total)).toBe('480 tokens');
  });

  it('returns null for a total of zero — no tokens surfaced', () => {
    expect(formatTokens(0)).toBeNull();
  });

  it('shows sub-thousand count without k suffix', () => {
    expect(formatTokens(750)).toBe('750 tokens');
  });

  it('shows round-thousand count as Nk with no decimal', () => {
    expect(formatTokens(2_000)).toBe('2k tokens');
  });
});

describe('retro modal: discard-confirmation gating logic', () => {
  // Mirrors the requestClose() condition in RetroModal.svelte.
  function shouldConfirm(phase, answers) {
    const hasAnyAnswer = answers.some(a => a.trim().length > 0);
    return phase === 'answering' && hasAnyAnswer;
  }

  it('requires confirmation when answering and at least one answer is non-empty', () => {
    expect(shouldConfirm('answering', ['', 'Great trip!', '', '', ''])).toBe(true);
  });

  it('does not require confirmation when all answers are empty', () => {
    expect(shouldConfirm('answering', ['', '', '', '', ''])).toBe(false);
  });

  it('does not require confirmation in loading phase even with non-empty answers', () => {
    expect(shouldConfirm('loading', ['something', '', '', '', ''])).toBe(false);
  });

  it('does not require confirmation in saving phase', () => {
    expect(shouldConfirm('saving', ['answer', '', '', '', ''])).toBe(false);
  });

  it('treats whitespace-only answers as not entered', () => {
    expect(shouldConfirm('answering', ['   ', '\t\n', '', '', ''])).toBe(false);
  });

  it('requires confirmation even when only one of five questions is answered', () => {
    expect(shouldConfirm('answering', ['', '', 'Just a note', '', ''])).toBe(true);
  });
});

import { describe, it, expect } from 'vitest';
import {
  STATES,
  resolveSentence,
  resolveAffordances,
  resolveStatus,
  formatTokens,
} from '../src/lib/workflow-status/core.js';
import * as WorkflowStatus from '../src/lib/workflow-status/index.js';
import { ERROR_REGISTRY } from '../src/lib/server/errors.js';

describe('workflow-status core', () => {
  describe('STATES', () => {
    it('exports the five canonical workflow states', () => {
      expect(STATES).toEqual(['idle', 'in_progress', 'success', 'failure', 'cancelled']);
    });
  });

  describe('resolveSentence', () => {
    it('returns a non-interpolated registry sentence verbatim', () => {
      const out = resolveSentence({ code: 'empty_model_output' });
      expect(out).toBe(ERROR_REGISTRY.empty_model_output.sentence);
    });

    it('interpolates {provider} and {summary} into provider_error', () => {
      const out = resolveSentence({
        code: 'provider_error',
        context: { provider: 'Anthropic', summary: 'rate limited' },
      });
      expect(out).toBe('Anthropic returned an error: rate limited. Retry, or switch providers.');
    });

    it('leaves an unfilled placeholder as the literal {key} when context is missing', () => {
      const out = resolveSentence({ code: 'provider_error', context: { provider: 'OpenAI' } });
      expect(out).toContain('OpenAI returned an error');
      expect(out).toContain('{summary}');
    });

    it('returns a fallback sentence for unknown codes', () => {
      const out = resolveSentence({ code: 'no_such_code' });
      expect(out).toMatch(/unknown|error|something/i);
    });

    it('returns null when no code is given', () => {
      expect(resolveSentence({})).toBeNull();
      expect(resolveSentence({ code: null })).toBeNull();
      expect(resolveSentence({ code: '' })).toBeNull();
    });
  });

  describe('resolveAffordances', () => {
    it('returns affordances list from registry', () => {
      expect(resolveAffordances('empty_model_output')).toEqual(['retry', 'switch_provider']);
    });

    it('returns an empty list for unknown codes', () => {
      expect(resolveAffordances('no_such_code')).toEqual([]);
    });

    it('returns an empty list when code is falsy', () => {
      expect(resolveAffordances(null)).toEqual([]);
      expect(resolveAffordances(undefined)).toEqual([]);
      expect(resolveAffordances('')).toEqual([]);
    });
  });

  describe('resolveStatus', () => {
    it('returns failure status pulled from the registry when state=failure with a code', () => {
      const out = resolveStatus({ state: 'failure', code: 'empty_model_output' });
      expect(out.tone).toBe('failure');
      expect(out.sentence).toBe(ERROR_REGISTRY.empty_model_output.sentence);
      expect(out.affordances).toEqual(['retry', 'switch_provider']);
    });

    it('interpolates context into failure sentences', () => {
      const out = resolveStatus({
        state: 'failure',
        code: 'invalid_input',
        context: { reason: 'missing target_date' },
      });
      expect(out.sentence).toBe('missing target_date. Edit the trip and try again.');
      expect(out.affordances).toEqual(['edit']);
    });

    it('uses caller-provided sentence override for non-failure states', () => {
      const out = resolveStatus({ state: 'in_progress', sentence: 'Generating ideas…' });
      expect(out.sentence).toBe('Generating ideas…');
      expect(out.tone).toBe('progress');
      expect(out.affordances).toEqual([]);
    });

    it('treats cancelled as a distinct tone with the cancelled registry sentence', () => {
      const out = resolveStatus({ state: 'cancelled' });
      expect(out.tone).toBe('cancelled');
      expect(out.sentence).toBe(ERROR_REGISTRY.cancelled.sentence);
      expect(out.affordances).toEqual(['dismiss']);
    });

    it('allows caller-provided affordances override (failure)', () => {
      const out = resolveStatus({
        state: 'failure',
        code: 'empty_model_output',
        affordances: ['dismiss'],
      });
      expect(out.affordances).toEqual(['dismiss']);
    });

    it('reports tone=success for state=success and exposes sentence', () => {
      const out = resolveStatus({ state: 'success', sentence: 'Trip locked' });
      expect(out.tone).toBe('success');
      expect(out.sentence).toBe('Trip locked');
      expect(out.affordances).toEqual([]);
    });

    it('reports tone=neutral for idle', () => {
      const out = resolveStatus({ state: 'idle' });
      expect(out.tone).toBe('neutral');
    });

    it('throws on unknown state', () => {
      expect(() => resolveStatus({ state: 'wat' })).toThrow(/unknown state/i);
    });

    it('failure state without a code still resolves with a fallback sentence', () => {
      const out = resolveStatus({ state: 'failure' });
      expect(out.tone).toBe('failure');
      expect(typeof out.sentence).toBe('string');
      expect(out.sentence.length).toBeGreaterThan(0);
      expect(out.affordances).toEqual([]);
    });
  });

  describe('barrel exports', () => {
    it('exposes the four archetype wrappers + AffordanceButtons + core helpers', () => {
      expect(WorkflowStatus.InstantInlineStatus).toBeDefined();
      expect(WorkflowStatus.StreamBanner).toBeDefined();
      expect(WorkflowStatus.AmbientBackgroundStatus).toBeDefined();
      expect(WorkflowStatus.ConversationalStatus).toBeDefined();
      expect(WorkflowStatus.AffordanceButtons).toBeDefined();
      expect(WorkflowStatus.STATES).toEqual(STATES);
      expect(typeof WorkflowStatus.resolveStatus).toBe('function');
      expect(typeof WorkflowStatus.resolveSentence).toBe('function');
      expect(typeof WorkflowStatus.resolveAffordances).toBe('function');
      expect(typeof WorkflowStatus.formatTokens).toBe('function');
    });
  });

  describe('formatTokens', () => {
    it('formats sub-thousand counts as the integer value', () => {
      expect(formatTokens(450)).toBe('450 tokens');
    });

    it('formats >= 1000 with a k suffix and one decimal', () => {
      expect(formatTokens(12_400)).toBe('12.4k tokens');
      expect(formatTokens(3_200)).toBe('3.2k tokens');
    });

    it('drops the trailing .0 for round-thousand values', () => {
      expect(formatTokens(5_000)).toBe('5k tokens');
    });

    it('returns null for missing / zero / negative values', () => {
      expect(formatTokens(0)).toBeNull();
      expect(formatTokens(null)).toBeNull();
      expect(formatTokens(undefined)).toBeNull();
      expect(formatTokens(-100)).toBeNull();
    });
  });
});

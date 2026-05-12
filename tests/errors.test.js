import { describe, it, expect } from 'vitest';
import {
  TraverseError,
  AdapterError,
  summarizeStatus,
  formatSummary,
  adapterErrorFromResponse,
} from '../src/lib/server/errors.js';

describe('TraverseError', () => {
  it('is an instance of Error', () => {
    expect(new TraverseError('missing_overview', 'msg')).toBeInstanceOf(Error);
  });

  it('carries the expected name and code', () => {
    const err = new TraverseError('model_returned_no_yaml', 'no block returned');
    expect(err.name).toBe('TraverseError');
    expect(err.code).toBe('model_returned_no_yaml');
    expect(err.message).toBe('no block returned');
  });

  it('is throwable and catchable', () => {
    expect(() => {
      throw new TraverseError('geocode_quota', 'rate limited');
    }).toThrow('rate limited');
  });

  it('can be distinguished from AdapterError', () => {
    const t = new TraverseError('geocode_quota', 'rate limited');
    const a = new AdapterError({ provider: 'anthropic', summary: 'fail' });
    expect(t instanceof TraverseError).toBe(true);
    expect(t instanceof AdapterError).toBe(false);
    expect(a instanceof AdapterError).toBe(true);
    expect(a instanceof TraverseError).toBe(false);
  });
});

describe('summarizeStatus', () => {
  it('maps common error codes to short labels', () => {
    expect(summarizeStatus(401)).toBe('API key rejected');
    expect(summarizeStatus(403)).toBe('API access forbidden');
    expect(summarizeStatus(404)).toBe('Model or endpoint not found');
    expect(summarizeStatus(429)).toBe('Rate limited');
    expect(summarizeStatus(500)).toBe('Provider unavailable');
    expect(summarizeStatus(503)).toBe('Provider unavailable');
  });

  it('falls back to a generic Client/Server error for other 4xx/5xx', () => {
    expect(summarizeStatus(418)).toBe('Client error (418)');
    expect(summarizeStatus(599)).toBe('Provider unavailable');
  });

  it('falls back to plain HTTP <code> for unknown ranges', () => {
    expect(summarizeStatus(301)).toBe('HTTP 301');
  });
});

describe('formatSummary', () => {
  it('includes provider, model, and status mapping', () => {
    expect(formatSummary({ provider: 'openai', model: 'gpt-4o', status: 429 }))
      .toBe('openai/gpt-4o: Rate limited');
  });

  it('drops model when not provided', () => {
    expect(formatSummary({ provider: 'tavily', status: 500 }))
      .toBe('tavily: Provider unavailable');
  });

  it('uses detail when no status is provided', () => {
    expect(formatSummary({ provider: 'anthropic', model: 'sonnet', detail: 'connection reset' }))
      .toBe('anthropic/sonnet: connection reset');
  });

  it('appends detail in parens when both status and detail are provided', () => {
    expect(formatSummary({ provider: 'openai', model: 'gpt', status: 400, detail: 'invalid_param' }))
      .toBe('openai/gpt: Client error (400) (invalid_param)');
  });
});

describe('adapterErrorFromResponse', () => {
  it('produces an AdapterError with the expected fields', () => {
    const err = adapterErrorFromResponse({
      provider: 'openai',
      model: 'gpt-4o-mini',
      status: 429,
      cause: '{"error":{"message":"rate limited"}}',
    });
    expect(err).toBeInstanceOf(AdapterError);
    expect(err.name).toBe('AdapterError');
    expect(err.provider).toBe('openai');
    expect(err.model).toBe('gpt-4o-mini');
    expect(err.status).toBe(429);
    expect(err.message).toContain('Rate limited');
    expect(err.message).not.toContain('rate limited'); // raw body not in summary
    expect(err.cause).toContain('rate limited'); // raw body retained on .cause
  });

  it('AdapterError is throwable and catchable as Error', () => {
    expect(() => {
      throw new AdapterError({ provider: 'p', summary: 'oops' });
    }).toThrow(/oops/);
  });
});

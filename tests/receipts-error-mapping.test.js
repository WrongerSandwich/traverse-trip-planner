import { describe, it, expect } from 'vitest';
import { receiptsErrorFromStatus } from '../src/lib/utils/receiptsErrors.js';
import { ERROR_REGISTRY } from '../src/lib/errors-registry.js';

describe('receiptsErrorFromStatus', () => {
  it('maps 404 to trip_not_found', () => {
    const { code, ctx } = receiptsErrorFromStatus(404, '');
    expect(code).toBe('trip_not_found');
    expect(ctx).toEqual({});
  });

  it('maps 413 to invalid_input with size reason (ignores body)', () => {
    const { code, ctx } = receiptsErrorFromStatus(413, 'Image too large: foo.jpg');
    expect(code).toBe('invalid_input');
    expect(ctx.reason).toMatch(/5 MB/);
  });

  it('maps 415 to invalid_input using body as reason', () => {
    const { code, ctx } = receiptsErrorFromStatus(415, 'Unsupported image type: application/pdf');
    expect(code).toBe('invalid_input');
    expect(ctx.reason).toContain('application/pdf');
  });

  it('maps 415 to invalid_input with fallback reason when body is empty', () => {
    const { code, ctx } = receiptsErrorFromStatus(415, '');
    expect(code).toBe('invalid_input');
    expect(ctx.reason).toBe('Unsupported image type');
  });

  it('maps 400 to invalid_input using body as reason', () => {
    const { code, ctx } = receiptsErrorFromStatus(400, 'No images provided');
    expect(code).toBe('invalid_input');
    expect(ctx.reason).toBe('No images provided');
  });

  it('maps 400 to invalid_input with fallback reason when body is empty', () => {
    const { code, ctx } = receiptsErrorFromStatus(400, '');
    expect(code).toBe('invalid_input');
    expect(ctx.reason).toBe('Bad request');
  });

  it('maps 422 to empty_model_output', () => {
    const { code, ctx } = receiptsErrorFromStatus(422, '');
    expect(code).toBe('empty_model_output');
    expect(ctx).toEqual({});
  });

  it('maps 502 to provider_error with body as summary', () => {
    const { code, ctx } = receiptsErrorFromStatus(502, 'Model does not support vision');
    expect(code).toBe('provider_error');
    expect(ctx.provider).toBe('Model');
    expect(ctx.summary).toBe('Model does not support vision');
  });

  it('maps 502 to provider_error with fallback summary when body is empty', () => {
    const { code, ctx } = receiptsErrorFromStatus(502, '');
    expect(code).toBe('provider_error');
    expect(ctx.summary).toBe('Unknown error');
  });

  it('maps 500 to network_error', () => {
    const { code } = receiptsErrorFromStatus(500, '');
    expect(code).toBe('network_error');
  });

  it('maps unknown status to network_error', () => {
    const { code } = receiptsErrorFromStatus(503, 'Service unavailable');
    expect(code).toBe('network_error');
  });

  it('all returned codes exist in ERROR_REGISTRY', () => {
    const testCases = [400, 404, 413, 415, 422, 500, 502, 503];
    for (const status of testCases) {
      const { code } = receiptsErrorFromStatus(status, 'body text');
      expect(
        ERROR_REGISTRY,
        `status ${status} maps to '${code}' which is not in ERROR_REGISTRY`,
      ).toHaveProperty(code);
    }
  });
});

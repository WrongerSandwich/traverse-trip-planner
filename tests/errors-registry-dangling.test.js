import { describe, it, expect } from 'vitest';
import { ERROR_REGISTRY } from '../src/lib/errors-registry.js';

describe('dangling_candidate_id error', () => {
  it('exists with correct shape', () => {
    const entry = ERROR_REGISTRY.dangling_candidate_id;
    expect(entry).toBeDefined();
    expect(entry.sentence).toContain('{candidate_id}');
    expect(entry.interpolate).toContain('candidate_id');
    expect(entry.affordances).toEqual(expect.arrayContaining(['edit', 'dismiss']));
  });
});

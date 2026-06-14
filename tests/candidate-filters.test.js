import { describe, it, expect } from 'vitest';
import { activeCategories } from '../src/lib/utils/candidate-filters.js';

describe('activeCategories', () => {
  it('returns the distinct categories present, in canonical order', () => {
    const cands = [{ category: 'food' }, { category: 'outdoors' }, { category: 'food' }, { category: 'historic' }];
    expect(activeCategories(cands)).toEqual(['historic', 'food', 'outdoors']);
  });
  it('ignores unknown/missing categories', () => {
    expect(activeCategories([{ category: 'food' }, {}, { category: 'nope' }])).toEqual(['food']);
  });
  it('handles an empty pool', () => { expect(activeCategories([])).toEqual([]); });
  it('handles a null pool gracefully', () => { expect(activeCategories(null)).toEqual([]); });
});

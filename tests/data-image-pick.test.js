import { describe, it, expect } from 'vitest';
import { applyImagePick } from '../src/lib/server/data.js';

const A = { medium: 'a-m', large: 'a-l', photographer: 'A' };
const B = { medium: 'b-m', large: 'b-l', photographer: 'B' };
const C = { medium: 'c-m', large: 'c-l', photographer: 'C' };

const image = { ...A, photos: [A, B, C] };

describe('applyImagePick', () => {
  it('returns null when image is null', () => {
    expect(applyImagePick(null, 1)).toBe(null);
  });

  it('returns the original shape when pick is 0', () => {
    expect(applyImagePick(image, 0)).toEqual(image);
  });

  it('returns the original shape when pick is undefined', () => {
    expect(applyImagePick(image, undefined)).toEqual(image);
  });

  it('reorders photos so the picked one is at index 0', () => {
    const result = applyImagePick(image, 1);
    expect(result.photos).toEqual([B, A, C]);
    expect(result.medium).toBe('b-m');
    expect(result.large).toBe('b-l');
    expect(result.photographer).toBe('B');
  });

  it('accepts string pick values (frontmatter is parsed as strings)', () => {
    const result = applyImagePick(image, '2');
    expect(result.photos).toEqual([C, A, B]);
    expect(result.medium).toBe('c-m');
  });

  it('clamps pick down to the last index when out of bounds', () => {
    const result = applyImagePick({ ...A, photos: [A, B] }, 2);
    expect(result.photos).toEqual([B, A]);
    expect(result.medium).toBe('b-m');
  });

  it('clamps negative pick values to 0', () => {
    expect(applyImagePick(image, -1)).toEqual(image);
  });

  it('ignores non-integer pick values', () => {
    expect(applyImagePick(image, 'oops')).toEqual(image);
    expect(applyImagePick(image, NaN)).toEqual(image);
    expect(applyImagePick(image, 1.5)).toEqual(image);
  });

  it('handles legacy single-photo shape (no .photos array)', () => {
    const legacy = { medium: 'l-m', large: 'l-l', photographer: 'L' };
    expect(applyImagePick(legacy, 1)).toEqual(legacy);
  });
});

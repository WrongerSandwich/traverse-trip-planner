import { describe, test, expect } from 'vitest';
import { stopToWaypoint } from '../src/lib/utils/maps-links.js';

describe('stopToWaypoint', () => {
  test('returns lat,lng when coords are present', () => {
    const stop = { name: 'X', address: '1 Main St', coords: [44.88, -86.05] };
    expect(stopToWaypoint(stop)).toBe('44.88,-86.05');
  });

  test('falls back to address when coords are missing', () => {
    const stop = { name: 'X', address: '1 Main St, Empire MI' };
    expect(stopToWaypoint(stop)).toBe('1 Main St, Empire MI');
  });

  test('falls back to name when coords and address are missing', () => {
    const stop = { name: 'Sleeping Bear Dunes' };
    expect(stopToWaypoint(stop)).toBe('Sleeping Bear Dunes');
  });

  test('returns null when stop has none of coords, address, name', () => {
    expect(stopToWaypoint({})).toBeNull();
    expect(stopToWaypoint(null)).toBeNull();
    expect(stopToWaypoint(undefined)).toBeNull();
  });

  test('treats non-array coords as missing', () => {
    const stop = { name: 'X', coords: { lat: 1, lng: 2 } };
    expect(stopToWaypoint(stop)).toBe('X');
  });

  test('treats 1-element coords as missing', () => {
    const stop = { name: 'X', coords: [44.88] };
    expect(stopToWaypoint(stop)).toBe('X');
  });

  test('treats empty-string address as missing', () => {
    const stop = { name: 'X', address: '   ' };
    expect(stopToWaypoint(stop)).toBe('X');
  });
});

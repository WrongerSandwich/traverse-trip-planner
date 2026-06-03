import { describe, test, expect } from 'vitest';
import { stopToWaypoint, mapsDirectionsUrl, mapsDeepLinkSummary } from '../src/lib/utils/maps-links.js';

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

describe('mapsDirectionsUrl', () => {
  test('assembles a single-stop URL with one waypoint', () => {
    const url = mapsDirectionsUrl([{ name: 'A', coords: [1, 2] }]);
    expect(url).toBe('https://www.google.com/maps/dir/?api=1&waypoints=1%2C2&travelmode=driving');
  });

  test('joins multiple waypoints with URL-encoded pipes', () => {
    const url = mapsDirectionsUrl([
      { coords: [1, 2] },
      { coords: [3, 4] },
      { coords: [5, 6] },
    ]);
    expect(url).toBe('https://www.google.com/maps/dir/?api=1&waypoints=1%2C2%7C3%2C4%7C5%2C6&travelmode=driving');
  });

  test('encodes address waypoints', () => {
    const url = mapsDirectionsUrl([{ address: '123 Main St, Empire MI' }]);
    expect(url).toContain('waypoints=123%20Main%20St%2C%20Empire%20MI');
  });

  test('caps at 11 stops when more are supplied', () => {
    const stops = Array.from({ length: 15 }, (_, i) => ({ name: `S${i + 1}` }));
    const url = mapsDirectionsUrl(stops);
    // First 11 names join with %7C; S12-S15 must NOT appear.
    expect(url).toContain('S1%7CS2');
    expect(url).toContain('S11&');           // S11 is the last waypoint
    expect(url).not.toContain('S12');
    expect(url).not.toContain('S15');
  });

  test('returns null when stops array is empty', () => {
    expect(mapsDirectionsUrl([])).toBeNull();
  });

  test('returns null when no stop yields a usable waypoint', () => {
    expect(mapsDirectionsUrl([{}, { coords: 'bad' }])).toBeNull();
  });

  test('skips stops with no usable encoding but uses the others', () => {
    const stops = [{ name: 'A' }, {}, { name: 'C' }];
    const url = mapsDirectionsUrl(stops);
    expect(url).toContain('waypoints=A%7CC');
  });

  test('respects travelMode override', () => {
    const url = mapsDirectionsUrl([{ name: 'A' }], { travelMode: 'walking' });
    expect(url).toContain('travelmode=walking');
  });
});

describe('mapsDeepLinkSummary', () => {
  test('returns null when no waypoints resolve', () => {
    expect(mapsDeepLinkSummary([])).toBeNull();
    expect(mapsDeepLinkSummary([{}])).toBeNull();
  });

  test('returns shape with url, waypointCount, truncated:false for in-range stops', () => {
    const result = mapsDeepLinkSummary([{ name: 'A' }, { name: 'B' }]);
    expect(result).toEqual({
      url: 'https://www.google.com/maps/dir/?api=1&waypoints=A%7CB&travelmode=driving',
      waypointCount: 2,
      truncated: false,
    });
  });

  test('marks truncated:true when more than 11 stops are supplied', () => {
    const stops = Array.from({ length: 13 }, (_, i) => ({ name: `S${i + 1}` }));
    const result = mapsDeepLinkSummary(stops);
    expect(result.truncated).toBe(true);
    expect(result.waypointCount).toBe(11);
  });

  test('waypointCount counts only usable stops, not raw input length', () => {
    // 3 usable + 2 unusable = 3 waypoints, truncated:false
    const result = mapsDeepLinkSummary([
      { name: 'A' },
      {},
      { name: 'B' },
      { coords: 'bad' },
      { name: 'C' },
    ]);
    expect(result.waypointCount).toBe(3);
    expect(result.truncated).toBe(false);
  });
});

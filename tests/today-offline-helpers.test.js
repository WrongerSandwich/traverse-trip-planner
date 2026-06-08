import { describe, it, expect } from 'vitest';
import {
  geoHref,
  arrayToObjCoords,
  normalizeStopCoords,
  normalizeDayCoords,
} from '../src/lib/today.js';

describe('geoHref', () => {
  it('builds a geo: URI with a pin label from {lat,lng}', () => {
    expect(geoHref({ lat: 42.4168, lng: -90.4287 }, 'Main Street')).toBe(
      'geo:42.4168,-90.4287?q=42.4168,-90.4287(Main%20Street)',
    );
  });

  it('omits the query when no label is given', () => {
    expect(geoHref({ lat: 1, lng: 2 })).toBe('geo:1,2');
  });

  it('returns null for missing coords', () => {
    expect(geoHref(null, 'X')).toBe(null);
    expect(geoHref(undefined)).toBe(null);
  });
});

describe('coord normalization', () => {
  it('arrayToObjCoords converts [lat,lng] to {lat,lng}', () => {
    expect(arrayToObjCoords([42.4, -90.4])).toEqual({ lat: 42.4, lng: -90.4 });
  });

  it('arrayToObjCoords passes through null and existing objects', () => {
    expect(arrayToObjCoords(null)).toBe(null);
    expect(arrayToObjCoords({ lat: 1, lng: 2 })).toEqual({ lat: 1, lng: 2 });
  });

  it('normalizeStopCoords normalizes a stop\'s coords array', () => {
    const out = normalizeStopCoords({ name: 'A', coords: [1, 2] });
    expect(out).toEqual({ name: 'A', coords: { lat: 1, lng: 2 } });
  });

  it('normalizeDayCoords normalizes stops and lodging', () => {
    const day = {
      n: 1,
      stops: [{ name: 'A', coords: [1, 2] }],
      lodging: { name: 'Inn', coords: [3, 4] },
    };
    const out = normalizeDayCoords(day);
    expect(out.stops[0].coords).toEqual({ lat: 1, lng: 2 });
    expect(out.lodging.coords).toEqual({ lat: 3, lng: 4 });
  });

  it('normalizeDayCoords leaves null lodging as null', () => {
    const out = normalizeDayCoords({ n: 1, stops: [], lodging: null });
    expect(out.lodging).toBe(null);
  });
});

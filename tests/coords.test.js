import { describe, it, expect } from 'vitest';
import { parseCoordInput } from '../src/lib/utils/coords.js';

// ── null / empty inputs ───────────────────────────────────────────────────────

describe('parseCoordInput — null / empty', () => {
  it('returns null for null', () => {
    expect(parseCoordInput(null)).toBe(null);
  });

  it('returns null for undefined', () => {
    expect(parseCoordInput(undefined)).toBe(null);
  });

  it('returns null for empty string', () => {
    expect(parseCoordInput('')).toBe(null);
  });

  it('returns null for whitespace-only string', () => {
    expect(parseCoordInput('   ')).toBe(null);
  });

  it('returns null for a single number', () => {
    expect(parseCoordInput('39.0686')).toBe(null);
  });

  it('returns null for three numbers', () => {
    expect(parseCoordInput('39.0686, -92.9457, 15')).toBe(null);
  });

  it('returns null for non-numeric garbage', () => {
    expect(parseCoordInput('nowhere, USA')).toBe(null);
  });
});

// ── bare lat/lon pairs ────────────────────────────────────────────────────────

describe('parseCoordInput — bare lat/lon pairs', () => {
  it('parses comma-space format', () => {
    expect(parseCoordInput('39.0686, -92.9457')).toEqual([39.0686, -92.9457]);
  });

  it('parses comma-only format (no space)', () => {
    expect(parseCoordInput('39.0686,-92.9457')).toEqual([39.0686, -92.9457]);
  });

  it('parses space-only format', () => {
    expect(parseCoordInput('39.0686 -92.9457')).toEqual([39.0686, -92.9457]);
  });

  it('trims leading/trailing whitespace', () => {
    expect(parseCoordInput('  39.0686, -92.9457  ')).toEqual([39.0686, -92.9457]);
  });

  it('parses integer coords (no decimal)', () => {
    expect(parseCoordInput('39, -92')).toEqual([39, -92]);
  });

  it('parses negative latitude (southern hemisphere)', () => {
    expect(parseCoordInput('-33.8688, 151.2093')).toEqual([-33.8688, 151.2093]);
  });

  it('returns [lat, lon] — first number is lat, second is lon', () => {
    const result = parseCoordInput('39.0686, -92.9457');
    expect(result[0]).toBeCloseTo(39.0686);
    expect(result[1]).toBeCloseTo(-92.9457);
  });
});

// ── validation: out-of-range values ─────────────────────────────────────────

describe('parseCoordInput — validation', () => {
  it('returns null for lat > 90', () => {
    expect(parseCoordInput('91, -92')).toBe(null);
  });

  it('returns null for lat < -90', () => {
    expect(parseCoordInput('-91, -92')).toBe(null);
  });

  it('returns null for lon > 180', () => {
    expect(parseCoordInput('39, 181')).toBe(null);
  });

  it('returns null for lon < -180', () => {
    expect(parseCoordInput('39, -181')).toBe(null);
  });

  it('accepts lat exactly at boundary (90, -90)', () => {
    expect(parseCoordInput('90, 0')).toEqual([90, 0]);
    expect(parseCoordInput('-90, 0')).toEqual([-90, 0]);
  });

  it('accepts lon exactly at boundary (180, -180)', () => {
    expect(parseCoordInput('0, 180')).toEqual([0, 180]);
    expect(parseCoordInput('0, -180')).toEqual([0, -180]);
  });
});

// ── Google Maps share URL (?q=) ───────────────────────────────────────────────

describe('parseCoordInput — Google Maps share URL', () => {
  it('parses ?q=lat,lon format', () => {
    const url = 'https://maps.google.com/?q=39.0686,-92.9457';
    expect(parseCoordInput(url)).toEqual([39.0686, -92.9457]);
  });

  it('parses www.google.com/maps?q= format', () => {
    const url = 'https://www.google.com/maps?q=39.0686,-92.9457';
    expect(parseCoordInput(url)).toEqual([39.0686, -92.9457]);
  });

  it('parses maps.google.com/?q= with extra params', () => {
    const url = 'https://maps.google.com/?q=39.0686,-92.9457&z=15';
    expect(parseCoordInput(url)).toEqual([39.0686, -92.9457]);
  });

  it('returns null for a Google Maps URL with no parseable coords', () => {
    expect(parseCoordInput('https://maps.google.com/?q=Arrow+Rock+MO')).toBe(null);
  });
});

// ── Google Maps place URL (/@lat,lon,zoom) ────────────────────────────────────

describe('parseCoordInput — Google Maps place/location URL', () => {
  it('parses /@lat,lon,zoom format (place URL)', () => {
    const url = 'https://www.google.com/maps/place/Arrow+Rock/@39.0686,-92.9457,15z/data=!4m5';
    expect(parseCoordInput(url)).toEqual([39.0686, -92.9457]);
  });

  it('parses /@lat,lon,zoom format (plain location URL)', () => {
    const url = 'https://www.google.com/maps/@39.0686,-92.9457,15z';
    expect(parseCoordInput(url)).toEqual([39.0686, -92.9457]);
  });

  it('extracts coords with high precision', () => {
    const url = 'https://www.google.com/maps/@39.0685967,-92.9457066,17z';
    const result = parseCoordInput(url);
    expect(result[0]).toBeCloseTo(39.0685967, 5);
    expect(result[1]).toBeCloseTo(-92.9457066, 5);
  });

  it('returns null for a Google Maps URL with no @lat,lon pattern', () => {
    expect(parseCoordInput('https://www.google.com/maps/dir/here/there')).toBe(null);
  });
});

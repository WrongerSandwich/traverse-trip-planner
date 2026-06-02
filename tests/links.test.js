import { describe, test, expect } from 'vitest';
import { mapsHref, telHref, websiteHref, hostLabel } from '../src/lib/utils/links.js';

describe('mapsHref', () => {
  test('encodes the address into a Google Maps search URL', () => {
    expect(mapsHref('123 Main St, Empire, MI 49630'))
      .toBe('https://www.google.com/maps/search/?api=1&query=123%20Main%20St%2C%20Empire%2C%20MI%2049630');
  });
  test('returns null for empty/null/non-string input', () => {
    expect(mapsHref('')).toBeNull();
    expect(mapsHref(null)).toBeNull();
    expect(mapsHref('   ')).toBeNull();
    expect(mapsHref(42)).toBeNull();
  });
});

describe('telHref', () => {
  test('strips non-digit chars but keeps a leading +', () => {
    expect(telHref('(555) 123-4567')).toBe('tel:5551234567');
    expect(telHref('+1 555 123 4567')).toBe('tel:+15551234567');
  });
  test('returns null when no digits', () => {
    expect(telHref('call us')).toBeNull();
    expect(telHref('')).toBeNull();
    expect(telHref(null)).toBeNull();
  });
});

describe('websiteHref', () => {
  test('returns the URL when it starts with http/https', () => {
    expect(websiteHref('https://example.com')).toBe('https://example.com');
    expect(websiteHref('http://example.com/path')).toBe('http://example.com/path');
    expect(websiteHref('HTTPS://example.com')).toBe('HTTPS://example.com');
  });
  test('returns null otherwise', () => {
    expect(websiteHref('example.com')).toBeNull();
    expect(websiteHref('')).toBeNull();
    expect(websiteHref(null)).toBeNull();
    expect(websiteHref('javascript:alert(1)')).toBeNull();
  });
});

describe('hostLabel', () => {
  test('extracts the hostname without www', () => {
    expect(hostLabel('https://www.example.com/path')).toBe('example.com');
    expect(hostLabel('http://example.com')).toBe('example.com');
  });
  test('returns the input back when not a parseable URL', () => {
    expect(hostLabel('whatever')).toBe('whatever');
    expect(hostLabel('')).toBe('');
  });
});

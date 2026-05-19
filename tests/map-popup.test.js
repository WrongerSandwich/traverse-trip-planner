// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { buildTripPopup, buildHomePopup } from '../src/lib/utils/mapPopup.js';

describe('buildTripPopup — XSS safety', () => {
  it('title with HTML payload is entity-encoded in innerHTML, not injected as live markup', () => {
    const trip = { title: '<img src=x onerror=alert(1)>', destination: 'Somewhere', _slug: 'test-trip' };
    const el = buildTripPopup(trip);
    // No raw <img> element should have been created as a child
    expect(el.querySelectorAll('img')).toHaveLength(0);
    // textContent must preserve the original string faithfully
    const strong = el.querySelector('strong');
    expect(strong).not.toBeNull();
    expect(strong.textContent).toBe('<img src=x onerror=alert(1)>');
  });

  it('destination with script payload is entity-encoded in innerHTML, not injected as live markup', () => {
    const trip = { title: 'My Trip', destination: '<script>alert(2)</script>', _slug: 'test-trip' };
    const el = buildTripPopup(trip);
    // No <script> element should have been created as a child
    expect(el.querySelectorAll('script')).toHaveLength(0);
    const small = el.querySelector('small');
    expect(small).not.toBeNull();
    expect(small.textContent).toBe('<script>alert(2)</script>');
  });

  it('falls back to _slug when title is absent', () => {
    const trip = { _slug: 'fallback-slug' };
    const el = buildTripPopup(trip);
    const strong = el.querySelector('strong');
    expect(strong.textContent).toBe('fallback-slug');
  });

  it('renders empty small when destination is absent', () => {
    const trip = { title: 'My Trip', _slug: 'test-trip' };
    const el = buildTripPopup(trip);
    const small = el.querySelector('small');
    expect(small.textContent).toBe('');
  });

  it('has a .map-popup-open button with the correct data-slug', () => {
    const trip = { title: 'My Trip', destination: 'Somewhere', _slug: 'my-trip' };
    const el = buildTripPopup(trip);
    const btn = el.querySelector('.map-popup-open');
    expect(btn).not.toBeNull();
    expect(btn.dataset.slug).toBe('my-trip');
    expect(btn.textContent).toBe('Open details →');
  });

  it('slug with HTML-special chars round-trips through data-slug without injecting new child elements', () => {
    const maliciousSlug = '"><script>bad</script>';
    const trip = { title: 'Trip', _slug: maliciousSlug };
    const el = buildTripPopup(trip);
    // No script element must have been injected
    expect(el.querySelectorAll('script')).toHaveLength(0);
    // dataset.slug must round-trip the value exactly (browser decodes attribute encoding)
    const btn = el.querySelector('.map-popup-open');
    expect(btn).not.toBeNull();
    expect(btn.dataset.slug).toBe(maliciousSlug);
  });
});

describe('buildHomePopup — XSS safety', () => {
  it('city with HTML payload is entity-encoded in innerHTML, not injected as live markup', () => {
    const home = { city: '<b onmouseover=alert(3)>Cityname</b>' };
    const el = buildHomePopup(home);
    // No <b> element should have been created as a child of strong
    const strong = el.querySelector('strong');
    expect(strong).not.toBeNull();
    expect(strong.querySelectorAll('b')).toHaveLength(0);
    // textContent must preserve the original string
    expect(strong.textContent).toBe('<b onmouseover=alert(3)>Cityname</b>');
  });

  it('renders "Home base" label as static text', () => {
    const home = { city: 'Kansas City' };
    const el = buildHomePopup(home);
    const small = el.querySelector('small');
    expect(small).not.toBeNull();
    expect(small.textContent).toBe('Home base');
  });

  it('handles missing city gracefully', () => {
    const el = buildHomePopup({});
    const strong = el.querySelector('strong');
    expect(strong.textContent).toBe('');
  });
});

import { describe, it, expect } from 'vitest';
import { renderOfflineToday } from '../src/lib/server/render-offline-today.js';

function sampleVM(overrides = {}) {
  return {
    title: 'Galena Driftless Weekend',
    destination: 'Galena, IL',
    generatedAt: new Date('2026-06-07T15:30:00Z'),
    defaultDay: 1,
    days: [
      {
        n: 1,
        date: '2026-08-14',
        stops: [
          {
            name: 'Main Street',
            category: 'historic',
            description: 'Preserved storefronts.',
            hours: 'Daily',
            address: 'Main St, Galena, IL',
            website: null,
            phone: null,
            coords: { lat: 42.4168, lng: -90.4287 },
            tips: ['Come early.'],
            todos: [],
          },
          {
            name: 'Galena History Museum',
            category: 'cultural',
            description: '',
            hours: '9am–4:30pm',
            address: '211 S Bench St',
            website: 'https://galenahistory.org',
            phone: '815-555-0142',
            coords: { lat: 42.4153, lng: -90.427 },
            tips: [],
            todos: [{ text: 'Buy tickets', done: false }],
          },
        ],
        lodging: {
          name: 'DeSoto House Hotel',
          coords: { lat: 42.4166, lng: -90.4286 },
          booking_url: 'https://desotohouse.com',
        },
      },
      {
        n: 2,
        date: '2026-08-15',
        stops: [],
        lodging: null,
      },
    ],
    fieldGuideNotes: ['Parking fills by midday.'],
    gotchas: ['Grant Home closed Mon–Tue.'],
    ...overrides,
  };
}

describe('renderOfflineToday', () => {
  it('produces a complete standalone HTML document', () => {
    const html = renderOfflineToday(sampleVM());
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('<style>');
    expect(html).toContain('</html>');
  });

  it('renders the trip title and a synced-as-of banner', () => {
    const html = renderOfflineToday(sampleVM());
    expect(html).toContain('Galena Driftless Weekend');
    expect(html).toMatch(/synced/i);
    expect(html).toContain('2026');
  });

  it('renders every day and all stops', () => {
    const html = renderOfflineToday(sampleVM());
    expect(html).toContain('Main Street');
    expect(html).toContain('Galena History Museum');
    expect(html).toContain('data-day="1"');
    expect(html).toContain('data-day="2"');
  });

  it('includes tel:, geo:, Maps, website, and booking links', () => {
    const html = renderOfflineToday(sampleVM());
    expect(html).toContain('tel:8155550142');
    expect(html).toContain('geo:42.4168,-90.4287');
    expect(html).toContain('https://www.google.com/maps/dir/?api=1&destination=42.4168,-90.4287');
    expect(html).toContain('https://galenahistory.org');
    expect(html).toContain('https://desotohouse.com');
  });

  it('omits the Tonight section on a day with no lodging', () => {
    const html = renderOfflineToday(sampleVM());
    const matches = html.match(/class="lodging-card"/g) || [];
    expect(matches.length).toBe(1);
  });

  it('renders field guide notes and gotchas', () => {
    const html = renderOfflineToday(sampleVM());
    expect(html).toContain('Parking fills by midday.');
    expect(html).toContain('Grant Home closed Mon–Tue.');
  });

  it('escapes HTML in trip-derived content', () => {
    const vm = sampleVM();
    vm.days[0].stops[0].name = 'Tom & Jerry <script>alert(1)</script>';
    const html = renderOfflineToday(vm);
    expect(html).toContain('Tom &amp; Jerry &lt;script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
  });

  it('embeds the default day for the switcher', () => {
    const html = renderOfflineToday(sampleVM({ defaultDay: 2 }));
    expect(html).toContain('data-default-day="2"');
  });

  it('escapes quotes in a valid-protocol website URL (no attribute breakout)', () => {
    const vm = sampleVM();
    vm.days[0].stops[1].website = 'https://evil.example/" onmouseover="alert(1)';
    const html = renderOfflineToday(vm);
    expect(html).not.toContain('onmouseover="alert(1)"');
    expect(html).toContain('&quot;'); // the embedded quote was escaped
  });

  it('drops a website value with no recognized protocol', () => {
    const vm = sampleVM();
    vm.days[0].stops[1].website = 'not a url';
    const html = renderOfflineToday(vm);
    expect(html).not.toContain('⤴ Site');
  });

  it('drops a javascript: website URL entirely (no link rendered)', () => {
    const vm = sampleVM();
    vm.days[0].stops[1].website = 'javascript:alert(1)';
    const html = renderOfflineToday(vm);
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('⤴ Site'); // the Site action is omitted
  });

  it('drops a javascript: booking URL but still renders lodging Navigate', () => {
    const vm = sampleVM();
    vm.days[0].lodging.booking_url = 'javascript:alert(1)';
    const html = renderOfflineToday(vm);
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('⤴ Booking');
    expect(html).toContain('class="lodging-card"'); // lodging still rendered
    expect(html).toContain('↗ Navigate'); // its Navigate link remains
  });

  it('contains no external subresource references', () => {
    const html = renderOfflineToday(sampleVM());
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<link');
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect(html).not.toContain('@import');
    expect(html).not.toMatch(/url\(\s*['"]?https?:/);
    const httpsCount = (html.match(/https:\/\//g) || []).length;
    const hrefHttpsCount = (html.match(/href="https:\/\//g) || []).length;
    expect(httpsCount).toBe(hrefHttpsCount);
  });
});

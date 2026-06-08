import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the data layer so no filesystem is needed.
vi.mock('../src/lib/server/data.js', () => ({
  rejectInvalidSlug: (slug) =>
    /^[a-z0-9-]+$/.test(slug) ? null : new Response('bad', { status: 400 }),
  enrichTrips: () =>
    Promise.resolve([
      { _slug: 'galena-illinois', title: 'Galena Driftless Weekend', destination: 'Galena, IL' },
    ]),
}));

const deriveBrochure = vi.fn();
vi.mock('../src/lib/server/derive-brochure.js', () => ({
  deriveBrochure: (slug) => deriveBrochure(slug),
}));

import { GET } from '../src/routes/trips/[slug]/today/offline/+server.js';

function brochure() {
  return {
    title: 'Galena Driftless Weekend',
    field_guide_notes: ['note'],
    gotchas: ['gotcha'],
    days: [
      { n: 1, date: '2026-08-14', stops: [
        { name: 'Main Street', category: 'historic', description: '', hours: '', address: 'Main St',
          website: null, phone: null, coords: [42.4, -90.4], tips: [], todos: [] },
      ], lodging: null },
    ],
  };
}

beforeEach(() => deriveBrochure.mockReset());

describe('GET /trips/[slug]/today/offline', () => {
  it('returns an HTML attachment with a slug-based filename', async () => {
    deriveBrochure.mockReturnValue(brochure());
    const res = await GET({ params: { slug: 'galena-illinois' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    expect(res.headers.get('content-disposition')).toBe(
      'attachment; filename="galena-illinois-today.html"',
    );
    const body = await res.text();
    expect(body).toMatch(/^<!doctype html>/i);
    expect(body).toContain('Main Street');
    expect(body).toContain('Galena, IL');
  });

  it('404s when the trip has no plan', async () => {
    deriveBrochure.mockReturnValue(null);
    const res = await GET({ params: { slug: 'no-plan' } });
    expect(res.status).toBe(404);
  });

  it('rejects an invalid slug before deriving', async () => {
    const res = await GET({ params: { slug: 'Bad Slug!' } });
    expect(res.status).toBe(400);
    expect(deriveBrochure).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@sveltejs/kit', () => ({
  json: (body, init = {}) => ({ _body: body, _status: init.status ?? 200 }),
  error: (status, msg) => { throw Object.assign(new Error(msg), { status }); },
}));

const mockGetTripRoute = vi.hoisted(() => vi.fn());

vi.mock('$lib/server/data.js', () => ({
  DATA_DIR: '/test-root/data',
  getTripRoute: mockGetTripRoute,
  rejectInvalidSlug: () => null,
}));

import { GET } from '../src/routes/api/route/[slug]/+server.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/route/[slug]', () => {
  it('returns 200 with coords when getTripRoute resolves', async () => {
    const coords = [[39.0, -94.0], [39.1, -94.2], [39.2, -94.4]];
    mockGetTripRoute.mockResolvedValue(coords);

    const res = await GET({ params: { slug: 'kc-loop' } });
    expect(res._status).toBe(200);
    expect(res._body).toEqual({ coords });
    expect(mockGetTripRoute).toHaveBeenCalledWith('kc-loop');
  });

  it('returns 404 when getTripRoute resolves to null (no waypoints / cache miss)', async () => {
    mockGetTripRoute.mockResolvedValue(null);

    const res = await GET({ params: { slug: 'no-waypoints' } });
    expect(res.status).toBe(404);
  });

  it('returns 404 when an external-service outage makes getTripRoute resolve null (#491)', async () => {
    // getTripRoute() now owns graceful degradation: on a Nominatim/OSRM outage
    // it catches and resolves null rather than throwing, so the endpoint emits
    // a 404 ("No route") and the map just renders without the line — never a
    // 500 in the client console.
    mockGetTripRoute.mockResolvedValue(null);

    const res = await GET({ params: { slug: 'osrm-down' } });
    expect(res.status).toBe(404);
  });
});

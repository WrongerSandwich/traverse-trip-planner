import { describe, it, expect, vi, beforeEach } from 'vitest';

const setStopCapture = vi.fn();
const setDayLog = vi.fn();
const invalidateEnrichCache = vi.fn();
let stage = 'planning';

vi.mock('$lib/server/data.js', () => ({
  rejectInvalidSlug: (s) => (/^[a-z0-9-]+$/.test(s) ? null : new Response('bad', { status: 400 })),
  rejectInvalidId: (id) => (/^[a-z0-9][a-z0-9-]{0,199}$/.test(id) ? null : new Response('bad id', { status: 400 })),
  invalidateEnrichCache: () => invalidateEnrichCache(),
  findTripLocation: () => ({ kind: 'dir', path: '/x', stage }),
}));
vi.mock('$lib/server/candidates.js', () => ({ setStopCapture: (...a) => setStopCapture(...a) }));
vi.mock('$lib/server/plan.js', () => ({ setDayLog: (...a) => setDayLog(...a) }));

import { PATCH as stopPATCH } from '../src/routes/api/capture/[slug]/stops/[id]/+server.js';
import { PATCH as dayPATCH } from '../src/routes/api/capture/[slug]/days/[number]/+server.js';

function req(body) { return { json: async () => body }; }
beforeEach(() => { stage = 'planning'; setStopCapture.mockReset(); setDayLog.mockReset(); invalidateEnrichCache.mockReset(); });

describe('PATCH capture stop', () => {
  it('sets status, invalidates cache, returns candidate', async () => {
    setStopCapture.mockReturnValue({ id: 'mill', status: 'visited' });
    const res = await stopPATCH({ params: { slug: 't', id: 'mill' }, request: req({ status: 'visited' }) });
    expect(res.status).toBe(200);
    expect(setStopCapture).toHaveBeenCalledWith('t', 'mill', { status: 'visited' });
    expect(invalidateEnrichCache).toHaveBeenCalled();
    expect((await res.json()).candidate.status).toBe('visited');
  });

  it('rejects an invalid status with invalid_input', async () => {
    const res = await stopPATCH({ params: { slug: 't', id: 'mill' }, request: req({ status: 'maybe' }) });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('invalid_input');
    expect(setStopCapture).not.toHaveBeenCalled();
  });

  it('rejects an over-length note', async () => {
    const res = await stopPATCH({ params: { slug: 't', id: 'mill' }, request: req({ note: 'x'.repeat(2001) }) });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('invalid_input');
  });

  it('404s when the stop is not found', async () => {
    setStopCapture.mockReturnValue(null);
    const res = await stopPATCH({ params: { slug: 't', id: 'nope' }, request: req({ status: 'visited' }) });
    expect(res.status).toBe(404);
  });

  it('rejects a completed trip with wrong_stage', async () => {
    stage = 'completed';
    const res = await stopPATCH({ params: { slug: 't', id: 'mill' }, request: req({ status: 'visited' }) });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('wrong_stage');
  });
});

describe('PATCH capture day', () => {
  it('sets the day log', async () => {
    setDayLog.mockReturnValue({ number: 1, log: 'Rainy' });
    const res = await dayPATCH({ params: { slug: 't', number: '1' }, request: req({ note: 'Rainy' }) });
    expect(res.status).toBe(200);
    expect(setDayLog).toHaveBeenCalledWith('t', 1, 'Rainy');
    expect(invalidateEnrichCache).toHaveBeenCalled();
  });

  it('404s for an unknown day', async () => {
    setDayLog.mockReturnValue(null);
    const res = await dayPATCH({ params: { slug: 't', number: '9' }, request: req({ note: 'x' }) });
    expect(res.status).toBe(404);
  });
});

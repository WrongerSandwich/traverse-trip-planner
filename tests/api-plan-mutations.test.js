import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@sveltejs/kit', () => ({
  json: (body, init = {}) => ({
    _body: body,
    status: init.status ?? 200,
  }),
}));

const mocks = vi.hoisted(() => ({
  addDay: vi.fn(),
  removeDay: vi.fn(),
  setDayMetadata: vi.fn(),
  addStopToDay: vi.fn(),
  reorderStops: vi.fn(),
  removeStopFromDay: vi.fn(),
  moveStopToDay: vi.fn(),
  setLodgingForDay: vi.fn(),
  promoteCandidateToDay: vi.fn(),
  unPromoteCandidate: vi.fn(),
}));
vi.mock('$lib/server/plan.js', () => mocks);

const dataMocks = vi.hoisted(() => ({
  invalidateEnrichCache: vi.fn(),
  // Mirror the real guard: reject anything containing '..', '/', or other
  // disallowed chars. Tests use slug 't' which passes; invalid-slug tests
  // explicitly pass '../etc/passwd' or similar.
  rejectInvalidSlug: vi.fn((slug) =>
    typeof slug === 'string' && /^[a-z0-9][a-z0-9-]{0,99}$/.test(slug)
      ? null
      : new Response('Invalid slug', { status: 400 }),
  ),
}));
vi.mock('$lib/server/data.js', () => dataMocks);

// Import the route handlers after mocking.
import { POST as addDayPost } from '../src/routes/api/plan/[slug]/+server.js';
import {
  DELETE as removeDayDelete,
  PATCH as setMetaPatch,
} from '../src/routes/api/plan/[slug]/day/[number]/+server.js';
import {
  POST as addStopPost,
  PUT as reorderPut,
} from '../src/routes/api/plan/[slug]/day/[number]/stops/+server.js';
import {
  DELETE as removeStopDelete,
  PATCH as moveStopPatch,
} from '../src/routes/api/plan/[slug]/day/[number]/stops/[id]/+server.js';
import { PUT as lodgingPut } from '../src/routes/api/plan/[slug]/day/[number]/lodging/+server.js';
import { POST as promotePost } from '../src/routes/api/plan/[slug]/promote/+server.js';
import { POST as unPromotePost } from '../src/routes/api/plan/[slug]/un-promote/+server.js';

function jsonReq(body, method = 'POST') {
  return new Request('http://x', {
    method,
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

function emptyReq(method = 'POST') {
  return new Request('http://x', { method });
}

describe('plan mutation API routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('POST /api/plan/[slug] calls addDay', async () => {
    const res = await addDayPost({
      params: { slug: 't' },
      request: emptyReq('POST'),
    });
    expect(mocks.addDay).toHaveBeenCalledWith('t');
    expect(res.status).toBe(200);
    expect(dataMocks.invalidateEnrichCache).toHaveBeenCalled();
  });

  it('DELETE /api/plan/[slug]/day/[number] calls removeDay with Number(number)', async () => {
    const res = await removeDayDelete({ params: { slug: 't', number: '2' } });
    expect(mocks.removeDay).toHaveBeenCalledWith('t', 2);
    expect(res.status).toBe(200);
  });

  it('PATCH /api/plan/[slug]/day/[number] calls setDayMetadata', async () => {
    const body = { date: '2026-07-01', drive_distance_mi: 120, notes: 'hello' };
    const res = await setMetaPatch({
      params: { slug: 't', number: '3' },
      request: jsonReq(body, 'PATCH'),
    });
    expect(mocks.setDayMetadata).toHaveBeenCalledWith('t', 3, body);
    expect(res.status).toBe(200);
  });

  it('POST /api/plan/[slug]/day/[number]/stops calls addStopToDay', async () => {
    const res = await addStopPost({
      params: { slug: 't', number: '1' },
      request: jsonReq({ id: 'lake-mcdonald' }, 'POST'),
    });
    expect(mocks.addStopToDay).toHaveBeenCalledWith('t', 1, 'lake-mcdonald');
    expect(res.status).toBe(200);
  });

  it('POST /api/plan/[slug]/day/[number]/stops returns 400 on missing id', async () => {
    const res = await addStopPost({
      params: { slug: 't', number: '1' },
      request: jsonReq({}, 'POST'),
    });
    expect(mocks.addStopToDay).not.toHaveBeenCalled();
    expect(res.status).toBe(400);
  });

  it('PUT /api/plan/[slug]/day/[number]/stops (reorder) calls reorderStops with body.order', async () => {
    const order = ['a', 'b', 'c'];
    const res = await reorderPut({
      params: { slug: 't', number: '2' },
      request: jsonReq({ order }, 'PUT'),
    });
    expect(mocks.reorderStops).toHaveBeenCalledWith('t', 2, order);
    expect(res.status).toBe(200);
  });

  it('PUT /api/plan/[slug]/day/[number]/stops returns 400 on missing order', async () => {
    const res = await reorderPut({
      params: { slug: 't', number: '2' },
      request: jsonReq({}, 'PUT'),
    });
    expect(mocks.reorderStops).not.toHaveBeenCalled();
    expect(res.status).toBe(400);
  });

  it('DELETE /api/plan/[slug]/day/[number]/stops/[id] calls removeStopFromDay', async () => {
    const res = await removeStopDelete({
      params: { slug: 't', number: '1', id: 'lake-mcdonald' },
    });
    expect(mocks.removeStopFromDay).toHaveBeenCalledWith('t', 1, 'lake-mcdonald');
    expect(res.status).toBe(200);
  });

  it('PATCH /api/plan/[slug]/day/[number]/stops/[id] calls moveStopToDay with body.toDay', async () => {
    const res = await moveStopPatch({
      params: { slug: 't', number: '1', id: 'lake-mcdonald' },
      request: jsonReq({ toDay: 2 }, 'PATCH'),
    });
    expect(mocks.moveStopToDay).toHaveBeenCalledWith('t', 1, 2, 'lake-mcdonald');
    expect(res.status).toBe(200);
  });

  it('PATCH /api/plan/[slug]/day/[number]/stops/[id] returns 400 on missing toDay', async () => {
    const res = await moveStopPatch({
      params: { slug: 't', number: '1', id: 'lake-mcdonald' },
      request: jsonReq({}, 'PATCH'),
    });
    expect(mocks.moveStopToDay).not.toHaveBeenCalled();
    expect(res.status).toBe(400);
  });

  it('PUT /api/plan/[slug]/day/[number]/lodging calls setLodgingForDay (set)', async () => {
    const res = await lodgingPut({
      params: { slug: 't', number: '2' },
      request: jsonReq({ id: 'whitefish-inn' }, 'PUT'),
    });
    expect(mocks.setLodgingForDay).toHaveBeenCalledWith('t', 2, 'whitefish-inn');
    expect(res.status).toBe(200);
  });

  it('PUT /api/plan/[slug]/day/[number]/lodging calls setLodgingForDay (clear with null)', async () => {
    const res = await lodgingPut({
      params: { slug: 't', number: '2' },
      request: jsonReq({ id: null }, 'PUT'),
    });
    expect(mocks.setLodgingForDay).toHaveBeenCalledWith('t', 2, null);
    expect(res.status).toBe(200);
  });

  it('POST /api/plan/[slug]/promote calls promoteCandidateToDay with parsed payload (id + day)', async () => {
    const res = await promotePost({
      params: { slug: 't' },
      request: jsonReq({ id: 'lake-mcdonald', day: 2 }, 'POST'),
    });
    expect(mocks.promoteCandidateToDay).toHaveBeenCalledWith('t', 'lake-mcdonald', 2);
    expect(res.status).toBe(200);
  });

  it('POST /api/plan/[slug]/promote defaults day to null when absent', async () => {
    const res = await promotePost({
      params: { slug: 't' },
      request: jsonReq({ id: 'lake-mcdonald' }, 'POST'),
    });
    expect(mocks.promoteCandidateToDay).toHaveBeenCalledWith('t', 'lake-mcdonald', null);
    expect(res.status).toBe(200);
  });

  it('POST /api/plan/[slug]/promote returns 400 on missing id', async () => {
    const res = await promotePost({
      params: { slug: 't' },
      request: jsonReq({}, 'POST'),
    });
    expect(mocks.promoteCandidateToDay).not.toHaveBeenCalled();
    expect(res.status).toBe(400);
  });

  it('POST /api/plan/[slug]/un-promote calls unPromoteCandidate', async () => {
    const res = await unPromotePost({
      params: { slug: 't' },
      request: jsonReq({ id: 'lake-mcdonald' }, 'POST'),
    });
    expect(mocks.unPromoteCandidate).toHaveBeenCalledWith('t', 'lake-mcdonald');
    expect(res.status).toBe(200);
  });

  it('POST /api/plan/[slug]/un-promote returns 400 on missing id', async () => {
    const res = await unPromotePost({
      params: { slug: 't' },
      request: jsonReq({}, 'POST'),
    });
    expect(mocks.unPromoteCandidate).not.toHaveBeenCalled();
    expect(res.status).toBe(400);
  });

  it('POST /api/plan/[slug] returns 400 for invalid slug and does not call addDay', async () => {
    const res = await addDayPost({
      params: { slug: '../etc/passwd' },
      request: emptyReq('POST'),
    });
    expect(res.status).toBe(400);
    expect(mocks.addDay).not.toHaveBeenCalled();
    expect(dataMocks.invalidateEnrichCache).not.toHaveBeenCalled();
  });

  it('PATCH /api/plan/[slug]/day/[number] returns 400 for invalid slug and does not touch plan', async () => {
    const res = await setMetaPatch({
      params: { slug: 'BadSlug!', number: '1' },
      request: jsonReq({ date: '2026-07-01' }, 'PATCH'),
    });
    expect(res.status).toBe(400);
    expect(mocks.setDayMetadata).not.toHaveBeenCalled();
  });

  it('returns 400 when plan.js throws (e.g. unknown candidate)', async () => {
    mocks.addStopToDay.mockImplementation(() => {
      throw new Error('unknown candidate: foo');
    });
    const res = await addStopPost({
      params: { slug: 't', number: '1' },
      request: jsonReq({ id: 'foo' }, 'POST'),
    });
    expect(res.status).toBe(400);
    expect(res._body).toEqual({ error: 'unknown candidate: foo' });
  });
});

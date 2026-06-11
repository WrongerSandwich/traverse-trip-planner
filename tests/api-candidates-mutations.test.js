import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@sveltejs/kit', () => ({
  json: (body, init = {}) => ({
    _body: body,
    status: init.status ?? 200,
  }),
}));

const mocks = vi.hoisted(() => ({
  addCandidateStop: vi.fn(() => 'new-id'),
  addCandidateLodging: vi.fn(() => 'inn-id'),
  deleteCandidate: vi.fn(),
  deleteCandidateStop: vi.fn(),
  deleteCandidateLodging: vi.fn(),
}));
vi.mock('$lib/server/candidates.js', () => ({
  addCandidateStop: mocks.addCandidateStop,
  addCandidateLodging: mocks.addCandidateLodging,
  deleteCandidate: mocks.deleteCandidate,
  deleteCandidateStop: mocks.deleteCandidateStop,
  deleteCandidateLodging: mocks.deleteCandidateLodging,
}));

const dataMocks = vi.hoisted(() => ({
  invalidateEnrichCache: vi.fn(),
  rejectInvalidSlug: vi.fn((slug) =>
    typeof slug === 'string' && /^[a-z0-9][a-z0-9-]{0,99}$/.test(slug)
      ? null
      : new Response('Invalid slug', { status: 400 }),
  ),
  rejectInvalidId: vi.fn((id) =>
    typeof id === 'string' && /^[a-z0-9][a-z0-9-]{0,199}$/.test(id)
      ? null
      : new Response('Invalid id', { status: 400 }),
  ),
}));
vi.mock('$lib/server/data.js', () => dataMocks);

import { POST as addStopPost } from '../src/routes/api/candidates/[slug]/stops/+server.js';
import { DELETE as deleteStop } from '../src/routes/api/candidates/[slug]/stops/[id]/+server.js';
import { POST as addLodgingPost } from '../src/routes/api/candidates/[slug]/lodging/+server.js';
import { DELETE as deleteLodging } from '../src/routes/api/candidates/[slug]/lodging/[id]/+server.js';

function jsonReq(body) {
  return new Request('http://x', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

describe('candidate mutation API routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('POST /api/candidates/[slug]/stops calls addCandidateStop and returns the assigned id', async () => {
    const res = await addStopPost({
      params: { slug: 't' },
      request: jsonReq({
        name: 'Lake',
        category: 'outdoors',
        description: 'd',
        why_recommended: 'w',
      }),
    });
    expect(mocks.addCandidateStop).toHaveBeenCalledWith(
      't',
      expect.objectContaining({ name: 'Lake', category: 'outdoors' }),
    );
    expect(res.status).toBe(200);
    expect(res._body.id).toBe('new-id');
    expect(dataMocks.invalidateEnrichCache).toHaveBeenCalled();
  });

  it('POST /api/candidates/[slug]/stops returns 400 on missing name', async () => {
    const res = await addStopPost({
      params: { slug: 't' },
      request: jsonReq({ category: 'outdoors' }),
    });
    expect(res.status).toBe(400);
    expect(mocks.addCandidateStop).not.toHaveBeenCalled();
  });

  it('POST /api/candidates/[slug]/stops returns invalid-slug guard for bad slug', async () => {
    const res = await addStopPost({
      params: { slug: '../etc' },
      request: jsonReq({ name: 'X' }),
    });
    expect(res.status).toBe(400);
    expect(mocks.addCandidateStop).not.toHaveBeenCalled();
  });

  it('DELETE /api/candidates/[slug]/stops/[id] calls deleteCandidateStop', async () => {
    const res = await deleteStop({ params: { slug: 't', id: 'lake' } });
    expect(mocks.deleteCandidateStop).toHaveBeenCalledWith('t', 'lake');
    expect(res.status).toBe(200);
    expect(dataMocks.invalidateEnrichCache).toHaveBeenCalled();
  });

  it('DELETE /api/candidates/[slug]/stops/[id] returns 400 for invalid slug', async () => {
    const res = await deleteStop({ params: { slug: '../etc', id: 'lake' } });
    expect(res.status).toBe(400);
    expect(mocks.deleteCandidateStop).not.toHaveBeenCalled();
  });

  it('DELETE /api/candidates/[slug]/stops/[id] returns 400 for malformed id (#496)', async () => {
    const res = await deleteStop({ params: { slug: 't', id: '../../home' } });
    expect(res.status).toBe(400);
    expect(mocks.deleteCandidateStop).not.toHaveBeenCalled();
  });

  it('POST /api/candidates/[slug]/lodging calls addCandidateLodging', async () => {
    const res = await addLodgingPost({
      params: { slug: 't' },
      request: jsonReq({ name: 'Inn', price_tier: 'mid' }),
    });
    expect(mocks.addCandidateLodging).toHaveBeenCalledWith(
      't',
      expect.objectContaining({ name: 'Inn', price_tier: 'mid' }),
    );
    expect(res.status).toBe(200);
    expect(res._body.id).toBe('inn-id');
    expect(dataMocks.invalidateEnrichCache).toHaveBeenCalled();
  });

  it('POST /api/candidates/[slug]/lodging returns 400 on missing name', async () => {
    const res = await addLodgingPost({
      params: { slug: 't' },
      request: jsonReq({ price_tier: 'mid' }),
    });
    expect(res.status).toBe(400);
    expect(mocks.addCandidateLodging).not.toHaveBeenCalled();
  });

  it('POST /api/candidates/[slug]/lodging returns invalid-slug guard for bad slug', async () => {
    const res = await addLodgingPost({
      params: { slug: '../etc' },
      request: jsonReq({ name: 'Inn' }),
    });
    expect(res.status).toBe(400);
    expect(mocks.addCandidateLodging).not.toHaveBeenCalled();
  });

  it('DELETE /api/candidates/[slug]/lodging/[id] calls deleteCandidateLodging', async () => {
    const res = await deleteLodging({ params: { slug: 't', id: 'inn' } });
    expect(mocks.deleteCandidateLodging).toHaveBeenCalledWith('t', 'inn');
    expect(res.status).toBe(200);
    expect(dataMocks.invalidateEnrichCache).toHaveBeenCalled();
  });

  it('DELETE /api/candidates/[slug]/lodging/[id] returns 400 for invalid slug', async () => {
    const res = await deleteLodging({ params: { slug: '../etc', id: 'inn' } });
    expect(res.status).toBe(400);
    expect(mocks.deleteCandidateLodging).not.toHaveBeenCalled();
  });

  it('returns 400 when candidates.js throws (e.g. duplicate name)', async () => {
    mocks.addCandidateStop.mockImplementationOnce(() => {
      throw new Error('duplicate candidate');
    });
    const res = await addStopPost({
      params: { slug: 't' },
      request: jsonReq({ name: 'Lake' }),
    });
    expect(res.status).toBe(400);
    expect(res._body).toEqual({ error: 'duplicate candidate' });
  });
});

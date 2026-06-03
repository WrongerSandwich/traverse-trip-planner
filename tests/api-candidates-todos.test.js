import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('@sveltejs/kit', () => ({
  json: (body, init = {}) => ({
    _body: body,
    status: init.status ?? 200,
  }),
}));

const mockSetTodoDone = vi.hoisted(() => vi.fn());
vi.mock('$lib/server/candidates.js', () => ({ setTodoDone: mockSetTodoDone }));

const dataMocks = vi.hoisted(() => ({
  invalidateEnrichCache: vi.fn(),
  rejectInvalidSlug: vi.fn((slug) =>
    typeof slug === 'string' && /^[a-z0-9][a-z0-9-]{0,99}$/.test(slug)
      ? null
      : new Response('Invalid slug', { status: 400 }),
  ),
}));
vi.mock('$lib/server/data.js', () => dataMocks);

import { PATCH } from '../src/routes/api/candidates/[slug]/stops/[id]/todos/[todoId]/+server.js';

function jsonReq(body) {
  return new Request('http://x', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => vi.clearAllMocks());

describe('PATCH todo done', () => {
  test('sets done and returns the updated stop', async () => {
    mockSetTodoDone.mockReturnValueOnce({ id: 'a', todos: [{ id: 't1', text: 'x', done: true }] });
    const res = await PATCH({ params: { slug: 'trip', id: 'a', todoId: 't1' }, request: jsonReq({ done: true }) });
    expect(mockSetTodoDone).toHaveBeenCalledWith('trip', 'a', 't1', true);
    expect(res.status).toBe(200);
    expect(res._body.ok).toBe(true);
    expect(res._body.candidate.todos[0].done).toBe(true);
    expect(dataMocks.invalidateEnrichCache).toHaveBeenCalled();
  });

  test('400 when done is not a boolean', async () => {
    const res = await PATCH({ params: { slug: 'trip', id: 'a', todoId: 't1' }, request: jsonReq({ done: 'yes' }) });
    expect(res.status).toBe(400);
    expect(mockSetTodoDone).not.toHaveBeenCalled();
  });

  test('404 when the stop or todo is missing', async () => {
    mockSetTodoDone.mockReturnValueOnce(null);
    const res = await PATCH({ params: { slug: 'trip', id: 'a', todoId: 'nope' }, request: jsonReq({ done: true }) });
    expect(res.status).toBe(404);
  });

  test('400 for invalid slug', async () => {
    const res = await PATCH({ params: { slug: '../etc', id: 'a', todoId: 't1' }, request: jsonReq({ done: true }) });
    expect(res.status).toBe(400);
    expect(mockSetTodoDone).not.toHaveBeenCalled();
  });
});

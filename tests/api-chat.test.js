import { describe, it, expect, vi, beforeEach } from 'vitest';

// Tests for the chat route's typed error handling.
// The chat route should return JSON { error: <code> } on failures
// rather than untyped text, so the UI can use failureSentence() from the registry.

vi.mock('$lib/server/data.js', () => ({
  readHomeMd: () => '# Home\nTest home context.',
  readPlanningTrip: (slug) =>
    slug === 'test-trip'
      ? {
          dir: '/tmp/test',
          frontmatter: 'title: Test Trip',
          sections: { overview: 'Test overview.' },
        }
      : null,
  writePlanningSection: vi.fn(),
  PLANNING_SECTIONS: ['overview', 'route', 'stops', 'logistics'],
  rejectInvalidSlug: () => null,
}));

vi.mock('$lib/server/config.js', () => ({
  getEffectiveConfig: () => ({
    features: { chat: { model: 'test-model' } },
  }),
  getFeatureAvailability: () => ({ homeMdReady: true }),
}));

const VALID_MESSAGES = [{ role: 'user', content: 'What should I know about parking?' }];

describe('POST /api/trip/[slug]/chat — existing behavior', () => {
  it('returns 404 when trip is not in planning stage', async () => {
    const { POST } = await import('../src/routes/api/trip/[slug]/chat/+server.js');
    const req = new Request('http://localhost/api/trip/nonexistent/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: VALID_MESSAGES }),
    });
    const res = await POST({ params: { slug: 'nonexistent' }, request: req });
    expect(res.status).toBe(404);
  });

  it('returns 400 when messages array is empty', async () => {
    const { POST } = await import('../src/routes/api/trip/[slug]/chat/+server.js');
    const req = new Request('http://localhost/api/trip/test-trip/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [] }),
    });
    const res = await POST({ params: { slug: 'test-trip' }, request: req });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/trip/[slug]/chat — typed error codes', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns JSON { error: "network_error" } on unexpected exceptions', async () => {
    vi.doMock('$lib/server/ai.js', () => ({
      chat: vi.fn().mockRejectedValue(new Error('Connection refused')),
    }));

    const { POST } = await import('../src/routes/api/trip/[slug]/chat/+server.js');
    const req = new Request('http://localhost/api/trip/test-trip/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: VALID_MESSAGES }),
    });
    const res = await POST({ params: { slug: 'test-trip' }, request: req });
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe('network_error');
  });

  it('returns JSON { error: "empty_model_output" } when chat() returns empty text', async () => {
    vi.doMock('$lib/server/ai.js', () => ({
      chat: vi.fn().mockResolvedValue({ text: '', usage: { input: 100, output: 0 } }),
    }));

    const { POST } = await import('../src/routes/api/trip/[slug]/chat/+server.js');
    const req = new Request('http://localhost/api/trip/test-trip/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: VALID_MESSAGES }),
    });
    const res = await POST({ params: { slug: 'test-trip' }, request: req });
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe('empty_model_output');
  });

  it('returns JSON { error: code } on TraverseError', async () => {
    const { TraverseError } = await import('../src/lib/server/errors.js');
    vi.doMock('$lib/server/ai.js', () => ({
      chat: vi.fn().mockRejectedValue(new TraverseError('timeout', 'Request timed out')),
    }));

    const { POST } = await import('../src/routes/api/trip/[slug]/chat/+server.js');
    const req = new Request('http://localhost/api/trip/test-trip/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: VALID_MESSAGES }),
    });
    const res = await POST({ params: { slug: 'test-trip' }, request: req });
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe('timeout');
  });

  it('returns JSON { error: "provider_error", context } on AdapterError', async () => {
    const { AdapterError } = await import('../src/lib/server/errors.js');
    vi.doMock('$lib/server/ai.js', () => ({
      chat: vi.fn().mockRejectedValue(
        new AdapterError({
          provider: 'Anthropic',
          model: 'claude-3',
          status: 429,
          summary: 'Rate limited',
          cause: 'Too many requests',
        }),
      ),
    }));

    const { POST } = await import('../src/routes/api/trip/[slug]/chat/+server.js');
    const req = new Request('http://localhost/api/trip/test-trip/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: VALID_MESSAGES }),
    });
    const res = await POST({ params: { slug: 'test-trip' }, request: req });
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe('provider_error');
    expect(body.context).toBeDefined();
    expect(body.context.provider).toBe('Anthropic');
    expect(body.context.summary).toBe('Rate limited');
  });

  it('returns tokens on success', async () => {
    vi.doMock('$lib/server/ai.js', () => ({
      chat: vi.fn().mockResolvedValue({
        text: '<reply>Here is the update.</reply>',
        usage: { input: 500, output: 300 },
      }),
    }));

    const { POST } = await import('../src/routes/api/trip/[slug]/chat/+server.js');
    const req = new Request('http://localhost/api/trip/test-trip/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: VALID_MESSAGES }),
    });
    const res = await POST({ params: { slug: 'test-trip' }, request: req });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tokens).toBe(800); // 500 + 300
    expect(body.reply).toBe('Here is the update.');
  });

  // Regression for #277: a concurrent deepen-section write (mtime advances
  // between chat's read and write) must produce a 409 with the
  // section_changed_during_chat code, not silently overwrite the deepen result.
  it('returns 409 section_changed_during_chat when a section mtime advances mid-call', async () => {
    // First statSync call (snapshot at handler start) returns mtime=1000;
    // second call (pre-write check) returns mtime=2000 — simulating a
    // concurrent writer that landed during the chat() await.
    let statCallNum = 0;
    vi.doMock('fs', () => ({
      existsSync: () => true,
      statSync: () => {
        statCallNum++;
        return { mtimeMs: statCallNum <= 4 ? 1000 : 2000 };
      },
    }));
    vi.doMock('$lib/server/ai.js', () => ({
      chat: vi.fn().mockResolvedValue({
        text: '<reply>Updated route.</reply>\n<update section="route">New route content.</update>',
        usage: { input: 100, output: 50 },
      }),
    }));

    const { POST } = await import('../src/routes/api/trip/[slug]/chat/+server.js');
    const req = new Request('http://localhost/api/trip/test-trip/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: VALID_MESSAGES }),
    });
    const res = await POST({ params: { slug: 'test-trip' }, request: req });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('section_changed_during_chat');
    expect(body.context?.section).toBe('route');
  });

  // Regression test for #279: when the model writes an <update section="overview">
  // block with new waypoints, the server must include `updates` in the response so
  // the client-side invalidateAll() call is triggered and card meta / map route
  // stay fresh without a manual reload.
  it('includes updates in response when model writes <update section="overview"> with new waypoints', async () => {
    const updatedOverview = `# Overview\n\nThis trip goes through Springfield and Branson.\n\nwaypoints: [Springfield MO, Branson MO]`;
    vi.doMock('$lib/server/ai.js', () => ({
      chat: vi.fn().mockResolvedValue({
        text: `<reply>I've updated the overview with new waypoints.</reply>\n<update section="overview">${updatedOverview}</update>`,
        usage: { input: 400, output: 200 },
      }),
    }));

    const { POST } = await import('../src/routes/api/trip/[slug]/chat/+server.js');
    const req = new Request('http://localhost/api/trip/test-trip/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: VALID_MESSAGES }),
    });
    const res = await POST({ params: { slug: 'test-trip' }, request: req });
    expect(res.status).toBe(200);
    const body = await res.json();
    // updates must be present so the client calls invalidateAll() (fix for #279)
    expect(body.updates).toBeDefined();
    expect(body.updates.overview).toBe(updatedOverview);
    expect(body.reply).toBe("I've updated the overview with new waypoints.");
  });
});

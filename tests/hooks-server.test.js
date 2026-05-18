import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Stub heavy startup side-effects so we can import hooks.server.js ──────────

vi.mock('dotenv/config', () => ({}));

vi.mock('node:fs', () => ({
  readdirSync: vi.fn(() => []),
  readFileSync: vi.fn(() => ''),
  writeFileSync: vi.fn(),
  existsSync: vi.fn(() => false),
  accessSync: vi.fn(),
  constants: { W_OK: 2 },
}));

vi.mock('node:path', async () => {
  const actual = await vi.importActual('node:path');
  return actual;
});

vi.mock('$lib/server/config.js', () => ({
  describeConfig: () => ({
    modelDefault: { provider: 'anthropic', model: 'test', ok: true },
    modelResearch: { provider: 'anthropic', model: 'test', ok: true },
    search: { provider: 'builtin', ok: true },
    features: {},
    issues: [],
  }),
}));

vi.mock('$lib/server/data.js', () => ({
  ROOT: '/test-root',
  parseFrontmatter: vi.fn(() => ({})),
  removeFrontmatterField: vi.fn((content) => content),
}));

vi.mock('$lib/server/jobs.js', () => ({
  sweepStaleJobs: vi.fn(),
}));

// Now import the handle hook
import { handle } from '../src/hooks.server.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a minimal SvelteKit event object. */
function makeEvent({
  method = 'GET',
  pathname = '/',
  host = 'localhost:3456',
  origin = null,
} = {}) {
  const headers = new Map();
  if (origin !== null) headers.set('origin', origin);

  return {
    request: {
      method,
      headers: { get: (k) => headers.get(k) ?? null },
    },
    url: new URL(`http://${host}${pathname}`),
  };
}

/** Resolve stub: returns a plain Response with status 200. */
function resolveOk() {
  return async () => new Response('ok', { status: 200 });
}

// ── Security headers ──────────────────────────────────────────────────────────

describe('handle — security headers', () => {
  it('sets X-Frame-Options: SAMEORIGIN on every response', async () => {
    const res = await handle({ event: makeEvent(), resolve: resolveOk() });
    expect(res.headers.get('x-frame-options')).toBe('SAMEORIGIN');
  });

  it('sets X-Content-Type-Options: nosniff', async () => {
    const res = await handle({ event: makeEvent(), resolve: resolveOk() });
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('sets Referrer-Policy: strict-origin-when-cross-origin', async () => {
    const res = await handle({ event: makeEvent(), resolve: resolveOk() });
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
  });

  it('sets Permissions-Policy that disables camera, mic, and geolocation', async () => {
    const res = await handle({ event: makeEvent(), resolve: resolveOk() });
    const pp = res.headers.get('permissions-policy');
    expect(pp).toContain('camera=()');
    expect(pp).toContain('microphone=()');
    expect(pp).toContain('geolocation=()');
  });

  it('sets Content-Security-Policy header', async () => {
    const res = await handle({ event: makeEvent(), resolve: resolveOk() });
    const csp = res.headers.get('content-security-policy');
    expect(csp).toBeTruthy();
    expect(csp).toContain("default-src 'self'");
  });

  it('CSP allows images from images.pexels.com', async () => {
    const res = await handle({ event: makeEvent(), resolve: resolveOk() });
    const csp = res.headers.get('content-security-policy');
    expect(csp).toContain('https://images.pexels.com');
  });

  it('CSP allows connect to nominatim.openstreetmap.org', async () => {
    const res = await handle({ event: makeEvent(), resolve: resolveOk() });
    const csp = res.headers.get('content-security-policy');
    expect(csp).toContain('https://nominatim.openstreetmap.org');
  });

  it('CSP allows connect to router.project-osrm.org', async () => {
    const res = await handle({ event: makeEvent(), resolve: resolveOk() });
    const csp = res.headers.get('content-security-policy');
    expect(csp).toContain('https://router.project-osrm.org');
  });

  it('CSP allows Leaflet tile images from *.tile.openstreetmap.org', async () => {
    const res = await handle({ event: makeEvent(), resolve: resolveOk() });
    const csp = res.headers.get('content-security-policy');
    expect(csp).toContain('*.tile.openstreetmap.org');
  });

  it('CSP disallows frames (frame-src none)', async () => {
    const res = await handle({ event: makeEvent(), resolve: resolveOk() });
    const csp = res.headers.get('content-security-policy');
    expect(csp).toContain("frame-src 'none'");
  });
});

// ── CSRF Origin check ─────────────────────────────────────────────────────────

describe('handle — CSRF Origin check', () => {
  // Non-GET /api/* with a cross-origin Origin header → 403
  it('returns 403 for a cross-origin POST to /api/home', async () => {
    const event = makeEvent({
      method: 'POST',
      pathname: '/api/home',
      host: 'traverse.local:3456',
      origin: 'https://evil.example',
    });
    const res = await handle({ event, resolve: resolveOk() });
    expect(res.status).toBe(403);
  });

  it('returns 403 for a cross-origin PUT to /api/actions/seed', async () => {
    const event = makeEvent({
      method: 'PUT',
      pathname: '/api/actions/seed',
      host: 'traverse.local:3456',
      origin: 'https://attacker.example',
    });
    const res = await handle({ event, resolve: resolveOk() });
    expect(res.status).toBe(403);
  });

  it('returns 403 for a cross-origin DELETE to /api/trip/foo', async () => {
    const event = makeEvent({
      method: 'DELETE',
      pathname: '/api/trip/foo',
      host: 'traverse.local:3456',
      origin: 'https://evil.example',
    });
    const res = await handle({ event, resolve: resolveOk() });
    expect(res.status).toBe(403);
  });

  // Same-origin POST → should pass through to resolve
  it('allows a same-origin POST to /api/home', async () => {
    const event = makeEvent({
      method: 'POST',
      pathname: '/api/home',
      host: 'traverse.local:3456',
      origin: 'http://traverse.local:3456',
    });
    const res = await handle({ event, resolve: resolveOk() });
    expect(res.status).toBe(200);
  });

  // No Origin header (same-origin browser requests, curl, server-to-server) → allowed
  it('allows a POST with no Origin header', async () => {
    const event = makeEvent({
      method: 'POST',
      pathname: '/api/home',
      host: 'traverse.local:3456',
      origin: null,
    });
    const res = await handle({ event, resolve: resolveOk() });
    expect(res.status).toBe(200);
  });

  // GET is always allowed regardless of Origin
  it('allows a cross-origin GET (CSRF check skipped for GET)', async () => {
    const event = makeEvent({
      method: 'GET',
      pathname: '/api/home',
      host: 'traverse.local:3456',
      origin: 'https://evil.example',
    });
    const res = await handle({ event, resolve: resolveOk() });
    expect(res.status).toBe(200);
  });

  // HEAD is also exempt
  it('allows a cross-origin HEAD (CSRF check skipped for HEAD)', async () => {
    const event = makeEvent({
      method: 'HEAD',
      pathname: '/api/home',
      host: 'traverse.local:3456',
      origin: 'https://evil.example',
    });
    const res = await handle({ event, resolve: resolveOk() });
    expect(res.status).toBe(200);
  });

  // Non-/api/* route not checked
  it('does not apply CSRF check to non-/api/* paths', async () => {
    const event = makeEvent({
      method: 'POST',
      pathname: '/trips/foo',
      host: 'traverse.local:3456',
      origin: 'https://evil.example',
    });
    const res = await handle({ event, resolve: resolveOk() });
    expect(res.status).toBe(200);
  });

  // Malformed Origin → 403
  it('returns 403 when Origin header is malformed', async () => {
    const event = makeEvent({
      method: 'POST',
      pathname: '/api/home',
      host: 'traverse.local:3456',
      origin: 'not-a-url',
    });
    const res = await handle({ event, resolve: resolveOk() });
    expect(res.status).toBe(403);
  });
});

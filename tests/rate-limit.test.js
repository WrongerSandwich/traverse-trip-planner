import { describe, it, expect, beforeEach } from 'vitest';
import { consume, rateLimitResponse, DEFAULT_LIMITS, _resetBucketsForTest } from '../src/lib/server/rate-limit.js';

beforeEach(() => {
  _resetBucketsForTest();
});

describe('consume — token bucket', () => {
  it('returns ok=true for the first request and decrements the bucket', () => {
    const r = consume('seed', '127.0.0.1');
    expect(r.ok).toBe(true);
    expect(r.remaining).toBe(DEFAULT_LIMITS.seed.capacity - 1);
  });

  it('allows up to capacity requests in immediate succession then denies', () => {
    const cap = DEFAULT_LIMITS.deepen.capacity;
    for (let i = 0; i < cap; i++) {
      expect(consume('deepen', 'ip').ok).toBe(true);
    }
    const denied = consume('deepen', 'ip');
    expect(denied.ok).toBe(false);
    expect(denied.retryAfterSec).toBeGreaterThanOrEqual(1);
  });

  it('keeps separate buckets per endpoint', () => {
    const cap = DEFAULT_LIMITS.deepen.capacity;
    for (let i = 0; i < cap; i++) consume('deepen', 'ip');
    // Same IP but different endpoint should still be allowed
    expect(consume('add', 'ip').ok).toBe(true);
  });

  it('keeps separate buckets per key (per-IP isolation)', () => {
    const cap = DEFAULT_LIMITS.seed.capacity;
    for (let i = 0; i < cap; i++) consume('seed', 'ip-a');
    expect(consume('seed', 'ip-a').ok).toBe(false);
    expect(consume('seed', 'ip-b').ok).toBe(true);
  });

  it('refills over time at the configured rate', () => {
    const cap = DEFAULT_LIMITS.add.capacity;
    const refill = DEFAULT_LIMITS.add.refillPerMinute;
    const now = 10_000_000;

    for (let i = 0; i < cap; i++) consume('add', 'k', now);
    expect(consume('add', 'k', now).ok).toBe(false);

    // Advance enough time for two refill events
    const advanceMs = Math.ceil((2 / refill) * 60_000);
    expect(consume('add', 'k', now + advanceMs).ok).toBe(true);
    expect(consume('add', 'k', now + advanceMs).ok).toBe(true);
    // Third immediate attempt at the same instant should fail again
    expect(consume('add', 'k', now + advanceMs).ok).toBe(false);
  });

  it('caps refill at capacity (does not over-fill on long idle)', () => {
    const cap = DEFAULT_LIMITS.deepen.capacity;
    const now = 10_000_000;
    consume('deepen', 'k', now);
    // Wait an hour — far more than enough to fully refill
    const later = now + 60 * 60_000;
    // After a full refill, we should have exactly `cap` tokens available
    let allowed = 0;
    for (let i = 0; i < cap + 5; i++) {
      if (consume('deepen', 'k', later).ok) allowed++;
    }
    expect(allowed).toBe(cap);
  });
});

describe('rateLimitResponse', () => {
  function makeEvent(ip = '127.0.0.1') {
    return { getClientAddress: () => ip };
  }

  it('returns null when under the limit', () => {
    const res = rateLimitResponse({ event: makeEvent(), endpoint: 'seed' });
    expect(res).toBeNull();
  });

  it('returns a 429 Response with Retry-After header when the bucket is empty', async () => {
    const cap = DEFAULT_LIMITS.deepen.capacity;
    const event = makeEvent('10.0.0.1');
    for (let i = 0; i < cap; i++) rateLimitResponse({ event, endpoint: 'deepen' });

    const denied = rateLimitResponse({ event, endpoint: 'deepen' });
    expect(denied).toBeInstanceOf(Response);
    expect(denied.status).toBe(429);
    expect(denied.headers.get('Retry-After')).toMatch(/^\d+$/);
    const body = await denied.json();
    expect(body.code).toBe('rate_limited');
    expect(body.retryAfterSec).toBeGreaterThanOrEqual(1);
  });

  it('uses slugKey to isolate per-trip buckets', () => {
    const event = makeEvent('10.0.0.2');
    const cap = DEFAULT_LIMITS.deepen.capacity;
    for (let i = 0; i < cap; i++) {
      rateLimitResponse({ event, endpoint: 'deepen', slugKey: 'trip-a' });
    }
    // Same IP, different slug — should still be allowed
    expect(rateLimitResponse({ event, endpoint: 'deepen', slugKey: 'trip-b' })).toBeNull();
    // Same IP, same slug — denied
    expect(rateLimitResponse({ event, endpoint: 'deepen', slugKey: 'trip-a' })).toBeInstanceOf(Response);
  });

  it('treats events without getClientAddress as "unknown"', () => {
    // Two requests with no IP both land in the same bucket
    const ev = {};
    const cap = DEFAULT_LIMITS.add.capacity;
    for (let i = 0; i < cap; i++) {
      expect(rateLimitResponse({ event: ev, endpoint: 'add' })).toBeNull();
    }
    expect(rateLimitResponse({ event: ev, endpoint: 'add' })).toBeInstanceOf(Response);
  });
});

describe('rateLimitResponse — env overrides', () => {
  beforeEach(() => {
    delete process.env.TRAVERSE_RATELIMIT_SEED_CAPACITY;
    delete process.env.TRAVERSE_RATELIMIT_SEED_REFILL_PER_MIN;
  });

  it('honors TRAVERSE_RATELIMIT_<ENDPOINT>_CAPACITY', () => {
    process.env.TRAVERSE_RATELIMIT_SEED_CAPACITY = '2';
    const event = { getClientAddress: () => 'env-test-ip' };

    expect(rateLimitResponse({ event, endpoint: 'seed' })).toBeNull();
    expect(rateLimitResponse({ event, endpoint: 'seed' })).toBeNull();
    expect(rateLimitResponse({ event, endpoint: 'seed' })).toBeInstanceOf(Response);
  });

  it('ignores non-numeric env values and falls back to defaults', () => {
    process.env.TRAVERSE_RATELIMIT_SEED_CAPACITY = 'not-a-number';
    const event = { getClientAddress: () => 'env-test-ip-2' };

    // Should not throw, falls back to default capacity (5)
    const cap = DEFAULT_LIMITS.seed.capacity;
    for (let i = 0; i < cap; i++) {
      expect(rateLimitResponse({ event, endpoint: 'seed' })).toBeNull();
    }
    expect(rateLimitResponse({ event, endpoint: 'seed' })).toBeInstanceOf(Response);
  });
});

describe('DEFAULT_LIMITS — new explicit entries', () => {
  it('has an explicit image-search entry', () => {
    expect(DEFAULT_LIMITS['image-search']).toBeDefined();
    expect(DEFAULT_LIMITS['image-search'].capacity).toBeGreaterThan(0);
    expect(DEFAULT_LIMITS['image-search'].refillPerMinute).toBeGreaterThan(0);
  });

  it('has an explicit geocode entry', () => {
    expect(DEFAULT_LIMITS['geocode']).toBeDefined();
    expect(DEFAULT_LIMITS['geocode'].capacity).toBeGreaterThan(0);
    expect(DEFAULT_LIMITS['geocode'].refillPerMinute).toBeGreaterThan(0);
  });
});

describe('rateLimitResponse — TRUST_PROXY_FOR_AUTH', () => {
  function makeProxyEvent({ clientAddress = '127.0.0.1', xff = null } = {}) {
    const headers = new Headers();
    if (xff) headers.set('x-forwarded-for', xff);
    return {
      request: { headers },
      getClientAddress: () => clientAddress,
    };
  }

  beforeEach(() => {
    delete process.env.TRUST_PROXY_FOR_AUTH;
  });

  it('keys per real client IP when TRUST_PROXY_FOR_AUTH=1 (single-hop XFF)', () => {
    process.env.TRUST_PROXY_FOR_AUTH = '1';
    const cap = DEFAULT_LIMITS.deepen.capacity;
    // Both requests arrive at the same socket addr (the proxy) but XFF
    // identifies two distinct real clients — they must get separate buckets.
    for (let i = 0; i < cap; i++) {
      rateLimitResponse({ event: makeProxyEvent({ xff: '203.0.113.5' }), endpoint: 'deepen' });
    }
    expect(
      rateLimitResponse({ event: makeProxyEvent({ xff: '203.0.113.5' }), endpoint: 'deepen' }),
    ).toBeInstanceOf(Response);
    expect(
      rateLimitResponse({ event: makeProxyEvent({ xff: '203.0.113.6' }), endpoint: 'deepen' }),
    ).toBeNull();
  });

  it('falls back to socket address on multi-hop XFF (cannot trust the chain)', () => {
    process.env.TRUST_PROXY_FOR_AUTH = '1';
    const cap = DEFAULT_LIMITS.deepen.capacity;
    // Multi-hop XFF means clientIpFor returns null. Two requests with
    // different (spoofed) XFFs that share a socket addr must share a
    // bucket — no per-spoofed-IP bypass of the rate limit.
    const ev = (xff) => makeProxyEvent({ clientAddress: '10.0.0.99', xff });
    for (let i = 0; i < cap; i++) {
      rateLimitResponse({ event: ev('1.1.1.1, 10.0.0.99'), endpoint: 'deepen' });
    }
    expect(
      rateLimitResponse({ event: ev('2.2.2.2, 10.0.0.99'), endpoint: 'deepen' }),
    ).toBeInstanceOf(Response);
  });

  it('ignores XFF when TRUST_PROXY_FOR_AUTH is unset', () => {
    const cap = DEFAULT_LIMITS.deepen.capacity;
    for (let i = 0; i < cap; i++) {
      rateLimitResponse({ event: makeProxyEvent({ xff: '203.0.113.5' }), endpoint: 'deepen' });
    }
    // Without the env var, the rate limiter sees the same socket addr for
    // both — second client (different XFF) gets the same bucket.
    expect(
      rateLimitResponse({ event: makeProxyEvent({ xff: '203.0.113.6' }), endpoint: 'deepen' }),
    ).toBeInstanceOf(Response);
  });
});

describe('rateLimitResponse — image-search endpoint (per-IP, no slugKey)', () => {
  function makeEvent(ip = '10.5.5.5') {
    return { getClientAddress: () => ip };
  }

  it('allows up to image-search capacity then denies', () => {
    const event = makeEvent('10.6.6.6');
    const cap = DEFAULT_LIMITS['image-search'].capacity;
    for (let i = 0; i < cap; i++) {
      expect(rateLimitResponse({ event, endpoint: 'image-search' })).toBeNull();
    }
    const denied = rateLimitResponse({ event, endpoint: 'image-search' });
    expect(denied).toBeInstanceOf(Response);
    expect(denied.status).toBe(429);
  });

  it('isolates buckets across different IPs', () => {
    const evA = makeEvent('10.7.7.7');
    const evB = makeEvent('10.8.8.8');
    const cap = DEFAULT_LIMITS['image-search'].capacity;
    for (let i = 0; i < cap; i++) {
      rateLimitResponse({ event: evA, endpoint: 'image-search' });
    }
    // IP A is drained; IP B should still be allowed
    expect(rateLimitResponse({ event: evB, endpoint: 'image-search' })).toBeNull();
    expect(rateLimitResponse({ event: evA, endpoint: 'image-search' })).toBeInstanceOf(Response);
  });
});

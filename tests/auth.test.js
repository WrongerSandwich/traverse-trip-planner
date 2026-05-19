import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isAllowedConfigWrite, denyIfNotConfigWriter } from '../src/lib/server/auth.js';

function evt({ clientAddress = '127.0.0.1', xff = null } = {}) {
  const headers = new Headers();
  if (xff) headers.set('x-forwarded-for', xff);
  return {
    request: { headers },
    getClientAddress: () => clientAddress,
  };
}

const SAVED = { ...process.env };
beforeEach(() => {
  delete process.env.TRAVERSE_ALLOW_LAN_WRITES;
  delete process.env.TRUST_PROXY_FOR_AUTH;
});
afterEach(() => {
  delete process.env.TRAVERSE_ALLOW_LAN_WRITES;
  delete process.env.TRUST_PROXY_FOR_AUTH;
  if (SAVED.TRAVERSE_ALLOW_LAN_WRITES !== undefined) process.env.TRAVERSE_ALLOW_LAN_WRITES = SAVED.TRAVERSE_ALLOW_LAN_WRITES;
  if (SAVED.TRUST_PROXY_FOR_AUTH !== undefined) process.env.TRUST_PROXY_FOR_AUTH = SAVED.TRUST_PROXY_FOR_AUTH;
});

describe('isAllowedConfigWrite — default loopback gate', () => {
  it('allows 127.0.0.1', () => {
    expect(isAllowedConfigWrite(evt({ clientAddress: '127.0.0.1' }))).toBe(true);
  });

  it('allows ::1', () => {
    expect(isAllowedConfigWrite(evt({ clientAddress: '::1' }))).toBe(true);
  });

  it('allows IPv4-mapped IPv6 loopback', () => {
    expect(isAllowedConfigWrite(evt({ clientAddress: '::ffff:127.0.0.1' }))).toBe(true);
  });

  it('rejects a LAN address by default', () => {
    expect(isAllowedConfigWrite(evt({ clientAddress: '192.168.1.42' }))).toBe(false);
  });

  it('rejects an arbitrary remote address', () => {
    expect(isAllowedConfigWrite(evt({ clientAddress: '10.0.0.5' }))).toBe(false);
  });
});

describe('TRAVERSE_ALLOW_LAN_WRITES=1', () => {
  it('opens the gate even for non-loopback callers', () => {
    process.env.TRAVERSE_ALLOW_LAN_WRITES = '1';
    expect(isAllowedConfigWrite(evt({ clientAddress: '192.168.1.42' }))).toBe(true);
  });

  it('does not engage on any other value', () => {
    process.env.TRAVERSE_ALLOW_LAN_WRITES = 'true'; // not '1'
    expect(isAllowedConfigWrite(evt({ clientAddress: '192.168.1.42' }))).toBe(false);
  });
});

describe('TRUST_PROXY_FOR_AUTH=1', () => {
  it('reads first hop of X-Forwarded-For when set', () => {
    process.env.TRUST_PROXY_FOR_AUTH = '1';
    // Caddy on loopback forwards the real client IP.
    expect(isAllowedConfigWrite(evt({ clientAddress: '127.0.0.1', xff: '192.168.1.42' }))).toBe(false);
    expect(isAllowedConfigWrite(evt({ clientAddress: '127.0.0.1', xff: '127.0.0.1' }))).toBe(true);
  });

  it('falls back to socket address when X-Forwarded-For is missing', () => {
    process.env.TRUST_PROXY_FOR_AUTH = '1';
    expect(isAllowedConfigWrite(evt({ clientAddress: '127.0.0.1' }))).toBe(true);
  });

  it('handles a comma-separated chain (takes first hop)', () => {
    process.env.TRUST_PROXY_FOR_AUTH = '1';
    expect(isAllowedConfigWrite(evt({ clientAddress: '127.0.0.1', xff: '192.168.1.42, 127.0.0.1' }))).toBe(false);
  });

  it('is ignored when TRUST_PROXY_FOR_AUTH is unset', () => {
    expect(isAllowedConfigWrite(evt({ clientAddress: '127.0.0.1', xff: '192.168.1.42' }))).toBe(true);
  });
});

describe('denyIfNotConfigWriter', () => {
  it('returns null when allowed', () => {
    expect(denyIfNotConfigWriter(evt({ clientAddress: '127.0.0.1' }))).toBe(null);
  });

  it('returns a 403 Response shape when denied', () => {
    const res = denyIfNotConfigWriter(evt({ clientAddress: '192.168.1.42' }));
    expect(res).not.toBe(null);
    // The stubbed json() helper in route tests returns { _body, _status };
    // here we hit the real @sveltejs/kit json() which returns a Response.
    expect(res.status).toBe(403);
  });
});

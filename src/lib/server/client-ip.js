/**
 * Trusted-client-IP resolver. Lives in its own module (not auth.js or
 * rate-limit.js) so the early-loaded `tests/setup.js` import chain doesn't
 * pull in `@sveltejs/kit` before per-file `vi.mock` factories register.
 *
 * - Without `TRUST_PROXY_FOR_AUTH=1`: returns SvelteKit's socket address.
 * - With `TRUST_PROXY_FOR_AUTH=1` and a single-hop X-Forwarded-For: returns
 *   that hop.
 * - With `TRUST_PROXY_FOR_AUTH=1` and a multi-hop XFF: returns `null` —
 *   "we cannot identify a trusted client, callers should fail closed."
 *   Multi-hop is the symptom of a proxy that appends to a client-supplied
 *   `X-Forwarded-For` (typical `proxy_add_x_forwarded_for` nginx misconfig);
 *   trusting any single position lets a LAN attacker spoof a loopback
 *   address by sending `X-Forwarded-For: 127.0.0.1`.
 * - Missing XFF under `TRUST_PROXY_FOR_AUTH=1`: falls back to the socket
 *   address (the proxy itself, typically loopback).
 */
export function clientIpFor(event) {
  if (process.env.TRUST_PROXY_FOR_AUTH !== '1') {
    return event.getClientAddress();
  }
  const fwd = event.request.headers.get('x-forwarded-for');
  if (!fwd) return event.getClientAddress();
  const hops = fwd.split(',').map((s) => s.trim()).filter(Boolean);
  if (hops.length === 0) return event.getClientAddress();
  if (hops.length > 1) return null;
  return hops[0];
}

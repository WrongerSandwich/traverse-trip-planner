import { json } from '@sveltejs/kit';
import { clientIpFor } from './client-ip.js';

/**
 * Threat model for config-write authorization
 * ============================================
 *
 * The CSRF Origin check in hooks.server.js blocks cross-origin browser
 * requests to /api/*, but it does NOT stop direct curl/script requests from
 * anywhere the host is reachable. For endpoints that accept credentials
 * (settings.json provider keys) or personal data that drives every AI prompt
 * (home.md), this means an attacker on the same LAN — a misconfigured reverse
 * proxy, another container with network access, an unrelated device on the
 * home Wi-Fi — could swap the provider to an attacker-controlled endpoint
 * (exfiltrating every prompt including home.md) or rewrite home.md to corrupt
 * trip planning.
 *
 * Default posture: config writes require the request to originate from
 * loopback (127.0.0.1, ::1, or the IPv4-mapped IPv6 form). Two env vars
 * relax the gate when the deployment shape requires it:
 *
 *   TRAVERSE_ALLOW_LAN_WRITES=1
 *     Disable the loopback gate entirely. Appropriate when the deployment is
 *     on a network where every device that can reach the API is trusted by
 *     the operator (typical solo home-server case). Make this explicit; do
 *     not set it as a reflex.
 *
 *   TRUST_PROXY_FOR_AUTH=1
 *     Read X-Forwarded-For as the client address instead of the socket
 *     address. Required when running behind a reverse proxy (Caddy, nginx)
 *     that terminates on loopback. The proxy must produce a single-hop XFF
 *     by *overwriting* (not appending to) any inbound value — multi-hop
 *     chains are rejected as untrusted (clientIpFor returns null, the gate
 *     denies). See docs/deploy.md for the working nginx + Caddy snippets.
 *
 * If TRAVERSE_ALLOW_LAN_WRITES=1 is set, the source IP is not consulted
 * (the gate is fully open). TRUST_PROXY_FOR_AUTH only matters when the gate
 * is active.
 *
 * Endpoints to gate: any endpoint that writes credentials, secrets, or
 * personal data used to shape AI prompts. Right now that is the settings POST
 * and the home PUT. AI-quota-spending content endpoints (seed, add, deepen,
 * brochure prepare) stay open by default — they're protected by the existing
 * CSRF Origin check and the per-endpoint rate limits in
 * src/lib/server/rate-limit.js, and gating them would break ordinary phone /
 * laptop use on the home LAN.
 */

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export { clientIpFor };

export function isAllowedConfigWrite(event) {
  if (process.env.TRAVERSE_ALLOW_LAN_WRITES === '1') return true;
  const ip = clientIpFor(event);
  if (ip === null) return false;
  return LOOPBACK.has(ip);
}

export function denyIfNotConfigWriter(event) {
  if (isAllowedConfigWrite(event)) return null;
  return json(
    {
      error:
        'Config writes are restricted to loopback by default. Set TRAVERSE_ALLOW_LAN_WRITES=1 to permit LAN writes (after confirming the network is trusted), or set TRUST_PROXY_FOR_AUTH=1 if running behind a reverse proxy that sets X-Forwarded-For.',
      code: 'forbidden_remote_write',
    },
    { status: 403 },
  );
}

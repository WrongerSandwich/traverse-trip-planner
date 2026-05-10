import { createHmac, timingSafeEqual } from 'crypto';

const SIG_LEN = 16; // first 16 chars of base64url HMAC — ~96 bits, plenty for personal use

function getSecret() {
  return process.env.TRAVERSE_SHARE_SECRET || '';
}

export function shareEnabled() {
  return Boolean(getSecret());
}

/**
 * Produce a share token: base64url(slug) + "." + first 16 chars of HMAC.
 * Token is deterministic — same slug + secret always yields the same token.
 * Returns null if TRAVERSE_SHARE_SECRET is unset.
 */
export function makeShareToken(slug) {
  const secret = getSecret();
  if (!secret) return null;
  const hmac = createHmac('sha256', secret).update(slug).digest('base64url').slice(0, SIG_LEN);
  const encoded = Buffer.from(slug).toString('base64url');
  return `${encoded}.${hmac}`;
}

/**
 * Verify a share token. Returns the slug if valid, null otherwise.
 * Uses constant-time comparison on the HMAC portion to defeat timing attacks.
 */
export function verifyShareToken(token) {
  const secret = getSecret();
  if (!secret || typeof token !== 'string') return null;
  const dot = token.lastIndexOf('.');
  if (dot < 1) return null;
  const encoded = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (sig.length !== SIG_LEN) return null;

  let slug;
  try {
    slug = Buffer.from(encoded, 'base64url').toString();
  } catch {
    return null;
  }
  if (!slug || /[^a-z0-9-]/i.test(slug)) return null; // sanity: slug shape

  const expected = createHmac('sha256', secret).update(slug).digest('base64url').slice(0, SIG_LEN);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  return timingSafeEqual(a, b) ? slug : null;
}

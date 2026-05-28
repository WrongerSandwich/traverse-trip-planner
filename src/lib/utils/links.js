// Link helpers for per-stop metadata fields. Pure functions — no platform
// sniffing, no SSR detection. URL builders only.

const HTTP_RE = /^https?:\/\//i;

export function mapsHref(address) {
  if (!address || typeof address !== 'string') return null;
  const trimmed = address.trim();
  if (!trimmed) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(trimmed)}`;
}

export function telHref(phone) {
  if (!phone || typeof phone !== 'string') return null;
  const hasPlus = phone.trim().startsWith('+');
  const digits = phone.replace(/\D/g, '');
  if (!digits) return null;
  return `tel:${hasPlus ? '+' : ''}${digits}`;
}

export function websiteHref(url) {
  if (!url || typeof url !== 'string') return null;
  return HTTP_RE.test(url) ? url : null;
}

export function hostLabel(url) {
  if (!url || typeof url !== 'string') return url;
  try {
    const u = new URL(url);
    return u.host.replace(/^www\./i, '');
  } catch {
    return url;
  }
}

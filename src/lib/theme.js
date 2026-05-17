/**
 * Theme controller. Pure functions with optional DI for tests.
 *
 * - getStoredTheme(): user's explicit preference ('system' | 'light' | 'dark').
 * - getResolvedTheme(stored, mq): the effective value after resolving 'system'.
 * - applyTheme(resolved, doc): writes data-theme to <html> and updates meta.
 * - setTheme(value, deps): persists + applies; returns the resolved value.
 * - subscribeToSystemTheme(handler, deps): notifies when OS pref changes.
 *
 * All functions default to globals (localStorage, document, window.matchMedia)
 * but accept overrides so tests don't need a DOM environment.
 */

export const THEME_KEY = 'traverse-theme';
export const THEME_COLOR_LIGHT = '#1F4332';
export const THEME_COLOR_DARK  = '#0D1A12';

const VALID = new Set(['system', 'light', 'dark']);

function defaultStorage() {
  return typeof localStorage !== 'undefined' ? localStorage : null;
}

function defaultDoc() {
  return typeof document !== 'undefined' ? document : null;
}

function defaultMq() {
  if (typeof window === 'undefined' || !window.matchMedia) return null;
  return window.matchMedia('(prefers-color-scheme: dark)');
}

export function getStoredTheme(storage = defaultStorage()) {
  if (!storage) return 'system';
  try {
    const v = storage.getItem(THEME_KEY);
    return VALID.has(v) ? v : 'system';
  } catch {
    return 'system';
  }
}

export function getResolvedTheme(stored, mq = defaultMq()) {
  if (stored === 'light' || stored === 'dark') return stored;
  return mq?.matches ? 'dark' : 'light';
}

export function applyTheme(resolved, doc = defaultDoc()) {
  if (!doc) return;
  doc.documentElement.dataset.theme = resolved;
  const meta = doc.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute('content', resolved === 'dark' ? THEME_COLOR_DARK : THEME_COLOR_LIGHT);
  }
}

export function setTheme(value, deps = {}) {
  const storage = deps.storage ?? defaultStorage();
  const doc     = deps.doc     ?? defaultDoc();
  const mq      = deps.mq      ?? defaultMq();
  if (storage) {
    try { storage.setItem(THEME_KEY, value); } catch { /* private mode, ignore */ }
  }
  const resolved = getResolvedTheme(value, mq);
  applyTheme(resolved, doc);
  return resolved;
}

export function subscribeToSystemTheme(handler, deps = {}) {
  const mq = deps.mq ?? defaultMq();
  if (!mq?.addEventListener) return () => {};
  const listener = (e) => handler(e.matches ? 'dark' : 'light');
  mq.addEventListener('change', listener);
  return () => mq.removeEventListener('change', listener);
}

import { describe, it, expect, vi } from 'vitest';
import {
  THEME_KEY,
  getStoredTheme,
  getResolvedTheme,
  applyTheme,
  setTheme,
  subscribeToSystemTheme,
} from '../src/lib/theme.js';

function makeStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: vi.fn((k) => (k in data ? data[k] : null)),
    setItem: vi.fn((k, v) => { data[k] = String(v); }),
    removeItem: vi.fn((k) => { delete data[k]; }),
    _data: data,
  };
}

function makeMq(matches = false) {
  const listeners = new Set();
  return {
    matches,
    addEventListener: vi.fn((_, fn) => listeners.add(fn)),
    removeEventListener: vi.fn((_, fn) => listeners.delete(fn)),
    _emit: (m) => listeners.forEach((fn) => fn({ matches: m })),
  };
}

function makeDoc() {
  const meta = { getAttribute: vi.fn(), setAttribute: vi.fn() };
  const doc = {
    documentElement: { dataset: {} },
    querySelector: vi.fn((sel) => (sel === 'meta[name="theme-color"]' ? meta : null)),
  };
  doc._meta = meta;
  return doc;
}

describe('theme.js', () => {
  describe('getStoredTheme', () => {
    it('returns "system" when storage is empty', () => {
      expect(getStoredTheme(makeStorage())).toBe('system');
    });

    it('returns saved value when valid', () => {
      expect(getStoredTheme(makeStorage({ [THEME_KEY]: 'dark' }))).toBe('dark');
      expect(getStoredTheme(makeStorage({ [THEME_KEY]: 'light' }))).toBe('light');
      expect(getStoredTheme(makeStorage({ [THEME_KEY]: 'system' }))).toBe('system');
    });

    it('returns "system" when saved value is invalid', () => {
      expect(getStoredTheme(makeStorage({ [THEME_KEY]: 'neon' }))).toBe('system');
    });

    it('returns "system" when storage is unavailable', () => {
      expect(getStoredTheme(null)).toBe('system');
    });

    it('returns "system" when storage.getItem throws', () => {
      const storage = { getItem: () => { throw new Error('denied'); } };
      expect(getStoredTheme(storage)).toBe('system');
    });
  });

  describe('getResolvedTheme', () => {
    it('returns light/dark unchanged', () => {
      expect(getResolvedTheme('light', makeMq(true))).toBe('light');
      expect(getResolvedTheme('dark', makeMq(false))).toBe('dark');
    });

    it('resolves "system" against matchMedia', () => {
      expect(getResolvedTheme('system', makeMq(true))).toBe('dark');
      expect(getResolvedTheme('system', makeMq(false))).toBe('light');
    });

    it('defaults to light when mq is missing', () => {
      expect(getResolvedTheme('system', null)).toBe('light');
    });
  });

  describe('applyTheme', () => {
    it('sets data-theme on documentElement', () => {
      const doc = makeDoc();
      applyTheme('dark', doc);
      expect(doc.documentElement.dataset.theme).toBe('dark');
      applyTheme('light', doc);
      expect(doc.documentElement.dataset.theme).toBe('light');
    });

    it('updates meta theme-color when present', () => {
      const doc = makeDoc();
      applyTheme('dark', doc);
      expect(doc._meta.setAttribute).toHaveBeenCalledWith('content', '#0D1A12');
      applyTheme('light', doc);
      expect(doc._meta.setAttribute).toHaveBeenCalledWith('content', '#1F4332');
    });

    it('is a no-op when doc is null', () => {
      expect(() => applyTheme('dark', null)).not.toThrow();
    });
  });

  describe('setTheme', () => {
    it('writes preference and applies resolved theme', () => {
      const storage = makeStorage();
      const doc = makeDoc();
      const mq = makeMq(true); // system → dark
      const resolved = setTheme('system', { storage, doc, mq });
      expect(resolved).toBe('dark');
      expect(storage.setItem).toHaveBeenCalledWith(THEME_KEY, 'system');
      expect(doc.documentElement.dataset.theme).toBe('dark');
    });

    it('explicit light overrides system OS preference', () => {
      const storage = makeStorage();
      const doc = makeDoc();
      const mq = makeMq(true); // OS says dark
      const resolved = setTheme('light', { storage, doc, mq });
      expect(resolved).toBe('light');
      expect(doc.documentElement.dataset.theme).toBe('light');
    });

    it('survives storage.setItem throwing', () => {
      const storage = { setItem: () => { throw new Error('quota'); } };
      const doc = makeDoc();
      expect(() => setTheme('dark', { storage, doc, mq: makeMq(false) })).not.toThrow();
      expect(doc.documentElement.dataset.theme).toBe('dark');
    });
  });

  describe('subscribeToSystemTheme', () => {
    it('invokes handler when media query changes', () => {
      const mq = makeMq(false);
      const handler = vi.fn();
      subscribeToSystemTheme(handler, { mq });
      mq._emit(true);
      expect(handler).toHaveBeenCalledWith('dark');
      mq._emit(false);
      expect(handler).toHaveBeenCalledWith('light');
    });

    it('returns an unsubscribe function', () => {
      const mq = makeMq(false);
      const handler = vi.fn();
      const off = subscribeToSystemTheme(handler, { mq });
      off();
      expect(mq.removeEventListener).toHaveBeenCalled();
    });

    it('returns a no-op function when mq is missing', () => {
      const off = subscribeToSystemTheme(() => {}, { mq: null });
      expect(() => off()).not.toThrow();
    });
  });
});

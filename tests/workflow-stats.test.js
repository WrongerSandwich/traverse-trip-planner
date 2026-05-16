import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// workflow-stats.js writes to `<cwd>/.workflow-stats.json` so each test
// chdir's into a clean temp dir and resets vi modules to get a fresh
// module instance that picks up the new cwd.
let cwdRoot;
let originalCwd;

beforeEach(() => {
  originalCwd = process.cwd();
  cwdRoot = mkdtempSync(join(tmpdir(), 'traverse-workflow-stats-'));
  process.chdir(cwdRoot);
  vi.resetModules();
});

afterEach(() => {
  process.chdir(originalCwd);
  try {
    rmSync(cwdRoot, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

async function load() {
  return await import('../src/lib/server/workflow-stats.js');
}

function statsPath() {
  return join(cwdRoot, '.workflow-stats.json');
}

// Record `count` samples with a fixed `durationSeconds` and `tokens`,
// stamping each at `now` so they're all in-window.
function recordN(recordInvocation, label, count, durationSeconds, tokensIn = 100, tokensOut = 50) {
  const now = Date.now();
  for (let i = 0; i < count; i++) {
    const endMs = now - (count - i); // slight time skew so trim is deterministic
    recordInvocation({
      label,
      startMs: endMs - durationSeconds * 1000,
      endMs,
      tokensIn,
      tokensOut,
    });
  }
}

describe('recordInvocation + getStats', () => {
  it('returns null when no samples are recorded', async () => {
    const { getStats } = await load();
    expect(getStats('seed')).toBeNull();
  });

  it('returns null with fewer than MIN_SAMPLES samples', async () => {
    const { recordInvocation, getStats } = await load();
    recordN(recordInvocation, 'seed', 9, 15, 100, 50);
    expect(getStats('seed')).toBeNull();
  });

  it('returns p10/p50/p90 once we have at least MIN_SAMPLES samples', async () => {
    const { recordInvocation, getStats } = await load();
    const now = Date.now();
    // 10 samples of duration 10s..19s, totals 150 each
    for (let i = 0; i < 10; i++) {
      const endMs = now - i;
      recordInvocation({
        label: 'seed',
        startMs: endMs - (10 + i) * 1000,
        endMs,
        tokensIn: 100,
        tokensOut: 50,
      });
    }
    const s = getStats('seed');
    expect(s).not.toBeNull();
    expect(s.sample_count).toBe(10);
    expect(s.p10_seconds).toBeGreaterThan(0);
    expect(s.p50_seconds).toBeGreaterThanOrEqual(s.p10_seconds);
    expect(s.p90_seconds).toBeGreaterThanOrEqual(s.p50_seconds);
    expect(s.p50_tokens).toBe(150);
  });

  it('rolls forward — caps at MAX_SAMPLES_PER_LABEL most recent', async () => {
    const { recordInvocation, getStats, MAX_SAMPLES_PER_LABEL } = await load();
    const now = Date.now();
    // Insert 60 records in chronological order. Earliest records get
    // duration 1s, latest get 60s. Only the most recent
    // MAX_SAMPLES_PER_LABEL (50) — durations 11s..60s — should remain,
    // landing p50 near 35s. If we kept the earliest 50 it would be near 25s.
    // The 2x drift guard would also kick in here against a hand default,
    // so we don't pass one.
    for (let i = 0; i < 60; i++) {
      const endMs = now - (60 - i);
      recordInvocation({
        label: 'deepen',
        startMs: endMs - (i + 1) * 1000,
        endMs,
        tokensIn: 1000,
        tokensOut: 1000,
      });
    }
    const s = getStats('deepen');
    expect(s).not.toBeNull();
    expect(s.sample_count).toBe(MAX_SAMPLES_PER_LABEL);
    // p50 of durations 11..60 → 35..36s
    expect(s.p50_seconds).toBeGreaterThan(30);
    expect(s.p50_seconds).toBeLessThan(45);
  });

  it('drops samples older than STALE_WINDOW_MS', async () => {
    const { recordInvocation, getStats, STALE_WINDOW_MS } = await load();
    const now = Date.now();
    // 5 stale samples — older than the window — should be dropped silently.
    for (let i = 0; i < 5; i++) {
      recordInvocation({
        label: 'chat',
        startMs: now - STALE_WINDOW_MS - 100_000 - i,
        endMs: now - STALE_WINDOW_MS - 100_000 - i + 1000,
        tokensIn: 0,
        tokensOut: 0,
      });
    }
    // 10 fresh samples — all within the window.
    for (let i = 0; i < 10; i++) {
      recordInvocation({
        label: 'chat',
        startMs: now - 1000,
        endMs: now,
        tokensIn: 200,
        tokensOut: 50,
      });
    }
    const s = getStats('chat');
    // Only the 10 fresh samples should be counted; the stale ones were trimmed.
    expect(s).not.toBeNull();
    expect(s.sample_count).toBe(10);
    expect(s.p50_tokens).toBe(250);
  });

  it('persists to disk and survives a simulated restart', async () => {
    const { recordInvocation, _flushNow } = await load();
    recordN(recordInvocation, 'itinerary', 10, 25, 500, 500);
    _flushNow();
    expect(existsSync(statsPath())).toBe(true);

    // Simulate restart by resetting module cache and re-importing.
    vi.resetModules();
    const fresh = await import('../src/lib/server/workflow-stats.js');
    const s = fresh.getStats('itinerary');
    expect(s).not.toBeNull();
    expect(s.sample_count).toBe(10);
    expect(s.p50_tokens).toBe(1000);
  });

  it('loads valid samples from a hand-written stats file', async () => {
    // Pre-populate the on-disk file before module load.
    const now = Date.now();
    const samples = Array.from({ length: 10 }, (_, i) => ({
      ts: now - i * 1000,
      durationMs: (15 + i) * 1000,
      tokensIn: 300,
      tokensOut: 200,
    }));
    writeFileSync(statsPath(), JSON.stringify({ samples: { add: samples } }));
    const { getStats } = await load();
    const s = getStats('add');
    expect(s).not.toBeNull();
    expect(s.sample_count).toBe(10);
  });

  it('ignores a corrupt stats file and starts fresh', async () => {
    writeFileSync(statsPath(), 'not valid json {{{');
    const { getStats, recordInvocation } = await load();
    expect(getStats('add')).toBeNull();
    // Recording still works — the corrupt file didn't break the module.
    recordN(recordInvocation, 'add', 10, 15, 200, 100);
    expect(getStats('add')).not.toBeNull();
  });

  it('rejects malformed input without throwing', async () => {
    const { recordInvocation, getStats } = await load();
    recordInvocation(null);
    recordInvocation({});
    recordInvocation({ label: '', startMs: 0, endMs: 0 });
    recordInvocation({ label: 'seed' }); // missing timestamps
    recordInvocation({ label: 'seed', startMs: 1000, endMs: 500 }); // negative duration
    expect(getStats('seed')).toBeNull();
  });
});

describe('getAllStats', () => {
  it('returns a snapshot for every label with at least one sample', async () => {
    const { recordInvocation, getAllStats } = await load();
    const now = Date.now();
    recordInvocation({ label: 'seed', startMs: now - 5000, endMs: now, tokensIn: 100, tokensOut: 50 });
    recordInvocation({ label: 'chat', startMs: now - 8000, endMs: now, tokensIn: 1000, tokensOut: 500 });
    const all = getAllStats();
    expect(Object.keys(all).sort()).toEqual(['chat', 'seed']);
    expect(all.seed.sample_count).toBe(1);
  });

  it('omits labels whose only samples are stale', async () => {
    const { recordInvocation, getAllStats, STALE_WINDOW_MS } = await load();
    const now = Date.now();
    const oldTs = now - STALE_WINDOW_MS - 10_000;
    recordInvocation({
      label: 'old',
      startMs: oldTs - 1000,
      endMs: oldTs,
      tokensIn: 0,
      tokensOut: 0,
    });
    recordInvocation({
      label: 'fresh',
      startMs: now - 1000,
      endMs: now,
      tokensIn: 0,
      tokensOut: 0,
    });
    const all = getAllStats();
    expect(all.old).toBeUndefined();
    expect(all.fresh).toBeDefined();
  });
});

describe('drift warning', () => {
  it('returns null and warns when telemetry p50 deviates > DRIFT_RATIO from hand default', async () => {
    const { recordInvocation, getStats } = await load();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      // 10 samples at 200s — wildly different from a hand default of 20s.
      recordN(recordInvocation, 'seed', 10, 200, 0, 0);
      const s = getStats('seed', { handDefaultSeconds: 20 });
      expect(s).toBeNull();
      expect(warn).toHaveBeenCalled();
      const msg = warn.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(msg).toContain('drift');
      expect(msg).toContain('seed');
    } finally {
      warn.mockRestore();
    }
  });

  it('does not warn or null-out when telemetry is within tolerance', async () => {
    const { recordInvocation, getStats } = await load();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      // 10 samples at 25s — within 2x of a hand default of 20s.
      recordN(recordInvocation, 'seed', 10, 25, 0, 0);
      const s = getStats('seed', { handDefaultSeconds: 20 });
      expect(s).not.toBeNull();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

describe('resolvePromise', () => {
  it('passes hand defaults through when telemetry is sparse', async () => {
    const { resolvePromise } = await load();
    const defaults = {
      verb: 'Generate ideas',
      produces: '...',
      time_seconds: 20,
      tokens_range: [1500, 3000],
    };
    expect(resolvePromise('seed', defaults)).toEqual(defaults);
  });

  it('overlays telemetry p50 / p10–p90 when enough samples exist', async () => {
    const { recordInvocation, resolvePromise } = await load();
    recordN(recordInvocation, 'seed', 10, 18, 1000, 500);
    const defaults = {
      verb: 'Generate ideas',
      produces: '...',
      time_seconds: 20,
      tokens_range: [1500, 3000],
    };
    const resolved = resolvePromise('seed', defaults);
    expect(resolved.time_seconds).toBe(18);
    expect(resolved.tokens_range).toEqual([1500, 1500]);
    // Shape preserved — verb and produces unchanged.
    expect(resolved.verb).toBe('Generate ideas');
    expect(resolved.produces).toBe('...');
  });

  it('preserves zero token_range for routes that do not call chat()', async () => {
    const { recordInvocation, resolvePromise } = await load();
    recordN(recordInvocation, 'regeocode', 10, 7, 0, 0);
    const defaults = {
      verb: 'Re-geocode stops',
      produces: '...',
      time_seconds: 8,
      tokens_range: [0, 0],
    };
    const resolved = resolvePromise('regeocode', defaults);
    expect(resolved.time_seconds).toBe(7);
    expect(resolved.tokens_range).toEqual([0, 0]);
  });

  it('falls back to defaults when telemetry drifts >2x', async () => {
    const { recordInvocation, resolvePromise } = await load();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    recordN(recordInvocation, 'seed', 10, 200, 0, 0);
    const defaults = {
      verb: 'Generate ideas',
      produces: '...',
      time_seconds: 20,
      tokens_range: [1500, 3000],
    };
    expect(resolvePromise('seed', defaults)).toEqual(defaults);
  });
});

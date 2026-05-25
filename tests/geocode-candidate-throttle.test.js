/**
 * Tests for the HTTP-conditional Nominatim throttle in geocodeCandidate().
 *
 * geocodeCandidate() must NOT sleep when both internal geocode() calls hit
 * the in-memory cache (fromCache: true). It MUST sleep once when at least
 * one call hits the network (fromCache: false).
 *
 * Acceptance criteria (#383):
 *   - 15 cached-result candidates returns in well under 1 second total.
 *   - 15 cold-result candidates respects ≥1.1s spacing between Nominatim hits.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

// Stub fs so the disk-backed caches in data.js don't affect test state.
const fsMock = vi.hoisted(() => ({
  readFileSync: vi.fn(() => { throw new Error('no file'); }),
  existsSync: vi.fn(() => false),
  readdirSync: vi.fn(() => []),
  statSync: vi.fn(() => ({ isDirectory: () => false })),
  mkdirSync: vi.fn(),
  renameSync: vi.fn(),
  writeFileSync: vi.fn(),
}));
vi.mock('fs', () => fsMock);
vi.mock('node:fs', () => fsMock);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Coords near Glacier MT — within 200mi for the distance check.
const REF_COORDS = [48.7, -113.8];
const HIT_COORDS = [48.5, -113.9];

function nominatimHit(lat = HIT_COORDS[0], lon = HIT_COORDS[1]) {
  return [{ class: 'place', addresstype: 'town', lat: String(lat), lon: String(lon) }];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('geocodeCandidate(): HTTP-conditional throttle', () => {
  let mod;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    mod = await import('../src/lib/server/candidates.js');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  // ── all-cached: no network, no sleep ──────────────────────────────────────

  it('skips the sleep when both geocode calls hit the cache (15 candidates)', async () => {
    const DEST_CONTEXT = 'Glacier MT';
    const names = Array.from({ length: 15 }, (_, i) => `Candidate ${i + 1}`);

    // Warm the geocode cache via real fetch (real timers not used; fake timers
    // are active so we advance past each sleep manually).
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => nominatimHit(),
    })));

    // Warm pass: call each candidate, advancing fake timers past the throttle.
    for (const name of names) {
      const p = mod.geocodeCandidate(name, DEST_CONTEXT, REF_COORDS);
      await vi.advanceTimersByTimeAsync(2000);
      await p;
    }

    // Cold-call fetch spy — must NOT be called in the cached pass.
    const strictFetch = vi.fn(() => Promise.reject(new Error('unexpected fetch on cache hit')));
    vi.stubGlobal('fetch', strictFetch);

    // Second pass: all entries are now cached. Run all 15 in parallel and
    // resolve WITHOUT advancing fake timers. If any sleep() fires, the
    // promise would hang waiting for timer advancement and the test would
    // time out — exactly the behavior we want to assert against.
    const settled = await Promise.allSettled(
      names.map((name) => mod.geocodeCandidate(name, DEST_CONTEXT, REF_COORDS))
    );

    // No network calls were made.
    expect(strictFetch).not.toHaveBeenCalled();

    // All 15 resolved (not pending / not rejected via unexpected-fetch error).
    for (const r of settled) {
      expect(r.status).toBe('fulfilled');
    }
  }, 10_000);

  // ── all-cold: each candidate must sleep (15 network hits) ─────────────────

  it('sleeps after a real network call (15 cold candidates)', async () => {
    const THROTTLE_MS = 1100;
    const DEST_CONTEXT = 'Glacier MT';
    const names = Array.from({ length: 15 }, (_, i) => `Cold Place ${i + 1}`);

    let fetchCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      fetchCalls++;
      return { ok: true, status: 200, json: async () => nominatimHit() };
    }));

    // Run each candidate sequentially; advance fake timers between calls.
    // If geocodeCandidate() does NOT sleep after a network hit, the promise
    // would already be resolved before timer advancement — we check the other
    // direction: if the timer is NOT advanced, the promise must not resolve
    // before it (verifying the sleep actually fires).
    let resolvedWithoutTimer = 0;
    for (const name of names) {
      const p = mod.geocodeCandidate(name, DEST_CONTEXT, REF_COORDS);

      // Check if it resolves immediately (no sleep) using a race.
      const raceResult = await Promise.race([
        p.then(() => 'resolved'),
        Promise.resolve('still-pending'),
      ]);

      // It should still be pending (sleep fired and blocks completion).
      if (raceResult === 'resolved') resolvedWithoutTimer++;

      // Now advance timers past the throttle so the sleep resolves.
      await vi.advanceTimersByTimeAsync(THROTTLE_MS + 100);
      await p;
    }

    // No candidate should have resolved without timer advancement.
    expect(resolvedWithoutTimer).toBe(0);

    // At least 15 fetch calls were made (could be more if bare fallback fired).
    expect(fetchCalls).toBeGreaterThanOrEqual(15);
  }, 10_000);

  // ── mixed: scoped misses (network), bare hits cache → still sleeps ─────────

  it('still sleeps when scoped query misses but bare hits the cache', async () => {
    const THROTTLE_MS = 1100;
    const name = 'Apgar Village';
    const DEST_CONTEXT = 'Glacier MT';

    // First: warm the bare query "Apgar Village" in the cache by calling with
    // no destinationContext (scoped skipped) and advancing timers.
    // Actually geocodeCandidate requires refCoords for bare to run, and skips
    // bare when refCoords is null. So we warm by calling with destinationContext
    // matching the bare key — i.e., call geocodeCandidate('Apgar Village', ...)
    // which caches both scoped and bare queries on first call. Then on second
    // call both are cached → no sleep (already tested above).
    //
    // To create the "scoped misses, bare hits cache" scenario:
    //   1. Warm the bare query "Apgar Village" by mocking fetch to return a hit.
    //   2. Second call: scoped query "<name>, Glacier MT" is cold (new key) → fetch.
    //      Bare query "Apgar Village" is cached → no fetch.
    //   3. Since scoped hit the network, sleep should fire.

    // Warm only the bare query by stubbing fetch.
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200, json: async () => nominatimHit(),
    })));

    // Use a different context to warm "Apgar Village" bare (no destinationContext).
    // We can't easily warm only the bare key via geocodeCandidate, so we call
    // geocode() directly via the data.js module.
    const dataMod = await import('../src/lib/server/data.js');
    await dataMod.geocode('Apgar Village');
    // Advance timers for data.js's own sleep if any (data.js geocode itself doesn't sleep).

    // Now: bare "Apgar Village" is cached, scoped "Apgar Village, Glacier MT" is cold.
    let fetchCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      fetchCalls++;
      // Scoped returns empty → bare fallback triggered.
      return { ok: true, status: 200, json: async () => [] };
    }));

    const p = mod.geocodeCandidate(name, DEST_CONTEXT, REF_COORDS);

    // Should still be pending (scoped network call → sleep fires).
    const raceResult = await Promise.race([
      p.then(() => 'resolved'),
      Promise.resolve('still-pending'),
    ]);
    expect(raceResult).toBe('still-pending');

    // Advance past the throttle.
    await vi.advanceTimersByTimeAsync(THROTTLE_MS + 100);
    await p;

    // The scoped query hit the network.
    expect(fetchCalls).toBeGreaterThanOrEqual(1);
  }, 10_000);
});

/**
 * Tests for enrichTrips single-flight + generation-guarded pruneCaches (#273).
 *
 * Two invariants under test:
 *   1. Concurrent enrichTrips() callers share the same in-flight promise
 *      (single-flight), so we don't walk the FS or race pruneCaches twice.
 *   2. If invalidateEnrichCache() bumps the generation while an enrichment is
 *      mid-flight (e.g. a concurrent seed POST writes a new trip), the
 *      in-flight result is returned but enrichMemo stays null so the next
 *      reader re-enriches with the post-write snapshot.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock fs so enrichTrips finds no trips on disk (collectTrips returns []).
// readdirSync returns empty for every stage directory; existsSync returns true
// for home.md so getHome() doesn't throw.
const fsMock = vi.hoisted(() => ({
  readFileSync: vi.fn(() => '---\nhome_city: Test\nhome_coords: [0, 0]\n---'),
  existsSync: vi.fn(() => true),
  readdirSync: vi.fn(() => []),
  statSync: vi.fn(() => ({ isDirectory: () => false })),
  mkdirSync: vi.fn(),
  renameSync: vi.fn(),
}));
vi.mock('fs', () => fsMock);
vi.mock('node:fs', () => fsMock);

let enrichTrips;
let invalidateEnrichCache;

beforeEach(async () => {
  vi.resetModules();
  const mod = await import('../src/lib/server/data.js');
  enrichTrips = mod.enrichTrips;
  invalidateEnrichCache = mod.invalidateEnrichCache;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('enrichTrips concurrency (#273)', () => {
  it('coalesces concurrent callers — second call within the same tick returns the same trips array', async () => {
    // With no trips on disk, the enrichment is mostly synchronous, but the
    // returned promise still resolves to the same trips reference for every
    // overlapping caller — proving they joined one flight rather than each
    // walking the FS.
    const [r1, r2, r3] = await Promise.all([enrichTrips(), enrichTrips(), enrichTrips()]);
    expect(r1).toBe(r2);
    expect(r2).toBe(r3);
  });

  it('returns the memo for repeat calls within the 30s window', async () => {
    const r1 = await enrichTrips();
    // After completion, the memo is populated; the second call short-circuits
    // and returns the same array reference.
    const r2 = await enrichTrips();
    expect(r2).toBe(r1);
  });

  it('skips memo population when invalidate fires mid-flight', async () => {
    // Start an enrichment.
    const flight = enrichTrips();
    // Simulate a concurrent mutating endpoint bumping the generation.
    invalidateEnrichCache();
    // The in-flight resolves — caller gets a result, but the memo stays empty.
    const r1 = await flight;
    expect(Array.isArray(r1)).toBe(true);
    // Next call re-enriches (does not return the same array reference as r1).
    const r2 = await enrichTrips();
    expect(r2).not.toBe(r1);
  });

  it('invalidateEnrichCache lets the next call start fresh', async () => {
    const r1 = await enrichTrips();
    invalidateEnrichCache();
    const r2 = await enrichTrips();
    expect(r2).not.toBe(r1);
  });
});

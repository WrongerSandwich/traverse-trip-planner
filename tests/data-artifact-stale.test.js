import { describe, it, expect } from 'vitest';
import { isArtifactStale, PLANNING_SECTIONS } from '../src/lib/server/data.js';

// Synthetic stat helper: maps file paths to { mtimeMs } or null (not found).
function makeStat(mtimes) {
  return (p) => {
    const ms = mtimes[p];
    return ms != null ? { mtimeMs: ms } : null;
  };
}

const DIR = '/fake/planning/my-trip';

function p(name) {
  return `${DIR}/${name}.md`;
}

// ── isArtifactStale (generic) ────────────────────────────────────────────────

describe('isArtifactStale', () => {
  it('returns false when artifact does not exist', () => {
    const stat = makeStat({
      [p('overview')]: 1000,
      [p('route')]: 2000,
    });
    expect(isArtifactStale(DIR, PLANNING_SECTIONS, 'itinerary.md', stat)).toBe(false);
  });

  it('returns false when all sources are older than artifact', () => {
    const stat = makeStat({
      [p('itinerary')]: 5000,
      [p('overview')]: 1000,
      [p('route')]: 2000,
      [p('stops')]: 3000,
      [p('logistics')]: 4000,
    });
    expect(isArtifactStale(DIR, PLANNING_SECTIONS, 'itinerary.md', stat)).toBe(false);
  });

  it('returns false when sources have same mtime as artifact', () => {
    const stat = makeStat({
      [p('itinerary')]: 5000,
      [p('overview')]: 5000,
    });
    expect(isArtifactStale(DIR, PLANNING_SECTIONS, 'itinerary.md', stat)).toBe(false);
  });

  it('returns true when any source is newer than artifact', () => {
    const stat = makeStat({
      [p('itinerary')]: 5000,
      [p('overview')]: 1000,
      [p('route')]: 6000, // newer!
      [p('stops')]: 3000,
    });
    expect(isArtifactStale(DIR, PLANNING_SECTIONS, 'itinerary.md', stat)).toBe(true);
  });

  it('returns false when no sources exist at all', () => {
    const stat = makeStat({
      [p('itinerary')]: 5000,
    });
    expect(isArtifactStale(DIR, PLANNING_SECTIONS, 'itinerary.md', stat)).toBe(false);
  });

  it('respects a custom sources list', () => {
    // Only 'overview' is a source; 'route' being newer should not trigger stale.
    const stat = makeStat({
      [p('itinerary')]: 5000,
      [p('overview')]: 4000,
      [p('route')]: 9000, // newer, but not in sources list
    });
    expect(isArtifactStale(DIR, ['overview'], 'itinerary.md', stat)).toBe(false);
  });

  it('works with brochure.md as the artifact', () => {
    const stat = makeStat({
      [p('brochure')]: 5000,
      [p('overview')]: 1000,
      [p('route')]: 6000, // newer!
      [p('stops')]: 3000,
    });
    expect(isArtifactStale(DIR, PLANNING_SECTIONS, 'brochure.md', stat)).toBe(true);
  });

  it('returns false for brochure.md when all sources are older', () => {
    const stat = makeStat({
      [p('brochure')]: 9000,
      [p('overview')]: 1000,
      [p('route')]: 2000,
      [p('stops')]: 3000,
      [p('logistics')]: 4000,
    });
    expect(isArtifactStale(DIR, PLANNING_SECTIONS, 'brochure.md', stat)).toBe(false);
  });
});


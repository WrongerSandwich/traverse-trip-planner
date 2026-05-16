import { describe, it, expect } from 'vitest';
import { isItineraryStale } from '../src/lib/server/data.js';

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

describe('isItineraryStale', () => {
  it('returns false when itinerary.md does not exist', () => {
    const stat = makeStat({
      [p('overview')]: 1000,
      [p('route')]: 2000,
    });
    expect(isItineraryStale(DIR, stat)).toBe(false);
  });

  it('returns false when all sections are older than itinerary', () => {
    const stat = makeStat({
      [p('itinerary')]: 5000,
      [p('overview')]: 1000,
      [p('route')]: 2000,
      [p('stops')]: 3000,
      [p('logistics')]: 4000,
    });
    expect(isItineraryStale(DIR, stat)).toBe(false);
  });

  it('returns false when sections have same mtime as itinerary', () => {
    const stat = makeStat({
      [p('itinerary')]: 5000,
      [p('overview')]: 5000,
    });
    expect(isItineraryStale(DIR, stat)).toBe(false);
  });

  it('returns true when any section is newer than itinerary', () => {
    const stat = makeStat({
      [p('itinerary')]: 5000,
      [p('overview')]: 1000,
      [p('route')]: 6000, // newer!
      [p('stops')]: 3000,
    });
    expect(isItineraryStale(DIR, stat)).toBe(true);
  });

  it('returns true when only overview is newer', () => {
    const stat = makeStat({
      [p('itinerary')]: 5000,
      [p('overview')]: 9999,
    });
    expect(isItineraryStale(DIR, stat)).toBe(true);
  });

  it('returns false when only some sections exist and none are newer', () => {
    // route and logistics don't exist — missing sections are not counted stale
    const stat = makeStat({
      [p('itinerary')]: 5000,
      [p('overview')]: 3000,
      [p('stops')]: 4000,
    });
    expect(isItineraryStale(DIR, stat)).toBe(false);
  });

  it('returns false when no sections exist at all', () => {
    const stat = makeStat({
      [p('itinerary')]: 5000,
    });
    expect(isItineraryStale(DIR, stat)).toBe(false);
  });
});

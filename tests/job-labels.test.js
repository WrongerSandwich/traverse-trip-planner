import { describe, it, expect } from 'vitest';
import { jobLabel, filterJobsForSlug } from '../src/lib/utils/jobLabels.js';

// ─── jobLabel ─────────────────────────────────────────────────────────────────

describe('jobLabel', () => {
  it('maps brochure to "Preparing brochure…"', () => {
    expect(jobLabel('brochure')).toBe('Preparing brochure…');
  });

  it('maps deepen to "Researching…"', () => {
    expect(jobLabel('deepen')).toBe('Researching…');
  });

  it('maps deepen-section to "Deepening stops…"', () => {
    expect(jobLabel('deepen-section')).toBe('Deepening stops…');
  });

  it('falls back to "{workflow}…" for unknown workflows', () => {
    expect(jobLabel('some-future-workflow')).toBe('some-future-workflow…');
  });

  it('falls back gracefully for an empty string', () => {
    expect(jobLabel('')).toBe('…');
  });
});

// ─── filterJobsForSlug ────────────────────────────────────────────────────────

describe('filterJobsForSlug', () => {
  const jobs = [
    { workflow: 'brochure', slug: 'hannibal-twain', startedAt: 1000 },
    { workflow: 'deepen',   slug: 'ozarks-loop',    startedAt: 2000 },
    { workflow: 'deepen-section', slug: 'hannibal-twain', startedAt: 3000 },
  ];

  it('returns only jobs matching the given slug', () => {
    const result = filterJobsForSlug(jobs, 'hannibal-twain');
    expect(result).toHaveLength(2);
    expect(result.every(j => j.slug === 'hannibal-twain')).toBe(true);
  });

  it('returns an empty array when no jobs match', () => {
    expect(filterJobsForSlug(jobs, 'no-such-trip')).toEqual([]);
  });

  it('returns all jobs when all match the slug', () => {
    const single = [{ workflow: 'brochure', slug: 'marfa-tx', startedAt: 1 }];
    expect(filterJobsForSlug(single, 'marfa-tx')).toHaveLength(1);
  });

  it('returns an empty array when jobs list is empty', () => {
    expect(filterJobsForSlug([], 'hannibal-twain')).toEqual([]);
  });

  it('preserves job object shape (does not strip fields)', () => {
    const result = filterJobsForSlug(jobs, 'ozarks-loop');
    expect(result[0]).toEqual({ workflow: 'deepen', slug: 'ozarks-loop', startedAt: 2000 });
  });
});

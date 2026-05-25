import { describe, it, expect, vi, beforeEach } from 'vitest';

// `geocodeCandidatesJob(slug, { signal })` is the loop that fills in
// candidate `coords` after deepen completes. Behavior contract (#382):
//
//   - reads candidates from disk via readCandidates(slug)
//   - iterates non-hidden candidates missing `coords`
//   - resolves the destination ref coords once (for disambiguation) by
//     reading the overview frontmatter from disk
//   - calls geocodeCandidate(name, destinationContext, refCoords) per entry
//   - writes the updated candidates back to disk INCREMENTALLY, so pins
//     appear on the map as they resolve
//   - skips candidates that already have coords (idempotent)
//   - aborts cleanly when the AbortController signal fires

const mockReadCandidates = vi.hoisted(() => vi.fn());
const mockWriteCandidates = vi.hoisted(() => vi.fn());
const mockGeocodeCandidate = vi.hoisted(() => vi.fn());
const mockGetDestinationRefCoords = vi.hoisted(() => vi.fn());

vi.mock('$lib/server/candidates.js', () => ({
  readCandidates: mockReadCandidates,
  writeCandidates: mockWriteCandidates,
  geocodeCandidate: mockGeocodeCandidate,
  getDestinationRefCoords: mockGetDestinationRefCoords,
}));

const mockFindTripFile = vi.hoisted(() => vi.fn(() => '/test/planning/t/overview.md'));
const mockReadFileSync = vi.hoisted(() => vi.fn(() => '---\ndestination: Glacier MT\n---\nProse'));
const mockExistsSync = vi.hoisted(() => vi.fn(() => true));

vi.mock('node:fs', () => ({
  readFileSync: mockReadFileSync,
  existsSync: mockExistsSync,
}));

vi.mock('$lib/server/data.js', () => ({
  DATA_DIR: '/test-root/data',
  findTripFile: mockFindTripFile,
  parseFrontmatter: (text) => {
    const match = text.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return null;
    const fm = {};
    for (const line of match[1].split('\n')) {
      const m = line.match(/^([^:]+):\s*(.*)$/);
      if (m) fm[m[1].trim()] = m[2].trim();
    }
    return fm;
  },
}));

import { geocodeCandidatesJob } from '../src/lib/server/geocode-job.js';

beforeEach(() => {
  vi.clearAllMocks();
  mockReadCandidates.mockReset();
  mockWriteCandidates.mockReset();
  mockGeocodeCandidate.mockReset();
  mockGetDestinationRefCoords.mockReset();
  mockFindTripFile.mockReturnValue('/test/planning/t/overview.md');
  mockReadFileSync.mockReturnValue('---\ndestination: Glacier MT\n---\nProse');
  mockExistsSync.mockReturnValue(true);
  mockGetDestinationRefCoords.mockResolvedValue([48.7, -114.0]);
});

describe('geocodeCandidatesJob', () => {
  it('reads candidates from disk and iterates non-hidden missing-coords entries', async () => {
    mockReadCandidates.mockReturnValue({
      stops: [
        { id: 'lake-mcdonald', name: 'Lake McDonald', category: 'outdoors' },
        { id: 'whitefish-inn', name: 'Whitefish Inn', category: 'misc', hidden: true },
      ],
      lodging: [
        { id: 'lodge', name: 'Lodge', price_tier: 'mid' },
      ],
    });
    mockGeocodeCandidate.mockResolvedValue([48.5, -113.9]);

    await geocodeCandidatesJob('t');

    // Visible entries get geocoded; hidden one does not.
    expect(mockGeocodeCandidate).toHaveBeenCalledTimes(2);
    expect(mockGeocodeCandidate).toHaveBeenCalledWith('Lake McDonald', 'Glacier MT', [48.7, -114.0]);
    expect(mockGeocodeCandidate).toHaveBeenCalledWith('Lodge', 'Glacier MT', [48.7, -114.0]);
  });

  it('skips candidates that already have coords', async () => {
    mockReadCandidates.mockReturnValue({
      stops: [
        { id: 'has-coords', name: 'Has Coords', coords: { lat: 1, lng: 2 } },
        { id: 'no-coords', name: 'No Coords' },
      ],
      lodging: [],
    });
    mockGeocodeCandidate.mockResolvedValue([48.5, -113.9]);

    await geocodeCandidatesJob('t');

    // Only the missing-coords entry gets geocoded.
    expect(mockGeocodeCandidate).toHaveBeenCalledTimes(1);
    expect(mockGeocodeCandidate).toHaveBeenCalledWith('No Coords', expect.any(String), expect.any(Array));
  });

  it('writes back to disk incrementally so pins appear as they resolve', async () => {
    mockReadCandidates.mockReturnValue({
      stops: [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
        { id: 'c', name: 'C' },
      ],
      lodging: [],
    });
    mockGeocodeCandidate
      .mockResolvedValueOnce([1, 2])
      .mockResolvedValueOnce([3, 4])
      .mockResolvedValueOnce([5, 6]);

    await geocodeCandidatesJob('t');

    // One write per resolved candidate so the UI sees each pin appear.
    expect(mockWriteCandidates).toHaveBeenCalledTimes(3);
  });

  it('does not write when no candidates need geocoding', async () => {
    mockReadCandidates.mockReturnValue({
      stops: [
        { id: 'a', name: 'A', coords: { lat: 1, lng: 2 } },
      ],
      lodging: [
        { id: 'b', name: 'B', coords: { lat: 3, lng: 4 } },
      ],
    });

    await geocodeCandidatesJob('t');

    expect(mockGeocodeCandidate).not.toHaveBeenCalled();
    expect(mockWriteCandidates).not.toHaveBeenCalled();
  });

  it('respects AbortController signal mid-loop', async () => {
    mockReadCandidates.mockReturnValue({
      stops: [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
        { id: 'c', name: 'C' },
      ],
      lodging: [],
    });
    const controller = new AbortController();
    mockGeocodeCandidate.mockImplementation(async (name) => {
      if (name === 'B') controller.abort();
      return [48.5, -113.9];
    });

    await geocodeCandidatesJob('t', { signal: controller.signal });

    // A was processed, B was processed, but C was not because signal aborted between B and C.
    const calledNames = mockGeocodeCandidate.mock.calls.map((c) => c[0]);
    expect(calledNames).toContain('A');
    expect(calledNames).not.toContain('C');
  });

  it('updates each candidate with coords {lat, lng} when geocode returns coords', async () => {
    mockReadCandidates.mockReturnValue({
      stops: [{ id: 'a', name: 'A' }],
      lodging: [],
    });
    mockGeocodeCandidate.mockResolvedValue([48.5, -113.9]);

    await geocodeCandidatesJob('t');

    const lastWrite = mockWriteCandidates.mock.calls.at(-1);
    expect(lastWrite[0]).toBe('t');
    expect(lastWrite[1].stops[0].coords).toEqual({ lat: 48.5, lng: -113.9 });
  });

  it('leaves candidate coords undefined when geocode returns null', async () => {
    mockReadCandidates.mockReturnValue({
      stops: [{ id: 'a', name: 'A' }],
      lodging: [],
    });
    mockGeocodeCandidate.mockResolvedValue(null);

    await geocodeCandidatesJob('t');

    // No write since nothing was actually resolved - keeps disk traffic
    // proportional to results.
    expect(mockWriteCandidates).not.toHaveBeenCalled();
  });

  it('returns early when readCandidates returns null (no candidates file)', async () => {
    mockReadCandidates.mockReturnValue(null);

    await expect(geocodeCandidatesJob('t')).resolves.toBeUndefined();
    expect(mockGeocodeCandidate).not.toHaveBeenCalled();
    expect(mockWriteCandidates).not.toHaveBeenCalled();
  });

  it('reads destination from overview frontmatter for disambiguation context', async () => {
    mockReadCandidates.mockReturnValue({
      stops: [{ id: 'a', name: 'A' }],
      lodging: [],
    });
    mockReadFileSync.mockReturnValue('---\ndestination: Bend OR\n---\nProse');
    mockGeocodeCandidate.mockResolvedValue([44.0, -121.3]);

    await geocodeCandidatesJob('t');

    expect(mockGetDestinationRefCoords).toHaveBeenCalledWith('Bend OR');
    expect(mockGeocodeCandidate).toHaveBeenCalledWith('A', 'Bend OR', [48.7, -114.0]);
  });

  it('writes once per resolved candidate, not per skipped one', async () => {
    mockReadCandidates.mockReturnValue({
      stops: [
        { id: 'a', name: 'A', coords: { lat: 1, lng: 2 } },
        { id: 'b', name: 'B' },
        { id: 'c', name: 'C', hidden: true },
      ],
      lodging: [],
    });
    mockGeocodeCandidate.mockResolvedValue([48.5, -113.9]);

    await geocodeCandidatesJob('t');

    expect(mockGeocodeCandidate).toHaveBeenCalledTimes(1);
    expect(mockWriteCandidates).toHaveBeenCalledTimes(1);
  });

  it('rereads candidates between iterations so concurrent edits are not clobbered', async () => {
    let readCount = 0;
    mockReadCandidates.mockImplementation(() => {
      readCount++;
      return {
        stops: [
          { id: 'a', name: 'A' },
          { id: 'b', name: 'B' },
        ],
        lodging: [],
      };
    });
    mockGeocodeCandidate.mockResolvedValue([48.5, -113.9]);

    await geocodeCandidatesJob('t');

    expect(readCount).toBeGreaterThan(1);
  });
});

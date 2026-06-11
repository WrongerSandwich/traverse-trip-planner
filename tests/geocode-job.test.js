import { describe, it, expect, vi, beforeEach } from 'vitest';

// `geocodeCandidatesJob(slug, { signal })` is the loop that fills in
// candidate `coords` after deepen completes. Behavior contract (#382):
//
//   - reads candidates from disk via readCandidates(slug)
//   - iterates non-hidden candidates missing `coords`
//   - resolves the destination ref coords once (for disambiguation) by
//     reading the overview frontmatter from disk
//   - calls geocodeCandidate(name, destinationContext, refCoords, address)
//     per entry — the candidate's address (when the deepen LLM volunteered
//     one) is forwarded as the most-precise geocode attempt (#403/Bug 4)
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
const mockReverseGeocode = vi.hoisted(() => vi.fn());

vi.mock('node:fs', () => ({
  readFileSync: mockReadFileSync,
  existsSync: mockExistsSync,
}));

vi.mock('$lib/server/data.js', () => ({
  DATA_DIR: '/test-root/data',
  findTripFile: mockFindTripFile,
  reverseGeocode: mockReverseGeocode,
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
  mockReverseGeocode.mockReset();
  mockFindTripFile.mockReturnValue('/test/planning/t/overview.md');
  mockReadFileSync.mockReturnValue('---\ndestination: Glacier MT\n---\nProse');
  mockExistsSync.mockReturnValue(true);
  mockGetDestinationRefCoords.mockResolvedValue([48.7, -114.0]);
  mockReverseGeocode.mockResolvedValue(null);
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
    expect(mockGeocodeCandidate).toHaveBeenCalledWith('Lake McDonald', 'Glacier MT', [48.7, -114.0], undefined);
    expect(mockGeocodeCandidate).toHaveBeenCalledWith('Lodge', 'Glacier MT', [48.7, -114.0], undefined);
  });

  it('skips stops that already have both coords and address', async () => {
    mockReadCandidates.mockReturnValue({
      stops: [
        { id: 'has-both', name: 'Has Both', coords: { lat: 1, lng: 2 }, address: 'Existing St' },
        { id: 'no-coords', name: 'No Coords' },
      ],
      lodging: [],
    });
    mockGeocodeCandidate.mockResolvedValue([48.5, -113.9]);

    await geocodeCandidatesJob('t');

    // Only the missing-coords entry gets geocoded; the stop with both fields is skipped.
    expect(mockGeocodeCandidate).toHaveBeenCalledTimes(1);
    expect(mockGeocodeCandidate).toHaveBeenCalledWith('No Coords', expect.any(String), expect.any(Array), undefined);
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
        { id: 'a', name: 'A', coords: { lat: 1, lng: 2 }, address: 'Fully resolved stop' },
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
    expect(mockGeocodeCandidate).toHaveBeenCalledWith('A', 'Bend OR', [48.7, -114.0], undefined);
  });

  it('writes once per resolved candidate, not per skipped one', async () => {
    mockReadCandidates.mockReturnValue({
      stops: [
        { id: 'a', name: 'A', coords: { lat: 1, lng: 2 }, address: 'Already resolved' },
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

  // --- address capture (#403) ---

  it('writes address to stop candidate after successful geocode', async () => {
    mockReadCandidates.mockReturnValue({
      stops: [{ id: 'dunes', name: 'Sleeping Bear Dunes', category: 'outdoors' }],
      lodging: [],
    });
    mockGeocodeCandidate.mockResolvedValue([44.88, -86.05]);
    mockReverseGeocode.mockResolvedValue('Front Street, Empire, Michigan 49630');

    await geocodeCandidatesJob('t');

    const lastWrite = mockWriteCandidates.mock.calls.at(-1);
    expect(lastWrite[1].stops[0].coords).toEqual({ lat: 44.88, lng: -86.05 });
    expect(lastWrite[1].stops[0].address).toBe('Front Street, Empire, Michigan 49630');
  });

  it('forwards a deepen-volunteered address to geocodeCandidate as the precise attempt (Bug 4)', async () => {
    // A stop can arrive from deepen with an address but no coords. The job must
    // pass that address through so geocodeCandidate can pin off the street
    // address rather than failing on a bare-name lookup.
    mockReadCandidates.mockReturnValue({
      stops: [{ id: 'cafe', name: 'Corner Cafe', address: '123 Main St, Empire MI 49630' }],
      lodging: [],
    });
    mockGeocodeCandidate.mockResolvedValue([44.88, -86.05]);
    mockReverseGeocode.mockResolvedValue(null);

    await geocodeCandidatesJob('t');

    expect(mockGeocodeCandidate).toHaveBeenCalledWith(
      'Corner Cafe',
      'Glacier MT',
      [48.7, -114.0],
      '123 Main St, Empire MI 49630',
    );
  });

  it('calls reverseGeocode with the coords returned by geocodeCandidate', async () => {
    mockReadCandidates.mockReturnValue({
      stops: [{ id: 'a', name: 'A' }],
      lodging: [],
    });
    mockGeocodeCandidate.mockResolvedValue([44.88, -86.05]);
    mockReverseGeocode.mockResolvedValue('Some Address');

    await geocodeCandidatesJob('t');

    expect(mockReverseGeocode).toHaveBeenCalledWith([44.88, -86.05]);
  });

  it('does not overwrite an existing user-edited address', async () => {
    mockReadCandidates.mockReturnValue({
      stops: [{ id: 'dunes', name: 'Dunes', address: 'User-edited address', user_added: true }],
      lodging: [],
    });
    mockGeocodeCandidate.mockResolvedValue([44.88, -86.05]);
    mockReverseGeocode.mockResolvedValue('Nominatim address');

    await geocodeCandidatesJob('t');

    const lastWrite = mockWriteCandidates.mock.calls.at(-1);
    expect(lastWrite[1].stops[0].address).toBe('User-edited address');
    expect(mockReverseGeocode).not.toHaveBeenCalled();
  });

  it('does not call reverseGeocode for lodging candidates', async () => {
    mockReadCandidates.mockReturnValue({
      stops: [],
      lodging: [{ id: 'inn', name: 'Empire Inn' }],
    });
    mockGeocodeCandidate.mockResolvedValue([44.88, -86.05]);
    mockReverseGeocode.mockResolvedValue('Some Address');

    await geocodeCandidatesJob('t');

    expect(mockReverseGeocode).not.toHaveBeenCalled();
  });

  it('still writes coords when reverseGeocode returns null', async () => {
    mockReadCandidates.mockReturnValue({
      stops: [{ id: 'a', name: 'A' }],
      lodging: [],
    });
    mockGeocodeCandidate.mockResolvedValue([44.88, -86.05]);
    mockReverseGeocode.mockResolvedValue(null);

    await geocodeCandidatesJob('t');

    const lastWrite = mockWriteCandidates.mock.calls.at(-1);
    expect(lastWrite[1].stops[0].coords).toEqual({ lat: 44.88, lng: -86.05 });
    expect(lastWrite[1].stops[0].address).toBeUndefined();
  });

  it('backfills address for a stop that already has coords but no address', async () => {
    // A stop with coords (from a prior run) but no address should be enrolled in
    // the work list and get reverseGeocode called — forward geocode is skipped.
    mockReadCandidates.mockReturnValue({
      stops: [{ id: 'a', name: 'A', coords: { lat: 44.88, lng: -86.05 } }],
      lodging: [],
    });
    mockReverseGeocode.mockResolvedValue('Front Street, Empire, Michigan 49630');

    await geocodeCandidatesJob('t');

    expect(mockGeocodeCandidate).not.toHaveBeenCalled(); // skipped — coords already present
    expect(mockReverseGeocode).toHaveBeenCalledWith([44.88, -86.05]); // reverse lookup happened
    const lastWrite = mockWriteCandidates.mock.calls.at(-1);
    expect(lastWrite[1].stops[0].address).toBe('Front Street, Empire, Michigan 49630');
  });

  it('skips stops that already have both coords and address (no fetch)', async () => {
    // A stop with both coords and address is fully resolved — nothing to do.
    mockReadCandidates.mockReturnValue({
      stops: [{ id: 'a', name: 'A', coords: { lat: 44.88, lng: -86.05 }, address: 'Existing address' }],
      lodging: [],
    });

    await geocodeCandidatesJob('t');

    expect(mockGeocodeCandidate).not.toHaveBeenCalled();
    expect(mockReverseGeocode).not.toHaveBeenCalled();
    expect(mockWriteCandidates).not.toHaveBeenCalled();
  });

  // --- swallowed-failure surfacing (#488) ---

  it('does not crash when getDestinationRefCoords throws — degrades to null refCoords', async () => {
    // Point 3: a Nominatim outage on the ref-coords lookup must not crash the
    // whole job. It should be caught and geocodeCandidate called with null.
    mockGetDestinationRefCoords.mockRejectedValue(new Error('Nominatim down'));
    mockReadCandidates.mockReturnValue({
      stops: [{ id: 'a', name: 'A' }],
      lodging: [],
    });
    mockGeocodeCandidate.mockResolvedValue([1, 2]);

    await expect(geocodeCandidatesJob('t')).resolves.toBeDefined();
    expect(mockGeocodeCandidate).toHaveBeenCalledWith('A', 'Glacier MT', null, undefined);
  });

  it('returns a summary counting forward-geocode failures', async () => {
    // Point 2: a forward-geocode miss leaves a candidate with no pin. The job
    // must count it and report it in the returned summary, not silently drop it.
    mockReadCandidates.mockReturnValue({
      stops: [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
      ],
      lodging: [],
    });
    mockGeocodeCandidate
      .mockResolvedValueOnce(null) // A: miss
      .mockResolvedValueOnce([1, 2]); // B: hit
    mockReverseGeocode.mockResolvedValue('Some Address');

    const summary = await geocodeCandidatesJob('t');

    expect(summary).toEqual({ geocodeFailures: 1, reverseFailures: 0 });
  });

  it('returns a summary counting reverse-geocode (address) failures', async () => {
    // Point 2: a reverse-geocode miss leaves a stop with coords but blank
    // address. The job must count it in the returned summary.
    mockReadCandidates.mockReturnValue({
      stops: [{ id: 'a', name: 'A' }],
      lodging: [],
    });
    mockGeocodeCandidate.mockResolvedValue([44.88, -86.05]);
    mockReverseGeocode.mockResolvedValue(null); // address lookup fails

    const summary = await geocodeCandidatesJob('t');

    expect(summary).toEqual({ geocodeFailures: 0, reverseFailures: 1 });
  });

  it('returns a clean (all-zero) summary when everything resolves', async () => {
    mockReadCandidates.mockReturnValue({
      stops: [{ id: 'a', name: 'A' }],
      lodging: [],
    });
    mockGeocodeCandidate.mockResolvedValue([44.88, -86.05]);
    mockReverseGeocode.mockResolvedValue('Resolved Address');

    const summary = await geocodeCandidatesJob('t');

    expect(summary).toEqual({ geocodeFailures: 0, reverseFailures: 0 });
  });
});

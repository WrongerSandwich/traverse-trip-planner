import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockChat = vi.hoisted(() => vi.fn());
vi.mock('$lib/server/ai.js', () => ({ chat: mockChat }));

const mockGeocode = vi.hoisted(() => vi.fn(async () => null));
vi.mock('$lib/server/data.js', () => ({
  ROOT: '/test',
  readHomeMd: () => '---\ntravelers: [you]\n---\n',
  getTripFiles: () => ({
    slug: 't',
    stage: 'planning',
    files: { overview: '---\ndestination: Glacier MT\n---\nGlacier prose', route: 'Drive prose', stops: 'Stop prose', logistics: 'Logistics prose' },
  }),
  findTripLocation: () => ({ kind: 'dir', path: '/test/planning/t', stage: 'planning' }),
  geocode: mockGeocode,
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

vi.mock('$lib/server/plan.js', () => ({
  emptyPlan: () => ({ field_guide_notes: '', gotchas: '', days: [] }),
  writePlan: vi.fn(),
  readPlan: vi.fn(() => null),
}));

vi.mock('$lib/server/candidates.js', () => ({
  emptyCandidates: () => ({ stops: [], lodging: [] }),
  writeCandidates: vi.fn(),
  readCandidates: vi.fn(() => null),
  // Mirror real makeCandidateId disambiguation so the dedupe test exercises
  // the across-stops-and-lodging seenIds accumulator in extract-candidates.
  makeCandidateId: (name, existingIds) => {
    const base = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'candidate';
    const taken = new Set(existingIds);
    if (!taken.has(base)) return base;
    let n = 2;
    while (taken.has(`${base}-${n}`)) n++;
    return `${base}-${n}`;
  },
  STOP_CATEGORIES: ['outdoors', 'misc'],
  LODGING_PRICE_TIERS: ['budget', 'mid', 'splurge'],
}));

vi.mock('$lib/server/config.js', () => ({
  getEffectiveConfig: () => ({ features: { extract: { provider: 'anthropic', model: 'claude-sonnet-4-6' } } }),
}));

import { extractCandidates } from '../src/lib/server/extract-candidates.js';
import { writePlan, readPlan } from '../src/lib/server/plan.js';
import { writeCandidates, readCandidates } from '../src/lib/server/candidates.js';

describe('extractCandidates', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('writes plan.md frontmatter and candidates.md from chat() output', async () => {
    mockChat.mockResolvedValueOnce({
      text: `<extract>
<plan>
field_guide_notes: |
  Park notes here.
gotchas: |
  Cell dead past Apgar.
</plan>
<candidates>
stops:
  - name: Lake McDonald
    category: outdoors
    description: Glacial lake.
    why_recommended: Iconic shoreline.
    source_url: https://nps.gov
lodging:
  - name: Whitefish Inn
    description: Comfortable mid-range.
    price_tier: mid
    nights: 2
    booking_url: https://example.com
</candidates>
</extract>`,
      usage: { input: 100, output: 200 },
    });

    const result = await extractCandidates('t');

    expect(mockChat).toHaveBeenCalledWith(expect.objectContaining({
      label: 'extract-candidates',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
    }));

    expect(writePlan).toHaveBeenCalledWith('t', expect.objectContaining({
      field_guide_notes: expect.stringContaining('Park notes'),
      gotchas: expect.stringContaining('Cell dead'),
      days: [],
    }));

    expect(writeCandidates).toHaveBeenCalledWith('t', expect.objectContaining({
      stops: [expect.objectContaining({ id: 'lake-mcdonald', name: 'Lake McDonald', category: 'outdoors', user_added: false })],
      lodging: [expect.objectContaining({ id: 'whitefish-inn', price_tier: 'mid', user_added: false })],
    }));

    expect(result.usage).toEqual({ input: 100, output: 200 });
  });

  it('throws TraverseError on malformed chat output', async () => {
    mockChat.mockResolvedValueOnce({ text: 'no XML here', usage: { input: 0, output: 0 } });
    await expect(extractCandidates('t')).rejects.toThrow(/extract/i);
  });

  it('throws TraverseError when <plan> block is missing inside <extract>', async () => {
    mockChat.mockResolvedValueOnce({
      text: `<extract>
<candidates>
stops: []
lodging: []
</candidates>
</extract>`,
      usage: { input: 0, output: 0 },
    });
    await expect(extractCandidates('t')).rejects.toThrow(/plan/i);
  });

  it('throws TraverseError when <candidates> block is missing inside <extract>', async () => {
    mockChat.mockResolvedValueOnce({
      text: `<extract>
<plan>
field_guide_notes: ""
</plan>
</extract>`,
      usage: { input: 0, output: 0 },
    });
    await expect(extractCandidates('t')).rejects.toThrow(/candidates/i);
  });

  it('throws TraverseError on malformed YAML inside <plan>', async () => {
    mockChat.mockResolvedValueOnce({
      text: `<extract>
<plan>
field_guide_notes: [oops: bad
</plan>
<candidates>
stops: []
lodging: []
</candidates>
</extract>`,
      usage: { input: 0, output: 0 },
    });
    await expect(extractCandidates('t')).rejects.toThrow(/yaml/i);
  });

  it('defaults invalid category to "misc"', async () => {
    mockChat.mockResolvedValueOnce({
      text: `<extract>
<plan>
field_guide_notes: ""
</plan>
<candidates>
stops:
  - name: Weird Place
    category: not-a-real-category
    description: d
    why_recommended: w
lodging: []
</candidates>
</extract>`,
      usage: { input: 0, output: 0 },
    });

    await extractCandidates('t');

    expect(writeCandidates).toHaveBeenCalledWith('t', expect.objectContaining({
      stops: [expect.objectContaining({ name: 'Weird Place', category: 'misc' })],
    }));
  });

  it('defaults invalid price_tier to "mid"', async () => {
    mockChat.mockResolvedValueOnce({
      text: `<extract>
<plan>
field_guide_notes: ""
</plan>
<candidates>
stops: []
lodging:
  - name: Fancy Stay
    description: d
    price_tier: ultra-luxe
</candidates>
</extract>`,
      usage: { input: 0, output: 0 },
    });

    await extractCandidates('t');

    expect(writeCandidates).toHaveBeenCalledWith('t', expect.objectContaining({
      lodging: [expect.objectContaining({ name: 'Fancy Stay', price_tier: 'mid' })],
    }));
  });

  it('disambiguates duplicate ids across stops and lodging', async () => {
    mockChat.mockResolvedValueOnce({
      text: `<extract>
<plan>
field_guide_notes: ""
</plan>
<candidates>
stops:
  - name: Inn
    category: misc
    description: A stop named Inn.
    why_recommended: w
lodging:
  - name: Inn
    description: A lodging also named Inn.
    price_tier: mid
</candidates>
</extract>`,
      usage: { input: 0, output: 0 },
    });

    await extractCandidates('t');

    expect(writeCandidates).toHaveBeenCalledWith('t', expect.objectContaining({
      stops: [expect.objectContaining({ id: 'inn', name: 'Inn' })],
      lodging: [expect.objectContaining({ id: 'inn-2', name: 'Inn' })],
    }));
  });

  it('preserves user_added candidates on re-extract', async () => {
    readCandidates.mockReturnValueOnce({
      stops: [
        { id: 'lake', name: 'Lake', category: 'outdoors', user_added: false },
        { id: 'my-pick', name: 'My Pick', category: 'misc', user_added: true },
      ],
      lodging: [{ id: 'my-inn', name: 'My Inn', price_tier: 'mid', user_added: true }],
    });
    readPlan.mockReturnValueOnce(null);
    mockChat.mockResolvedValueOnce({
      text: `<extract>
<plan>
field_guide_notes: ""
gotchas: ""
</plan>
<candidates>
stops:
  - name: New Stop
    category: outdoors
    description: ""
    why_recommended: ""
lodging: []
</candidates>
</extract>`,
      usage: { input: 0, output: 0 },
    });

    await extractCandidates('t');

    const writtenCands = writeCandidates.mock.calls[0][1];
    const ids = [...writtenCands.stops.map((s) => s.id), ...writtenCands.lodging.map((l) => l.id)];
    expect(ids).toContain('my-pick');     // user-added preserved
    expect(ids).toContain('my-inn');      // user-added lodging preserved
    expect(ids).toContain('new-stop');    // new researcher candidate
    expect(ids).not.toContain('lake');    // prior researcher replaced
  });

  it('preserves plan.days on re-extract', async () => {
    readPlan.mockReturnValueOnce({
      field_guide_notes: 'old notes',
      gotchas: 'old gotchas',
      days: [{ number: 1, stops: ['my-pick'], lodging_id: 'my-inn' }],
    });
    readCandidates.mockReturnValueOnce({
      stops: [{ id: 'my-pick', name: 'My Pick', category: 'misc', user_added: true }],
      lodging: [{ id: 'my-inn', name: 'My Inn', price_tier: 'mid', user_added: true }],
    });
    mockChat.mockResolvedValueOnce({
      text: `<extract>
<plan>
field_guide_notes: new notes
gotchas: new gotchas
</plan>
<candidates>
stops: []
lodging: []
</candidates>
</extract>`,
      usage: { input: 0, output: 0 },
    });

    await extractCandidates('t');
    const writtenPlan = writePlan.mock.calls[0][1];
    expect(writtenPlan.days).toEqual([{ number: 1, stops: ['my-pick'], lodging_id: 'my-inn' }]);
    expect(writtenPlan.field_guide_notes).toBe('new notes');
  });

  it('reassigns user-added id on collision with new researcher id', async () => {
    readCandidates.mockReturnValueOnce({
      stops: [{ id: 'lake', name: 'Lake', category: 'outdoors', user_added: true }],
      lodging: [],
    });
    readPlan.mockReturnValueOnce(null);
    mockChat.mockResolvedValueOnce({
      text: `<extract>
<plan>
field_guide_notes: ""
gotchas: ""
</plan>
<candidates>
stops:
  - name: Lake
    category: outdoors
    description: ""
    why_recommended: ""
lodging: []
</candidates>
</extract>`,
      usage: { input: 0, output: 0 },
    });

    await extractCandidates('t');
    const writtenCands = writeCandidates.mock.calls[0][1];
    const ids = writtenCands.stops.map((s) => s.id);
    expect(ids).toContain('lake');     // researcher's new entry keeps the slug
    expect(ids).toContain('lake-2');   // user-added reassigned to avoid collision
  });

  it('rewrites plan.days references when a user-added id is reassigned on collision', async () => {
    // User added 'Pine Lodge' → 'pine-lodge', promoted to day 1.
    readCandidates.mockReturnValueOnce({
      stops: [{ id: 'pine-lodge', name: 'Pine Lodge', category: 'outdoors', user_added: true }],
      lodging: [],
    });
    readPlan.mockReturnValueOnce({
      field_guide_notes: 'old',
      gotchas: 'old',
      days: [{ number: 1, stops: ['pine-lodge'], lodging_id: null }],
    });
    // Researcher's new extraction includes a different 'Pine Lodge' that slugifies to 'pine-lodge'.
    mockChat.mockResolvedValueOnce({
      text: `<extract>
<plan>
field_guide_notes: ""
gotchas: ""
</plan>
<candidates>
stops:
  - name: Pine Lodge
    category: outdoors
    description: ""
    why_recommended: ""
lodging: []
</candidates>
</extract>`,
      usage: { input: 0, output: 0 },
    });

    await extractCandidates('t');

    // User-added candidate got reassigned to 'pine-lodge-2' …
    const writtenCands = writeCandidates.mock.calls[0][1];
    const userAdded = writtenCands.stops.find((s) => s.user_added);
    expect(userAdded.id).toBe('pine-lodge-2');
    // … and plan.days[0].stops should now point at 'pine-lodge-2', not the
    // researcher's new 'pine-lodge'. This is the core fix — without the rewrite
    // the user's promoted stop silently rebinds to a different real-world place.
    const writtenPlan = writePlan.mock.calls[0][1];
    expect(writtenPlan.days[0].stops).toEqual(['pine-lodge-2']);
  });

  it('geocodes candidate names that arrive without coords', async () => {
    readCandidates.mockReturnValueOnce(null);
    readPlan.mockReturnValueOnce(null);
    mockChat.mockResolvedValueOnce({
      text: `<extract>
<plan>
field_guide_notes: ""
gotchas: ""
</plan>
<candidates>
stops:
  - name: Lake McDonald
    category: outdoors
    description: ""
    why_recommended: ""
lodging:
  - name: Whitefish Inn
    price_tier: mid
</candidates>
</extract>`,
      usage: { input: 0, output: 0 },
    });
    mockGeocode.mockImplementation(async (q) => {
      if (q === 'Lake McDonald') return [48.5, -113.9];
      if (q === 'Whitefish Inn, Glacier MT') return [48.41, -114.34];
      return null;
    });

    await extractCandidates('t');

    const writtenCands = writeCandidates.mock.calls[0][1];
    expect(writtenCands.stops[0].coords).toEqual({ lat: 48.5, lng: -113.9 });
    // Whitefish Inn: first call returns null, falls back to name+destination.
    expect(writtenCands.lodging[0].coords).toEqual({ lat: 48.41, lng: -114.34 });
  });

  it('preserves pre-existing coords on user-added candidates instead of re-geocoding', async () => {
    const preCoords = { lat: 1, lng: 2 };
    readCandidates.mockReturnValueOnce({
      stops: [{ id: 'a', name: 'A', category: 'outdoors', user_added: true, coords: preCoords }],
      lodging: [],
    });
    readPlan.mockReturnValueOnce(null);
    mockChat.mockResolvedValueOnce({
      text: '<extract><plan>\nfield_guide_notes: ""\ngotchas: ""\n</plan><candidates>\nstops: []\nlodging: []\n</candidates></extract>',
      usage: { input: 0, output: 0 },
    });
    mockGeocode.mockResolvedValue(null);

    await extractCandidates('t');

    const writtenCands = writeCandidates.mock.calls[0][1];
    const a = writtenCands.stops.find((s) => s.id === 'a');
    expect(a.coords).toEqual(preCoords);
  });
});

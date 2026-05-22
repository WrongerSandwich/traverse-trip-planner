import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockChat = vi.hoisted(() => vi.fn());
vi.mock('$lib/server/ai.js', () => ({ chat: mockChat }));

vi.mock('$lib/server/data.js', () => ({
  ROOT: '/test',
  readHomeMd: () => '---\ntravelers: [you]\n---\n',
  getTripFiles: () => ({
    slug: 't',
    stage: 'planning',
    files: { overview: 'Glacier prose', route: 'Drive prose', stops: 'Stop prose', logistics: 'Logistics prose' },
  }),
  findTripLocation: () => ({ kind: 'dir', path: '/test/planning/t', stage: 'planning' }),
}));

vi.mock('$lib/server/plan.js', () => ({
  emptyPlan: () => ({ cover_query: '', field_guide_notes: '', gotchas: '', days: [] }),
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
import { writePlan } from '../src/lib/server/plan.js';
import { writeCandidates } from '../src/lib/server/candidates.js';

describe('extractCandidates', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('writes plan.md frontmatter and candidates.md from chat() output', async () => {
    mockChat.mockResolvedValueOnce({
      text: `<extract>
<plan>
cover_query: Glacier mountains
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
      cover_query: 'Glacier mountains',
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
cover_query: x
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
cover_query: "unterminated
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
cover_query: x
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
cover_query: x
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
cover_query: x
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
});

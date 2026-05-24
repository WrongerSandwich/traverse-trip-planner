import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted mocks
const mockChat = vi.hoisted(() => vi.fn());
vi.mock('$lib/server/ai.js', () => ({
  chat: mockChat,
  formatUsage: () => 'usage: stub',
}));

const mockSearch = vi.hoisted(() => vi.fn());
const mockSearchToolDefinition = vi.hoisted(() => vi.fn(() => ({ name: 'web_search' })));
vi.mock('$lib/server/search.js', () => ({
  search: mockSearch,
  searchToolDefinition: mockSearchToolDefinition,
}));

const mockAddCandidateStop = vi.hoisted(() => vi.fn(() => 'mound-city-group'));
const mockAddCandidateLodging = vi.hoisted(() => vi.fn(() => 'the-edgewater'));
const mockReadCandidates = vi.hoisted(() => vi.fn(() => ({ stops: [], lodging: [] })));
const mockGeocodeCandidate = vi.hoisted(() => vi.fn(async () => [39.37, -83.0]));
const mockGetDestinationRefCoords = vi.hoisted(() => vi.fn(async () => [39.33, -82.98]));
vi.mock('$lib/server/candidates.js', () => ({
  addCandidateStop: mockAddCandidateStop,
  addCandidateLodging: mockAddCandidateLodging,
  readCandidates: mockReadCandidates,
  geocodeCandidate: mockGeocodeCandidate,
  getDestinationRefCoords: mockGetDestinationRefCoords,
  STOP_CATEGORIES: ['historic', 'food', 'outdoors', 'view', 'entertainment', 'cultural', 'quirky', 'shopping', 'misc'],
  LODGING_PRICE_TIERS: ['budget', 'mid', 'splurge'],
}));

vi.mock('$lib/server/data.js', () => ({
  readHomeMd: () => '---\ntravelers: [you]\n---\n',
  parseFrontmatter: (text) => {
    const m = text.match(/^---\n([\s\S]*?)\n---/);
    if (!m) return null;
    const fm = {};
    for (const line of m[1].split('\n')) {
      const mm = line.match(/^([^:]+):\s*(.*)$/);
      if (mm) fm[mm[1].trim()] = mm[2].trim();
    }
    return fm;
  },
  invalidateEnrichCache: vi.fn(),
  rejectInvalidSlug: () => null,
  ROOT: '/test',
  findTripFile: () => '/test/planning/great-smoky-ramble/overview.md',
}));

const mockExistsSync = vi.hoisted(() => vi.fn(() => true));
const mockReadFileSync = vi.hoisted(() => vi.fn(() => '---\nstatus: planning\ndestination: Chillicothe, OH\n---\nprose'));
vi.mock('node:fs', () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
}));
vi.mock('fs', () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
}));

vi.mock('$lib/server/config.js', () => ({
  getEffectiveConfig: () => ({
    assistantName: 'Field Guide',
    features: { 'add-candidate': { provider: 'anthropic', model: 'claude-sonnet-4-6' } },
  }),
  getFeatureAvailability: () => ({ homeMdReady: true }),
}));

vi.mock('$lib/server/rate-limit.js', () => ({
  rateLimitResponse: () => null,
}));

// SUT
const { POST } = await import('../src/routes/api/actions/add-candidate/[slug]/+server.js');

function buildEvent(body) {
  return {
    params: { slug: 'great-smoky-ramble' },
    request: { json: async () => body },
    getClientAddress: () => '127.0.0.1',
  };
}

// Read every SSE event from a Response and return the array of parsed events.
async function readSse(res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const events = [];
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 2);
      if (!chunk.startsWith('data:')) continue;
      const json = chunk.slice(5).trim();
      try { events.push(JSON.parse(json)); } catch { /* ignore heartbeats */ }
    }
  }
  return events;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/actions/add-candidate/[slug] — happy path (stop)', () => {
  it('parses <candidate> YAML, geocodes, calls addCandidateStop, ends with ok event', async () => {
    mockChat.mockResolvedValueOnce({
      text: `<candidate>
name: Mound City Group
category: historic
description: Earthworks site of the Hopewell culture, with a short interpretive loop.
why_recommended: Matches your taste for low-foot-traffic historic sites.
source_url: https://www.nps.gov/hocu/index.htm
</candidate>`,
      usage: { input_tokens: 100, output_tokens: 200 },
    });

    const res = await POST(buildEvent({ name: 'Mound City Group', type: 'stop' }));
    expect(res.status).toBe(200);
    const events = await readSse(res);
    const terminal = events[events.length - 1];
    expect(terminal.done).toBe(true);
    expect(terminal.code).toBeFalsy(); // no error code
    expect(mockAddCandidateStop).toHaveBeenCalledTimes(1);
    const fields = mockAddCandidateStop.mock.calls[0][1];
    expect(fields.name).toBe('Mound City Group');
    expect(fields.category).toBe('historic');
    expect(fields.coords).toEqual({ lat: 39.37, lng: -83.0 });
  });
});

describe('POST /api/actions/add-candidate — variants', () => {
  it('short-circuits when exact name already in pool (no chat() call)', async () => {
    mockReadCandidates.mockReturnValueOnce({
      stops: [{ id: 'mound-city-group', name: 'Mound City Group' }],
      lodging: [],
    });
    const res = await POST(buildEvent({ name: 'mound city group', type: 'stop' }));
    const events = await readSse(res);
    const terminal = events[events.length - 1];
    expect(terminal.code).toBe('candidate_duplicate');
    expect(mockChat).not.toHaveBeenCalled();
    expect(mockAddCandidateStop).not.toHaveBeenCalled();
  });

  it('routes <duplicate> envelope to candidate_duplicate error', async () => {
    mockChat.mockResolvedValueOnce({
      text: `<duplicate>Mound City Group</duplicate>`,
      usage: { input_tokens: 50, output_tokens: 30 },
    });
    const res = await POST(buildEvent({ name: 'Mound City NHP', type: 'stop' }));
    const events = await readSse(res);
    const terminal = events[events.length - 1];
    expect(terminal.code).toBe('candidate_duplicate');
    expect(terminal.context.name).toBe('Mound City Group');
    expect(mockAddCandidateStop).not.toHaveBeenCalled();
  });

  it('routes <not-applicable> envelope to invalid_input', async () => {
    mockChat.mockResolvedValueOnce({
      text: `<not-applicable>Not drivable from the route</not-applicable>`,
      usage: { input_tokens: 50, output_tokens: 30 },
    });
    const res = await POST(buildEvent({ name: 'Tokyo Tower', type: 'stop' }));
    const events = await readSse(res);
    const terminal = events[events.length - 1];
    expect(terminal.code).toBe('invalid_input');
    expect(mockAddCandidateStop).not.toHaveBeenCalled();
  });

  it('saves a lodging candidate via addCandidateLodging', async () => {
    mockChat.mockResolvedValueOnce({
      text: `<candidate>
name: The Mill Inn
description: Restored 19th-century mill with riverside rooms.
price_tier: mid
nights: 2
booking_url: https://example.com
</candidate>`,
      usage: { input_tokens: 100, output_tokens: 100 },
    });
    const res = await POST(buildEvent({ name: 'The Mill Inn', type: 'lodging' }));
    const events = await readSse(res);
    const terminal = events[events.length - 1];
    expect(terminal.code).toBeFalsy();
    expect(mockAddCandidateLodging).toHaveBeenCalledTimes(1);
    expect(mockAddCandidateStop).not.toHaveBeenCalled();
    const fields = mockAddCandidateLodging.mock.calls[0][1];
    expect(fields.price_tier).toBe('mid');
    expect(fields.nights).toBe(2);
  });

  it('saves without coords when geocode returns null', async () => {
    mockChat.mockResolvedValueOnce({
      text: `<candidate>
name: Obscure Spot
category: misc
description: A place.
why_recommended: Aligns with your taste.
source_url:
</candidate>`,
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    mockGeocodeCandidate.mockResolvedValueOnce(null);
    const res = await POST(buildEvent({ name: 'Obscure Spot', type: 'stop' }));
    const events = await readSse(res);
    const terminal = events[events.length - 1];
    expect(terminal.code).toBeFalsy();
    const fields = mockAddCandidateStop.mock.calls[0][1];
    expect(fields.coords).toBeUndefined();
  });

  it('rejects empty name with invalid_input', async () => {
    const res = await POST(buildEvent({ name: '   ', type: 'stop' }));
    const events = await readSse(res);
    expect(events[events.length - 1].code).toBe('invalid_input');
    expect(mockChat).not.toHaveBeenCalled();
  });
});

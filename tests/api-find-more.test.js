import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TraverseError } from '../src/lib/server/errors.js';

const mockChat = vi.hoisted(() => vi.fn());
vi.mock('$lib/server/ai.js', () => ({ chat: mockChat, formatUsage: () => 'usage: stub' }));

const mockSearch = vi.hoisted(() => vi.fn());
const mockSearchToolDefinition = vi.hoisted(() => vi.fn(() => ({ name: 'web_search' })));
vi.mock('$lib/server/search.js', () => ({
  search: mockSearch,
  searchToolDefinition: mockSearchToolDefinition,
}));

const mockAddCandidateStop = vi.hoisted(() => vi.fn((slug, f) => f.name.toLowerCase().replace(/\W+/g, '-')));
const mockAddCandidateLodging = vi.hoisted(() => vi.fn((slug, f) => f.name.toLowerCase().replace(/\W+/g, '-')));
const mockReadCandidates = vi.hoisted(() => vi.fn(() => ({ stops: [{ id: 'mound-city', name: 'Mound City' }], lodging: [] })));
const mockGeocodeCandidate = vi.hoisted(() => vi.fn(async () => [40.0, -83.0]));
const mockGetDestinationRefCoords = vi.hoisted(() => vi.fn(async () => [40.0, -83.0]));
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
  DATA_DIR: '/test/data',
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
vi.mock('node:fs', () => ({ existsSync: mockExistsSync, readFileSync: mockReadFileSync }));
vi.mock('fs', () => ({ existsSync: mockExistsSync, readFileSync: mockReadFileSync }));

vi.mock('$lib/server/config.js', () => ({
  getEffectiveConfig: () => ({
    features: { 'find-more': { provider: 'anthropic', model: 'claude-sonnet-4-6' } },
  }),
  getFeatureAvailability: () => ({ homeMdReady: true }),
}));

vi.mock('$lib/server/rate-limit.js', () => ({ rateLimitResponse: () => null }));

const startedJobs = vi.hoisted(() => []);
const completedJobs = vi.hoisted(() => []);
const failedJobs = vi.hoisted(() => []);
const cancelledJobs = vi.hoisted(() => []);
vi.mock('$lib/server/jobs.js', () => ({
  assertNotRunning: vi.fn(),
  startJob: vi.fn((workflow, slug, opts) => {
    const j = { workflow, slug, opts, controller: new AbortController() };
    startedJobs.push(j);
    return j;
  }),
  completeJob: vi.fn((workflow, slug, opts) => { completedJobs.push({ workflow, slug, opts }); }),
  failJob: vi.fn((workflow, slug, opts) => { failedJobs.push({ workflow, slug, opts }); }),
  cancelJob: vi.fn((workflow, slug) => { cancelledJobs.push({ workflow, slug }); }),
}));

const { POST } = await import('../src/routes/api/actions/find-more/[slug]/+server.js');

function buildEvent(body) {
  return {
    params: { slug: 'great-smoky-ramble' },
    request: { json: async () => body },
    getClientAddress: () => '127.0.0.1',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  startedJobs.length = 0;
  completedJobs.length = 0;
  failedJobs.length = 0;
  cancelledJobs.length = 0;
});

describe('POST /api/actions/find-more/[slug] — happy path', () => {
  it('starts a job keyed by find-more:stop and returns 202', async () => {
    mockChat.mockResolvedValueOnce({
      text: `<additions>
stops:
  - name: Adena Mansion
    category: historic
    description: 19th-century estate with valley views.
    why_recommended: Aligns with your historic-sites tilt.
    source_url: https://www.ohiohistory.org
  - name: Tecumseh!
    category: entertainment
    description: Outdoor drama in a wooded amphitheater.
    why_recommended: Matches your taste for off-beat live experiences.
    source_url: https://tecumsehdrama.com
</additions>`,
      usage: { input_tokens: 400, output_tokens: 600 },
    });

    const res = await POST(buildEvent({ type: 'stop', steering: 'more outdoors', count: 5 }));
    expect(res.status).toBe(202);
    expect(startedJobs[0].workflow).toBe('find-more:stop');
    expect(startedJobs[0].slug).toBe('great-smoky-ramble');

    // Drain the fire-and-forget worker
    await new Promise((r) => setTimeout(r, 50));

    expect(mockAddCandidateStop).toHaveBeenCalledTimes(2);
    expect(completedJobs).toHaveLength(1);
    expect(completedJobs[0].workflow).toBe('find-more:stop');
  });
});

describe('POST /api/actions/find-more — variants', () => {
  it('drops additions whose name matches an existing candidate', async () => {
    mockReadCandidates.mockReturnValueOnce({
      stops: [{ id: 'mound-city', name: 'Mound City' }, { id: 'adena-mansion', name: 'Adena Mansion' }],
      lodging: [],
    });
    mockChat.mockResolvedValueOnce({
      text: `<additions>
stops:
  - name: Adena Mansion
    category: historic
    description: dup
  - name: Tecumseh!
    category: entertainment
    description: drama
</additions>`,
      usage: { input_tokens: 200, output_tokens: 100 },
    });
    const res = await POST(buildEvent({ type: 'stop', count: 5 }));
    expect(res.status).toBe(202);
    await new Promise((r) => setTimeout(r, 50));
    expect(mockAddCandidateStop).toHaveBeenCalledTimes(1);
    expect(mockAddCandidateStop.mock.calls[0][1].name).toBe('Tecumseh!');
  });

  it('appends lodging entries for type=lodging', async () => {
    mockChat.mockResolvedValueOnce({
      text: `<additions>
lodging:
  - name: The Mill Inn
    description: Riverside mill.
    price_tier: mid
    booking_url: https://example.com
  - name: Lodge B
    description: Cabin cluster.
    price_tier: budget
</additions>`,
      usage: { input_tokens: 200, output_tokens: 100 },
    });
    const res = await POST(buildEvent({ type: 'lodging', count: 5 }));
    expect(res.status).toBe(202);
    await new Promise((r) => setTimeout(r, 50));
    expect(mockAddCandidateLodging).toHaveBeenCalledTimes(2);
    expect(mockAddCandidateStop).not.toHaveBeenCalled();
  });

  it('returns 409 when assertNotRunning throws already_running', async () => {
    const jobs = await import('$lib/server/jobs.js');
    jobs.assertNotRunning.mockImplementationOnce(() => {
      throw new TraverseError('already_running', 'find-more is already running');
    });
    const res = await POST(buildEvent({ type: 'stop', count: 5 }));
    expect(res.status).toBe(409);
  });

  it('clamps count to [3, 10] range', async () => {
    mockChat.mockResolvedValueOnce({
      text: `<additions>
stops: []
</additions>`,
      usage: { input_tokens: 50, output_tokens: 20 },
    });
    const res = await POST(buildEvent({ type: 'stop', count: 50 }));
    expect(res.status).toBe(202);
    await new Promise((r) => setTimeout(r, 50));
    // The system prompt starts with "You find ${count} additional" — count=50 clamps to 10
    const systemPrompt = mockChat.mock.calls[0][0].system;
    expect(systemPrompt).toContain('You find 10 additional');
  });

  it('parses YAML failure to failJob with model_returned_invalid_yaml', async () => {
    mockChat.mockResolvedValueOnce({
      text: `<additions>
stops:
  - name: [{ invalid yaml here
</additions>`,
      usage: { input_tokens: 200, output_tokens: 100 },
    });
    const res = await POST(buildEvent({ type: 'stop', count: 5 }));
    expect(res.status).toBe(202);
    await new Promise((r) => setTimeout(r, 50));
    expect(failedJobs).toHaveLength(1);
    expect(failedJobs[0].opts.code).toBe('model_returned_invalid_yaml');
  });

  it('fails with empty_model_output when chat returns no <additions> block', async () => {
    mockChat.mockResolvedValueOnce({
      text: 'Sorry, I could not find any additional stops for this trip.',
      usage: { input_tokens: 200, output_tokens: 50 },
    });
    const res = await POST(buildEvent({ type: 'stop', count: 5 }));
    expect(res.status).toBe(202);
    await new Promise((r) => setTimeout(r, 50));
    expect(failedJobs).toHaveLength(1);
    expect(failedJobs[0].opts.code).toBe('empty_model_output');
    expect(mockAddCandidateStop).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/actions/find-more/[slug]', () => {
  it('cancels the find-more:<type> job', async () => {
    const event = {
      params: { slug: 'great-smoky-ramble' },
      request: { url: 'http://localhost/api/actions/find-more/great-smoky-ramble?type=lodging' },
    };
    const { DELETE } = await import('../src/routes/api/actions/find-more/[slug]/+server.js');
    const res = await DELETE(event);
    expect(res.status).toBe(200);
    expect(cancelledJobs[0].workflow).toBe('find-more:lodging');
    expect(cancelledJobs[0].slug).toBe('great-smoky-ramble');
  });
});

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Mock the AI + search layer at module boundary.
// chat() is fully replaced so provider/model validation never fires.
const mockChat = vi.hoisted(() => vi.fn());
const mockSearchToolDefinition = vi.hoisted(() => vi.fn(() => ({ name: 'web_search' })));
const mockSearch = vi.hoisted(() => vi.fn());

vi.mock('../src/lib/server/ai.js', () => ({
  chat: mockChat,
}));
vi.mock('../src/lib/server/search.js', () => ({
  search: mockSearch,
  searchToolDefinition: mockSearchToolDefinition,
}));

// Real filesystem via mocked findTripLocation — ROOT is set in beforeEach.
let ROOT;

vi.mock('$lib/server/data.js', async () => {
  const actual = await vi.importActual('$lib/server/data.js');
  return {
    ...actual,
    findTripFile: (slug) => {
      const p = join(ROOT, 'planning', slug, 'overview.md');
      return existsSync(p) ? p : null;
    },
    findTripLocation: (slug) => {
      const path = join(ROOT, 'planning', slug);
      return existsSync(path) ? { kind: 'dir', path, stage: 'planning' } : null;
    },
    parseFrontmatter: actual.parseFrontmatter,
  };
});

// Config mock — provides provider/model so chat() would receive them even
// though chat() itself is mocked and ignores them.
vi.mock('$lib/server/config.js', () => ({
  getEffectiveConfig: () => ({
    features: {
      'enrich-candidates': { provider: 'anthropic', model: 'test-model' },
    },
  }),
  getFeatureAvailability: () => ({ homeMdReady: true }),
}));

import { enrichCandidatesJob } from '../src/lib/server/enrich-job.js';
import { readCandidates } from '../src/lib/server/candidates.js';

// ── helpers ─────────────────────────────────────────────────────────────────

/**
 * Write overview.md + candidates.yaml for a trip under ROOT/planning/<slug>/.
 * `stopsYaml` is the YAML text for the `stops:` array entries (already indented
 * with two leading spaces per item).
 */
function seedTrip(slug, stopsYaml) {
  const dir = join(ROOT, 'planning', slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'overview.md'),
    '---\ntitle: T\nstatus: planning\ndestination: Empire MI\n---\n',
  );
  writeFileSync(
    join(dir, 'candidates.yaml'),
    `stops:\n${stopsYaml}lodging: []\n`,
  );
}

/**
 * Queue one mock chat() response that returns well-formed YAML inside <enrich>.
 */
function mockChatReturn(yaml) {
  mockChat.mockResolvedValueOnce({
    text: `<enrich>\n${yaml}\n</enrich>`,
    usage: { input: 100, output: 50 },
  });
}

// ── lifecycle ────────────────────────────────────────────────────────────────

beforeEach(() => {
  ROOT = mkdtempSync(join(tmpdir(), 'enrich-job-'));
  vi.clearAllMocks();
  mockSearchToolDefinition.mockReturnValue({ name: 'web_search' });
});

afterEach(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

// ── tests ────────────────────────────────────────────────────────────────────

describe('enrichCandidatesJob', () => {
  test('happy path — writes hours/website/phone for a candidate', async () => {
    const slug = 'enrich-rt';
    seedTrip(slug,
      '  - id: a\n    name: Place A\n    category: misc\n    user_added: false\n');

    mockChatReturn('hours: "9am-5pm"\nwebsite: "https://a.example"\nphone: "(555) 100-2000"');

    const result = await enrichCandidatesJob(slug);

    const cands = readCandidates(slug);
    expect(cands.stops[0].hours).toBe('9am-5pm');
    expect(cands.stops[0].website).toBe('https://a.example');
    expect(cands.stops[0].phone).toBe('(555) 100-2000');
    expect(result).toMatchObject({ enriched: 1, attempted: 1, failed: 0, skipped: 0 });
    expect(mockChat).toHaveBeenCalledOnce();
  });

  test('skips candidates that already have all three fields (no force)', async () => {
    const slug = 'enrich-skip';
    seedTrip(slug,
      '  - id: a\n    name: A\n    category: misc\n    hours: "x"\n    website: "https://x.com"\n    phone: "1"\n    user_added: false\n');

    const result = await enrichCandidatesJob(slug);

    expect(mockChat).not.toHaveBeenCalled();
    expect(result.enriched).toBe(0);
    expect(result.skipped).toBe(1);
  });

  test('force mode re-runs even when all three fields are already set', async () => {
    const slug = 'enrich-force';
    seedTrip(slug,
      '  - id: a\n    name: A\n    category: misc\n    hours: "old"\n    website: "https://old.com"\n    phone: "old"\n    user_added: false\n');

    mockChatReturn('hours: "new"\nwebsite: "https://new.com"\nphone: "new-phone"');

    await enrichCandidatesJob(slug, { force: true });

    const cands = readCandidates(slug);
    expect(cands.stops[0].hours).toBe('new');
    expect(cands.stops[0].website).toBe('https://new.com');
    expect(mockChat).toHaveBeenCalledOnce();
  });

  test('skips hidden candidates without calling chat()', async () => {
    const slug = 'enrich-hidden';
    seedTrip(slug,
      '  - id: a\n    name: A\n    category: misc\n    hidden: true\n    user_added: false\n');

    const result = await enrichCandidatesJob(slug);

    expect(mockChat).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
    expect(result.attempted).toBe(0);
  });

  test('continues past per-stop parse failure — partial success', async () => {
    const slug = 'enrich-partial';
    seedTrip(slug,
      '  - id: a\n    name: A\n    category: misc\n    user_added: false\n' +
      '  - id: b\n    name: B\n    category: misc\n    user_added: false\n');

    // First stop returns garbage; second returns valid YAML.
    mockChat.mockResolvedValueOnce({ text: 'GARBAGE NO TAGS', usage: { input: 10, output: 5 } });
    mockChat.mockResolvedValueOnce({
      text: '<enrich>\nhours: "ok"\nwebsite: "https://b.example"\nphone: "555"\n</enrich>',
      usage: { input: 10, output: 5 },
    });

    const result = await enrichCandidatesJob(slug);

    const cands = readCandidates(slug);
    expect(cands.stops[0].hours).toBeUndefined();
    expect(cands.stops[1].hours).toBe('ok');
    expect(result).toMatchObject({ attempted: 2, enriched: 1, failed: 1 });
  });

  test('throws enrich_all_failed when every attempted stop fails', async () => {
    const slug = 'enrich-all-fail';
    seedTrip(slug,
      '  - id: a\n    name: A\n    category: misc\n    user_added: false\n');

    mockChat.mockResolvedValueOnce({ text: 'BAD — no tags', usage: { input: 10, output: 5 } });

    await expect(enrichCandidatesJob(slug)).rejects.toMatchObject({ code: 'enrich_all_failed' });
  });

  test('aborts cleanly mid-loop — first stop enriched, second never attempted', async () => {
    const slug = 'enrich-abort';
    seedTrip(slug,
      '  - id: a\n    name: A\n    category: misc\n    user_added: false\n' +
      '  - id: b\n    name: B\n    category: misc\n    user_added: false\n');

    const controller = new AbortController();

    // First chat() succeeds AND fires the abort — the loop's top-of-iteration
    // check on the second item should see the signal as aborted.
    mockChat.mockImplementationOnce(async () => {
      controller.abort();
      return {
        text: '<enrich>\nhours: "first"\nwebsite: "https://1.example"\nphone: "111"\n</enrich>',
        usage: { input: 10, output: 5 },
      };
    });

    const result = await enrichCandidatesJob(slug, { signal: controller.signal });

    const cands = readCandidates(slug);
    expect(cands.stops[0].hours).toBe('first');
    expect(cands.stops[1].hours).toBeUndefined();
    // Only one chat() was issued — the second stop was skipped due to abort.
    expect(mockChat).toHaveBeenCalledOnce();
    // attempted counts only the stops that were actually run.
    expect(result.attempted).toBe(1);
    expect(result.enriched).toBe(1);
  });
});

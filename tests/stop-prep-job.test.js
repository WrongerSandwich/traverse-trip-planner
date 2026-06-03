import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const mockChat = vi.hoisted(() => vi.fn());

vi.mock('../src/lib/server/ai.js', () => ({ chat: mockChat }));

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

vi.mock('$lib/server/config.js', () => ({
  getEffectiveConfig: () => ({
    features: { 'stop-prep': { provider: 'anthropic', model: 'test-model' } },
  }),
  getFeatureAvailability: () => ({ homeMdReady: true }),
}));

import { stopPrepJob } from '../src/lib/server/stop-prep-job.js';
import { readCandidates } from '../src/lib/server/candidates.js';

function seedTrip(slug, stopsYaml, { logistics = 'Parking is tight downtown.', plan = null } = {}) {
  const dir = join(ROOT, 'planning', slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'overview.md'), '---\ntitle: T\nstatus: planning\ndestination: Empire MI\n---\n');
  writeFileSync(join(dir, 'logistics.md'), logistics);
  writeFileSync(join(dir, 'candidates.yaml'), `stops:\n${stopsYaml}lodging: []\n`);
  if (plan) writeFileSync(join(dir, 'plan.yaml'), plan);
}

function mockPrepReturn(yaml) {
  mockChat.mockResolvedValueOnce({ text: `<prep>\n${yaml}\n</prep>`, usage: { input: 100, output: 50 } });
}

beforeEach(() => {
  ROOT = mkdtempSync(join(tmpdir(), 'stop-prep-'));
  vi.clearAllMocks();
});

afterEach(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

describe('stopPrepJob', () => {
  test('happy path — writes tips + wrapped todos for a stop', async () => {
    const slug = 'prep-rt';
    seedTrip(slug, '  - id: a\n    name: Place A\n    category: misc\n');
    mockPrepReturn('tips:\n  - "Arrive before 9am"\n  - "Bring water"\ntodos:\n  - "Book timed-entry ticket"\n  - "Download offline map"');

    const result = await stopPrepJob(slug);

    const cands = readCandidates(slug);
    expect(cands.stops[0].tips).toEqual(['Arrive before 9am', 'Bring water']);
    expect(cands.stops[0].todos).toHaveLength(2);
    expect(cands.stops[0].todos[0]).toMatchObject({ text: 'Book timed-entry ticket', done: false });
    expect(cands.stops[0].todos[0].id).toBeTruthy();
    expect(result).toMatchObject({ prepped: 1, attempted: 1, failed: 0, skipped: 0 });
    expect(mockChat).toHaveBeenCalledOnce();
  });

  test('passes no tools to chat() and includes trip context in the prompt', async () => {
    const slug = 'prep-ctx';
    seedTrip(slug, '  - id: a\n    name: A\n    category: misc\n', { logistics: 'UNIQUE_LOGISTICS_MARKER parking note.' });
    mockPrepReturn('tips:\n  - "t"\ntodos: []');

    await stopPrepJob(slug);

    const call = mockChat.mock.calls[0][0];
    expect(call.tools).toBeUndefined();
    const userMsg = call.messages.map((m) => m.content).join('\n');
    expect(userMsg).toContain('UNIQUE_LOGISTICS_MARKER');
  });

  test('reads trip context once even across multiple stops', async () => {
    const slug = 'prep-once';
    seedTrip(slug, '  - id: a\n    name: A\n    category: misc\n  - id: b\n    name: B\n    category: misc\n', { logistics: 'CTX_MARKER' });
    mockPrepReturn('tips:\n  - "t1"\ntodos: []');
    mockPrepReturn('tips:\n  - "t2"\ntodos: []');

    await stopPrepJob(slug);

    expect(mockChat).toHaveBeenCalledTimes(2);
    for (const call of mockChat.mock.calls) {
      const userMsg = call[0].messages.map((m) => m.content).join('\n');
      expect(userMsg).toContain('CTX_MARKER');
    }
  });

  test('skips a stop that already has tips (no force)', async () => {
    const slug = 'prep-skip';
    seedTrip(slug, '  - id: a\n    name: A\n    category: misc\n    tips:\n      - "already prepped"\n');

    const result = await stopPrepJob(slug);

    expect(mockChat).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
    expect(result.prepped).toBe(0);
  });

  test('force re-runs even when tips already exist', async () => {
    const slug = 'prep-force';
    seedTrip(slug, '  - id: a\n    name: A\n    category: misc\n    tips:\n      - "old"\n');
    mockPrepReturn('tips:\n  - "new"\ntodos: []');

    await stopPrepJob(slug, { force: true });

    expect(mockChat).toHaveBeenCalledOnce();
    expect(readCandidates(slug).stops[0].tips).toEqual(['new']);
  });

  test('skips hidden stops without calling chat()', async () => {
    const slug = 'prep-hidden';
    seedTrip(slug, '  - id: a\n    name: A\n    category: misc\n    hidden: true\n');

    const result = await stopPrepJob(slug);

    expect(mockChat).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
    expect(result.attempted).toBe(0);
  });

  test('caps tips at 5 and todos at 4', async () => {
    const slug = 'prep-caps';
    seedTrip(slug, '  - id: a\n    name: A\n    category: misc\n');
    mockPrepReturn('tips:\n' + Array.from({ length: 8 }, (_, i) => `  - "tip${i}"`).join('\n') + '\ntodos:\n' + Array.from({ length: 8 }, (_, i) => `  - "todo${i}"`).join('\n'));

    await stopPrepJob(slug);

    const stop = readCandidates(slug).stops[0];
    expect(stop.tips).toHaveLength(5);
    expect(stop.todos).toHaveLength(4);
  });

  test('both-empty result counts as a per-stop failure', async () => {
    const slug = 'prep-empty';
    seedTrip(slug, '  - id: a\n    name: A\n    category: misc\n');
    mockPrepReturn('tips: []\ntodos: []');

    await expect(stopPrepJob(slug)).rejects.toMatchObject({ code: 'stop_prep_all_failed' });
  });

  test('continues past a per-stop parse failure — partial success', async () => {
    const slug = 'prep-partial';
    seedTrip(slug, '  - id: a\n    name: A\n    category: misc\n  - id: b\n    name: B\n    category: misc\n');
    mockChat.mockResolvedValueOnce({ text: 'NO TAGS', usage: { input: 10, output: 5 } });
    mockPrepReturn('tips:\n  - "ok"\ntodos: []');

    const result = await stopPrepJob(slug);

    const cands = readCandidates(slug);
    expect(cands.stops[0].tips).toBeUndefined();
    expect(cands.stops[1].tips).toEqual(['ok']);
    expect(result).toMatchObject({ attempted: 2, prepped: 1, failed: 1 });
  });

  test('aborts cleanly mid-loop — first stop prepped, second never attempted', async () => {
    const slug = 'prep-abort';
    seedTrip(slug, '  - id: a\n    name: A\n    category: misc\n  - id: b\n    name: B\n    category: misc\n');
    const controller = new AbortController();
    mockChat.mockImplementationOnce(async () => {
      controller.abort();
      return { text: '<prep>\ntips:\n  - "first"\ntodos: []\n</prep>', usage: { input: 10, output: 5 } };
    });

    const result = await stopPrepJob(slug, { signal: controller.signal });

    const cands = readCandidates(slug);
    expect(cands.stops[0].tips).toEqual(['first']);
    expect(cands.stops[1].tips).toBeUndefined();
    expect(mockChat).toHaveBeenCalledOnce();
    expect(result.attempted).toBe(1);
    expect(result.prepped).toBe(1);
  });

  test('deletion between chat() resolve and write-back is a silent skip', async () => {
    const slug = 'prep-deleted';
    seedTrip(slug, '  - id: a\n    name: A\n    category: misc\n');
    mockChat.mockImplementationOnce(async () => {
      const path = join(ROOT, 'planning', slug, 'candidates.yaml');
      writeFileSync(path, 'stops: []\nlodging: []\n');
      return { text: '<prep>\ntips:\n  - "x"\ntodos: []\n</prep>', usage: { input: 10, output: 5 } };
    });

    const result = await stopPrepJob(slug);

    expect(result).toMatchObject({ attempted: 1, prepped: 0, failed: 0, skipped: 0 });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

// `realizePlan(slug, parsedExtract, { signal })` is the post-LLM half of the
// new unified deepen pipeline. The chat call has moved upstream into
// `doResearch()`; this module receives the already-parsed `plan` and
// `candidates` YAML blocks, then runs the same merge / geocoding / atomic
// write / rename-tracking work the old `extractCandidates` did.
//
// These tests mirror the contracts the old extract-candidates tests pinned —
// only the chat mock is gone; the input shape is pre-parsed objects.

const mockWriteFileSync = vi.hoisted(() => vi.fn());
const mockRenameSync = vi.hoisted(() => vi.fn());
// Default overview content includes `destination: Glacier MT` so realizePlan
// can read it directly off disk (getTripFiles strips frontmatter, so this is
// the only path that recovers it).
const mockReadFileSync = vi.hoisted(() => vi.fn(() => '---\ntitle: T\ndestination: Glacier MT\n---\n'));
const mockExistsSync = vi.hoisted(() => vi.fn(() => true));
vi.mock('node:fs', () => ({
  writeFileSync: mockWriteFileSync,
  renameSync: mockRenameSync,
  readFileSync: mockReadFileSync,
  existsSync: mockExistsSync,
}));

const mockGeocode = vi.hoisted(() => vi.fn(async () => ({ coords: null, fromCache: true })));
const mockFindTripFile = vi.hoisted(() => vi.fn(() => '/test/planning/t/overview.md'));
const mockSetFrontmatterField = vi.hoisted(() => vi.fn((content, _field, _value) => content));
const mockRemoveFrontmatterField = vi.hoisted(() => vi.fn((content, _field) => content));
const mockAtomicWrite = vi.hoisted(() => vi.fn());
vi.mock('$lib/server/data.js', () => ({
  DATA_DIR: '/test/data',
  ROOT: '/test',
  readHomeMd: () => '---\ntravelers: [you]\n---\n',
  getTripFiles: () => ({
    slug: 't',
    stage: 'planning',
    files: { overview: '---\ndestination: Glacier MT\n---\nGlacier prose', route: 'Drive prose', stops: 'Stop prose', logistics: 'Logistics prose' },
  }),
  findTripLocation: () => ({ kind: 'dir', path: '/test/planning/t', stage: 'planning' }),
  findTripFile: mockFindTripFile,
  setFrontmatterField: mockSetFrontmatterField,
  removeFrontmatterField: mockRemoveFrontmatterField,
  atomicWrite: mockAtomicWrite,
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

// serializePlanFile and serializeCandidatesFile are captured so tests can
// inspect the plan/candidates objects that were staged for write.
const capturedPlan = vi.hoisted(() => ({ value: null }));
const capturedCands = vi.hoisted(() => ({ value: null }));

vi.mock('$lib/server/plan.js', () => ({
  emptyPlan: () => ({ cover_query: null, field_guide_notes: '', gotchas: '', days: [] }),
  readPlan: vi.fn(() => null),
  planPath: vi.fn(() => '/test/planning/t/plan.md'),
  serializePlanFile: vi.fn((plan) => { capturedPlan.value = plan; return `---\nplan: stub\n---\n`; }),
}));

vi.mock('$lib/server/candidates.js', async () => {
  const actual = await vi.importActual('$lib/server/candidates.js');
  return {
    emptyCandidates: () => ({ stops: [], lodging: [] }),
    readCandidates: vi.fn(() => null),
    candidatesPath: vi.fn(() => '/test/planning/t/candidates.md'),
    serializeCandidatesFile: vi.fn((cands) => { capturedCands.value = cands; return `---\ncands: stub\n---\n`; }),
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
    distanceMi: actual.distanceMi,
    geocodeCandidate: actual.geocodeCandidate,
    getDestinationRefCoords: actual.getDestinationRefCoords,
    MAX_CANDIDATE_DISTANCE_MI: actual.MAX_CANDIDATE_DISTANCE_MI,
  };
});

import { realizePlan } from '../src/lib/server/realize-plan.js';
import { readPlan } from '../src/lib/server/plan.js';
import { readCandidates } from '../src/lib/server/candidates.js';

// Convenience: build a parsed-extract block matching what doResearch() will
// hand us after parsing the unified envelope's <plan>YAML</plan> and
// <candidates>YAML</candidates> tags.
function makeExtract({ plan = {}, candidates = {} } = {}) {
  return { plan, candidates };
}

describe('realizePlan', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGeocode.mockReset();
    capturedPlan.value = null;
    capturedCands.value = null;
    mockGeocode.mockResolvedValue({ coords: null, fromCache: true });
    mockReadFileSync.mockReturnValue('---\ntitle: T\ndestination: Glacier MT\n---\n');
    mockExistsSync.mockReturnValue(true);
    mockFindTripFile.mockReturnValue('/test/planning/t/overview.md');
    mockSetFrontmatterField.mockImplementation((content, _field, _value) => content);
    mockRemoveFrontmatterField.mockImplementation((content, _field) => content);
  });

  it('writes plan and candidates from a pre-parsed extract block', async () => {
    const extract = makeExtract({
      plan: {
        field_guide_notes: 'Park notes here.',
        gotchas: 'Cell dead past Apgar.',
      },
      candidates: {
        stops: [{
          name: 'Lake McDonald',
          category: 'outdoors',
          description: 'Glacial lake.',
          why_recommended: 'Iconic shoreline.',
          source_url: 'https://nps.gov',
        }],
        lodging: [{
          name: 'Whitefish Inn',
          description: 'Comfortable mid-range.',
          price_tier: 'mid',
          nights: 2,
          booking_url: 'https://example.com',
        }],
      },
    });

    await realizePlan('t', extract);

    expect(capturedPlan.value).toMatchObject({
      field_guide_notes: expect.arrayContaining([expect.stringContaining('Park notes')]),
      gotchas: expect.arrayContaining([expect.stringContaining('Cell dead')]),
      days: [],
    });

    expect(capturedCands.value).toMatchObject({
      stops: [expect.objectContaining({ id: 'lake-mcdonald', name: 'Lake McDonald', category: 'outdoors', user_added: false })],
      lodging: [expect.objectContaining({ id: 'whitefish-inn', price_tier: 'mid', user_added: false })],
    });
  });

  it('captures cover_query from the extract into the plan', async () => {
    await realizePlan('t', makeExtract({
      plan: { cover_query: 'Glacier alpine lake mountains' },
      candidates: { stops: [], lodging: [] },
    }));

    expect(capturedPlan.value.cover_query).toBe('Glacier alpine lake mountains');
  });

  it('sets cover_query to null when extract omits it', async () => {
    await realizePlan('t', makeExtract({
      plan: { field_guide_notes: '', gotchas: '' },
      candidates: { stops: [], lodging: [] },
    }));

    expect(capturedPlan.value.cover_query).toBeNull();
  });

  it('stages both files to .tmp then renames both (atomic two-file write)', async () => {
    await realizePlan('t', makeExtract({
      plan: { field_guide_notes: '', gotchas: '' },
      candidates: { stops: [], lodging: [] },
    }));

    const writeOrder = mockWriteFileSync.mock.invocationCallOrder;
    const renameOrder = mockRenameSync.mock.invocationCallOrder;
    expect(Math.max(...writeOrder)).toBeLessThan(Math.min(...renameOrder));
    expect(mockRenameSync).toHaveBeenCalledWith(
      '/test/planning/t/plan.md.tmp',
      '/test/planning/t/plan.md',
    );
    expect(mockRenameSync).toHaveBeenCalledWith(
      '/test/planning/t/candidates.md.tmp',
      '/test/planning/t/candidates.md',
    );
  });

  it('defaults invalid category to "misc"', async () => {
    await realizePlan('t', makeExtract({
      plan: { field_guide_notes: '' },
      candidates: {
        stops: [{ name: 'Weird Place', category: 'not-a-real-category', description: 'd', why_recommended: 'w' }],
        lodging: [],
      },
    }));

    expect(capturedCands.value).toMatchObject({
      stops: [expect.objectContaining({ name: 'Weird Place', category: 'misc' })],
    });
  });

  it('defaults invalid price_tier to "mid"', async () => {
    await realizePlan('t', makeExtract({
      plan: { field_guide_notes: '' },
      candidates: {
        stops: [],
        lodging: [{ name: 'Fancy Stay', description: 'd', price_tier: 'ultra-luxe' }],
      },
    }));

    expect(capturedCands.value).toMatchObject({
      lodging: [expect.objectContaining({ name: 'Fancy Stay', price_tier: 'mid' })],
    });
  });

  it('disambiguates duplicate ids across stops and lodging', async () => {
    await realizePlan('t', makeExtract({
      plan: { field_guide_notes: '' },
      candidates: {
        stops: [{ name: 'Inn', category: 'misc', description: 'A stop named Inn.', why_recommended: 'w' }],
        lodging: [{ name: 'Inn', description: 'A lodging also named Inn.', price_tier: 'mid' }],
      },
    }));

    expect(capturedCands.value).toMatchObject({
      stops: [expect.objectContaining({ id: 'inn', name: 'Inn' })],
      lodging: [expect.objectContaining({ id: 'inn-2', name: 'Inn' })],
    });
  });

  it('preserves user_added candidates on re-realize', async () => {
    readCandidates.mockReturnValueOnce({
      stops: [
        { id: 'lake', name: 'Lake', category: 'outdoors', user_added: false },
        { id: 'my-pick', name: 'My Pick', category: 'misc', user_added: true },
      ],
      lodging: [{ id: 'my-inn', name: 'My Inn', price_tier: 'mid', user_added: true }],
    });
    readPlan.mockReturnValueOnce(null);

    await realizePlan('t', makeExtract({
      plan: { field_guide_notes: '', gotchas: '' },
      candidates: {
        stops: [{ name: 'New Stop', category: 'outdoors', description: '', why_recommended: '' }],
        lodging: [],
      },
    }));

    const ids = [...capturedCands.value.stops.map((s) => s.id), ...capturedCands.value.lodging.map((l) => l.id)];
    expect(ids).toContain('my-pick');
    expect(ids).toContain('my-inn');
    expect(ids).toContain('new-stop');
    expect(ids).not.toContain('lake');
  });

  it('preserves plan.days on re-realize and overwrites cover_query', async () => {
    readPlan.mockReturnValueOnce({
      cover_query: 'old',
      field_guide_notes: 'old notes',
      gotchas: 'old gotchas',
      days: [{ number: 1, stops: ['my-pick'], lodging_id: 'my-inn' }],
    });
    readCandidates.mockReturnValueOnce({
      stops: [{ id: 'my-pick', name: 'My Pick', category: 'misc', user_added: true }],
      lodging: [{ id: 'my-inn', name: 'My Inn', price_tier: 'mid', user_added: true }],
    });

    await realizePlan('t', makeExtract({
      plan: {
        cover_query: 'new',
        field_guide_notes: 'new notes',
        gotchas: 'new gotchas',
      },
      candidates: { stops: [], lodging: [] },
    }));

    expect(capturedPlan.value.days).toEqual([{ number: 1, stops: ['my-pick'], lodging_id: 'my-inn' }]);
    expect(capturedPlan.value.cover_query).toBe('new');
    expect(capturedPlan.value.field_guide_notes).toEqual(['new notes']);
  });

  it('reassigns user-added id on collision with new researcher id', async () => {
    readCandidates.mockReturnValueOnce({
      stops: [{ id: 'lake', name: 'Lake', category: 'outdoors', user_added: true }],
      lodging: [],
    });
    readPlan.mockReturnValueOnce(null);

    await realizePlan('t', makeExtract({
      plan: { field_guide_notes: '', gotchas: '' },
      candidates: {
        stops: [{ name: 'Lake', category: 'outdoors', description: '', why_recommended: '' }],
        lodging: [],
      },
    }));

    const ids = capturedCands.value.stops.map((s) => s.id);
    expect(ids).toContain('lake');
    expect(ids).toContain('lake-2');
  });

  it('rewrites plan.days references when a user-added id is reassigned on collision', async () => {
    readCandidates.mockReturnValueOnce({
      stops: [{ id: 'pine-lodge', name: 'Pine Lodge', category: 'outdoors', user_added: true }],
      lodging: [],
    });
    readPlan.mockReturnValueOnce({
      field_guide_notes: 'old',
      gotchas: 'old',
      days: [{ number: 1, stops: ['pine-lodge'], lodging_id: null }],
    });

    await realizePlan('t', makeExtract({
      plan: { field_guide_notes: '', gotchas: '' },
      candidates: {
        stops: [{ name: 'Pine Lodge', category: 'outdoors', description: '', why_recommended: '' }],
        lodging: [],
      },
    }));

    const userAdded = capturedCands.value.stops.find((s) => s.user_added);
    expect(userAdded.id).toBe('pine-lodge-2');
    expect(capturedPlan.value.days[0].stops).toEqual(['pine-lodge-2']);
  });

  it('preserves pre-existing coords on user-added candidates instead of re-geocoding', async () => {
    const preCoords = { lat: 1, lng: 2 };
    readCandidates.mockReturnValueOnce({
      stops: [{ id: 'a', name: 'A', category: 'outdoors', user_added: true, coords: preCoords }],
      lodging: [],
    });
    readPlan.mockReturnValueOnce(null);
    mockGeocode.mockResolvedValue({ coords: null, fromCache: true });

    await realizePlan('t', makeExtract({
      plan: { field_guide_notes: '', gotchas: '' },
      candidates: { stops: [], lodging: [] },
    }));

    const a = capturedCands.value.stops.find((s) => s.id === 'a');
    expect(a.coords).toEqual(preCoords);
  });

  it('preserves user-added candidate coords across re-realize', async () => {
    readCandidates.mockReturnValueOnce({
      stops: [{
        id: 'lake-mcdonald', name: 'Lake McDonald', category: 'outdoors', user_added: true,
        coords: { lat: 48.55, lng: -113.95 },
      }],
      lodging: [],
    });
    readPlan.mockReturnValueOnce(null);
    mockGeocode.mockImplementation(async (q) => {
      if (q === 'Glacier MT') return { coords: [48.7, -114.0], fromCache: true };
      throw new Error(`unexpected geocode call: ${q}`);
    });

    await realizePlan('t', makeExtract({
      plan: { field_guide_notes: '', gotchas: '' },
      candidates: { stops: [], lodging: [] },
    }));

    expect(capturedCands.value.stops[0].coords).toEqual({ lat: 48.55, lng: -113.95 });
  });

  it('hidden researcher candidate survives re-realize (user_added flip)', async () => {
    readCandidates.mockReturnValueOnce({
      stops: [{
        id: 'lake-mcdonald', name: 'Lake McDonald', category: 'outdoors',
        user_added: true, hidden: true,
      }],
      lodging: [],
    });
    readPlan.mockReturnValueOnce(null);

    await realizePlan('t', makeExtract({
      plan: { field_guide_notes: '', gotchas: '' },
      candidates: {
        stops: [{ name: 'Lake McDonald', category: 'outdoors', description: 'Glacial lake.', why_recommended: 'Iconic.' }],
        lodging: [],
      },
    }));

    const hidden = capturedCands.value.stops.find((s) => s.hidden);
    expect(hidden).toBeDefined();
    expect(hidden.id).toBe('lake-mcdonald');
    const allLake = capturedCands.value.stops.filter((s) => s.name === 'Lake McDonald');
    expect(allLake).toHaveLength(1);
  });

  it('un-hidden candidate can reappear on re-realize', async () => {
    readCandidates.mockReturnValueOnce({
      stops: [{ id: 'lake-mcdonald', name: 'Lake McDonald', category: 'outdoors', user_added: false }],
      lodging: [],
    });
    readPlan.mockReturnValueOnce(null);

    await realizePlan('t', makeExtract({
      plan: { field_guide_notes: '', gotchas: '' },
      candidates: {
        stops: [{ name: 'Lake McDonald', category: 'outdoors', description: 'Glacial lake.', why_recommended: 'Iconic.' }],
        lodging: [],
      },
    }));

    const stop = capturedCands.value.stops.find((s) => s.name === 'Lake McDonald');
    expect(stop).toBeDefined();
    expect(stop.hidden).toBeUndefined();
    expect(stop.user_added).toBe(false);
  });

  it('throws TraverseError when trip not found via getTripFiles', async () => {
    const { TraverseError } = await import('../src/lib/server/errors.js');
    const guard = (tripResult) => {
      if (!tripResult) throw new TraverseError('trip_not_found', 'realizePlan: trip "x" not found.');
    };
    expect(() => guard(null)).toThrow(TraverseError);
    let caught;
    try { guard(null); } catch (e) { caught = e; }
    expect(caught.code).toBe('trip_not_found');
  });

  // ── Rename surface (issue #349) ───────────────────────────────────────────

  it('returns an empty renames array when no user-added candidates collide', async () => {
    readCandidates.mockReturnValueOnce(null);
    readPlan.mockReturnValueOnce(null);

    const result = await realizePlan('t', makeExtract({
      plan: { field_guide_notes: '', gotchas: '' },
      candidates: {
        stops: [{ name: 'Lake McDonald', category: 'outdoors', description: '', why_recommended: '' }],
        lodging: [],
      },
    }));

    expect(result.renames).toEqual([]);
  });

  it('returns renames array with from/to entries when collision occurs', async () => {
    readCandidates.mockReturnValueOnce({
      stops: [{ id: 'lake', name: 'Lake', category: 'outdoors', user_added: true }],
      lodging: [],
    });
    readPlan.mockReturnValueOnce(null);

    const result = await realizePlan('t', makeExtract({
      plan: { field_guide_notes: '', gotchas: '' },
      candidates: {
        stops: [{ name: 'Lake', category: 'outdoors', description: '', why_recommended: '' }],
        lodging: [],
      },
    }));

    expect(result.renames).toEqual([{ from: 'lake', to: 'lake-2' }]);
  });

  it('writes last_extract_renames to overview frontmatter when renames happen', async () => {
    readCandidates.mockReturnValueOnce({
      stops: [{ id: 'lake', name: 'Lake', category: 'outdoors', user_added: true }],
      lodging: [],
    });
    readPlan.mockReturnValueOnce(null);

    await realizePlan('t', makeExtract({
      plan: { field_guide_notes: '', gotchas: '' },
      candidates: {
        stops: [{ name: 'Lake', category: 'outdoors', description: '', why_recommended: '' }],
        lodging: [],
      },
    }));

    expect(mockSetFrontmatterField).toHaveBeenCalledWith(
      expect.any(String),
      'last_extract_renames',
      expect.stringContaining('"lake"'),
    );
    expect(mockAtomicWrite).toHaveBeenCalledWith(
      '/test/planning/t/overview.md',
      expect.any(String),
    );
  });

  it('clears last_extract_renames from overview frontmatter when no renames happen', async () => {
    readCandidates.mockReturnValueOnce(null);
    readPlan.mockReturnValueOnce(null);

    await realizePlan('t', makeExtract({
      plan: { field_guide_notes: '', gotchas: '' },
      candidates: { stops: [], lodging: [] },
    }));

    expect(mockRemoveFrontmatterField).toHaveBeenCalledWith(
      expect.any(String),
      'last_extract_renames',
    );
    expect(mockAtomicWrite).toHaveBeenCalledWith(
      '/test/planning/t/overview.md',
      expect.any(String),
    );
  });

  it('skips overview frontmatter write when findTripFile returns null', async () => {
    mockFindTripFile.mockReturnValueOnce(null);
    readCandidates.mockReturnValueOnce(null);
    readPlan.mockReturnValueOnce(null);

    await realizePlan('t', makeExtract({
      plan: { field_guide_notes: '', gotchas: '' },
      candidates: { stops: [], lodging: [] },
    }));

    expect(mockAtomicWrite).not.toHaveBeenCalled();
  });

  it('does not call chat() — the LLM call lives in doResearch() now', async () => {
    // Module-under-test should not import or rely on ai.js. Verify by reading
    // the source: realizePlan must not contain a `chat(` call.
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const src = readFileSync(
      path.resolve(process.cwd(), 'src/lib/server/realize-plan.js'),
      'utf8',
    );
    expect(src).not.toMatch(/from\s+['"][.$][^'"]*\/ai(?:\.js)?['"]/);
    expect(src).not.toMatch(/\bchat\s*\(/);
  });

  // Geocoding moved to a follow-on background job (issue #382). The deepen
  // handler kicks off `geocode-candidates` after realizePlan() returns; coords
  // fill in incrementally so the deepen pill completes ~15s sooner.
  it("does not call geocode anymore: geocoding moved to a follow-on job", async () => {
    readCandidates.mockReturnValueOnce(null);
    readPlan.mockReturnValueOnce(null);
    mockGeocode.mockImplementation(async () => {
      throw new Error("realizePlan should not call geocode() - that work moved to geocode-job.js");
    });
    await realizePlan("t", makeExtract({
      plan: { field_guide_notes: "", gotchas: "" },
      candidates: {
        stops: [{ name: "Lake McDonald", category: "outdoors", description: "", why_recommended: "" }],
        lodging: [{ name: "Whitefish Inn", price_tier: "mid" }],
      },
    }));
    expect(mockGeocode).not.toHaveBeenCalled();
    expect(capturedCands.value.stops[0].coords).toBeUndefined();
    expect(capturedCands.value.lodging[0].coords).toBeUndefined();
  });

  it('preserves a find-more-style entry (researcher-emitted but user_added: true) across re-realize', async () => {
    readCandidates.mockReturnValueOnce({
      stops: [{
        id: 'tecumseh', name: 'Tecumseh!', category: 'entertainment',
        description: 'Outdoor drama in a wooded amphitheater.',
        why_recommended: 'Matches your taste for off-beat live experiences.',
        source_url: 'https://tecumsehdrama.com',
        user_added: true,
      }],
      lodging: [],
    });
    readPlan.mockReturnValueOnce(null);

    await realizePlan('t', makeExtract({
      plan: { cover_query: 'ohio hopewell earthworks', field_guide_notes: [], gotchas: [] },
      candidates: {
        stops: [{ name: 'Mound City Group', category: 'historic', description: 'Hopewell earthworks site.', why_recommended: 'Aligns with your historic tilt.' }],
        lodging: [],
      },
    }));

    const written = capturedCands.value;
    expect(written.stops.some((s) => s.id === 'tecumseh' && s.user_added === true)).toBe(true);
    expect(written.stops.some((s) => s.name === 'Mound City Group')).toBe(true);
  });

  it('realizePlan passes hours/address/website/phone from LLM YAML to stops', async () => {
    readCandidates.mockReturnValueOnce(null);
    readPlan.mockReturnValueOnce(null);

    await realizePlan('t', makeExtract({
      plan: { field_guide_notes: [], gotchas: [] },
      candidates: {
        stops: [{
          name: 'Lemon Bakery',
          category: 'misc',
          description: 'Local bakery downtown.',
          why_recommended: 'Loved by passers-by.',
          source_url: 'https://example.com',
          hours: 'Mon-Sat 7am-3pm; closed Sundays',
          address: '123 Main St, Empire, MI',
          website: 'https://lemon.example.com',
          phone: '(231) 555-0100',
        }],
        lodging: [],
      },
    }));

    const stop = capturedCands.value.stops[0];
    expect(stop.hours).toBe('Mon-Sat 7am-3pm; closed Sundays');
    expect(stop.address).toBe('123 Main St, Empire, MI');
    expect(stop.website).toBe('https://lemon.example.com');
    expect(stop.phone).toBe('(231) 555-0100');
  });

  it('realizePlan does not add empty-string metadata fields when LLM omits them', async () => {
    readCandidates.mockReturnValueOnce(null);
    readPlan.mockReturnValueOnce(null);

    await realizePlan('t', makeExtract({
      plan: { field_guide_notes: [], gotchas: [] },
      candidates: {
        stops: [{
          name: 'Plain Stop',
          category: 'outdoors',
          description: 'A stop with no metadata.',
          why_recommended: 'Just a stop.',
          source_url: '',
        }],
        lodging: [],
      },
    }));

    const stop = capturedCands.value.stops[0];
    expect(stop.hours).toBeUndefined();
    expect(stop.address).toBeUndefined();
    expect(stop.website).toBeUndefined();
    expect(stop.phone).toBeUndefined();
  });
});


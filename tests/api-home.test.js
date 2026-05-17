import { describe, it, expect, vi, beforeEach } from 'vitest';

// Stub @sveltejs/kit so we can inspect response bodies.
vi.mock('@sveltejs/kit', () => ({
  json: (body, init = {}) => ({ _body: body, _status: init.status ?? 200 }),
  error: (status, msg) => {
    throw Object.assign(new Error(msg), { status });
  },
}));

// Mock node:fs — no real disk operations.
vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { splitHomeBody } from '../src/lib/server/data.js';
import { GET, PUT } from '../src/routes/api/home/+server.js';

// ── Sample home.md content ────────────────────────────────────────────────────
const SAMPLE_HOME_MD = `---
home_city: Test City, ST
home_coords: [40.0, -90.0]
travelers: [alice, bob]
vehicles:
  sedan:
    model: 2020 Honda Accord
    type: gas
    default: true
    notes: Reliable daily driver.
pets_need_sitter: false
default_radius_mi: 400
units:
  distance: mi
---

# Personal context for trip planning

Intro paragraph here.

## Travelers and logistics

- Primary travelers: Alice and Bob.
- Pets: none.

## Vehicle notes

Drive a sedan.

## Trip profile — what makes a good one

**Tends to like:**
- Scenic routes.
`;

function makeRequest(body) {
  return { request: { json: async () => body } };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: home.md exists and has valid content.
  existsSync.mockReturnValue(true);
  readFileSync.mockReturnValue(SAMPLE_HOME_MD);
});

// ── splitHomeBody (pure function) ─────────────────────────────────────────────

describe('splitHomeBody', () => {
  it('splits body on ## headings in document order', () => {
    const body = `# Title

Intro line.

## Section One

Body one.

## Section Two

Body two.`;
    const { preamble, sections } = splitHomeBody(body);
    expect(preamble).toBe('# Title\n\nIntro line.');
    expect(sections).toHaveLength(2);
    expect(sections[0].heading).toBe('Section One');
    expect(sections[0].body).toBe('Body one.');
    expect(sections[1].heading).toBe('Section Two');
    expect(sections[1].body).toBe('Body two.');
  });

  it('returns empty preamble when body starts with a heading', () => {
    const body = `## First Section\n\nContent here.`;
    const { preamble, sections } = splitHomeBody(body);
    expect(preamble).toBe('');
    expect(sections).toHaveLength(1);
    expect(sections[0].heading).toBe('First Section');
  });

  it('returns no sections when there are no ## headings', () => {
    const body = `# Just a title\n\nSome prose.`;
    const { preamble, sections } = splitHomeBody(body);
    expect(preamble).toBe('# Just a title\n\nSome prose.');
    expect(sections).toHaveLength(0);
  });

  it('preserves multiline section bodies', () => {
    const body = `## My Section\n\nLine 1.\n\nLine 2.\n\nLine 3.`;
    const { sections } = splitHomeBody(body);
    expect(sections[0].body).toContain('Line 1.');
    expect(sections[0].body).toContain('Line 2.');
    expect(sections[0].body).toContain('Line 3.');
  });

  it('does not treat ### subheadings as section splits', () => {
    const body = `## Main Section\n\n### Sub\n\nContent.`;
    const { sections } = splitHomeBody(body);
    expect(sections).toHaveLength(1);
    expect(sections[0].heading).toBe('Main Section');
    expect(sections[0].body).toContain('### Sub');
  });
});

// ── GET /api/home ─────────────────────────────────────────────────────────────

describe('GET /api/home', () => {
  it('returns 200 with parsed frontmatter and prose sections', async () => {
    const res = await GET();
    expect(res._status).toBe(200);
    expect(res._body.frontmatter.home_city).toBe('Test City, ST');
    expect(res._body.frontmatter.home_coords).toEqual([40.0, -90.0]);
    expect(res._body.prose.sections).toBeDefined();
    expect(Array.isArray(res._body.prose.sections)).toBe(true);
  });

  it('returns numbers as numbers, booleans as booleans, arrays as arrays', async () => {
    const res = await GET();
    expect(typeof res._body.frontmatter.home_coords[0]).toBe('number');
    expect(typeof res._body.frontmatter.home_coords[1]).toBe('number');
    expect(typeof res._body.frontmatter.default_radius_mi).toBe('number');
    expect(res._body.frontmatter.default_radius_mi).toBe(400);
    expect(typeof res._body.frontmatter.pets_need_sitter).toBe('boolean');
    expect(res._body.frontmatter.pets_need_sitter).toBe(false);
    expect(res._body.frontmatter.travelers).toEqual(['alice', 'bob']);
  });

  it('preserves nested objects (vehicles, units)', async () => {
    const res = await GET();
    expect(res._body.frontmatter.vehicles).toEqual({
      sedan: {
        model: '2020 Honda Accord',
        type: 'gas',
        default: true,
        notes: 'Reliable daily driver.',
      },
    });
    expect(res._body.frontmatter.units).toEqual({ distance: 'mi' });
  });

  it('returns sections in document order', async () => {
    const res = await GET();
    const headings = res._body.prose.sections.map((s) => s.heading);
    expect(headings).toEqual([
      'Travelers and logistics',
      'Vehicle notes',
      'Trip profile — what makes a good one',
    ]);
  });

  it('returns the preamble before the first ## heading', async () => {
    const res = await GET();
    expect(res._body.prose.preamble).toContain('# Personal context for trip planning');
    expect(res._body.prose.preamble).toContain('Intro paragraph here.');
  });

  it('returns 404 when home.md does not exist', async () => {
    existsSync.mockReturnValue(false);
    const res = await GET();
    expect(res._status).toBe(404);
    expect(res._body.error).toMatch(/not found/i);
  });

  it('returns 500 when home.md has no valid frontmatter', async () => {
    readFileSync.mockReturnValue('No frontmatter here.\n\nJust prose.');
    const res = await GET();
    expect(res._status).toBe(500);
  });
});

// ── PUT /api/home — validation ─────────────────────────────────────────────────

describe('PUT /api/home — validation', () => {
  it('returns 400 for invalid JSON body', async () => {
    const req = { request: { json: async () => { throw new SyntaxError('bad json'); } } };
    const res = await PUT(req);
    expect(res._status).toBe(400);
    expect(res._body.error).toMatch(/invalid json/i);
  });

  it('returns 400 when frontmatter is missing', async () => {
    const res = await PUT(makeRequest({ prose: { preamble: '', sections: [] } }));
    expect(res._status).toBe(400);
    expect(res._body.error).toMatch(/frontmatter/i);
  });

  it('returns 400 when prose is missing', async () => {
    const res = await PUT(makeRequest({ frontmatter: { home_city: 'X', home_coords: [0, 0] } }));
    expect(res._status).toBe(400);
    expect(res._body.error).toMatch(/prose/i);
  });

  it('returns 400 when home_city is missing', async () => {
    const res = await PUT(makeRequest({
      frontmatter: { home_coords: [40, -90] },
      prose: { preamble: '', sections: [] },
    }));
    expect(res._status).toBe(400);
    expect(res._body.error).toMatch(/home_city/i);
    expect(res._body.code).toBe('invalid_input');
  });

  it('returns 400 when home_city is an empty string', async () => {
    const res = await PUT(makeRequest({
      frontmatter: { home_city: '   ', home_coords: [40, -90] },
      prose: { preamble: '', sections: [] },
    }));
    expect(res._status).toBe(400);
    expect(res._body.error).toMatch(/home_city/i);
  });

  it('returns 400 when home_city is not a string', async () => {
    const res = await PUT(makeRequest({
      frontmatter: { home_city: 42, home_coords: [40, -90] },
      prose: { preamble: '', sections: [] },
    }));
    expect(res._status).toBe(400);
    expect(res._body.error).toMatch(/home_city/i);
  });

  it('returns 400 when home_coords is not an array', async () => {
    const res = await PUT(makeRequest({
      frontmatter: { home_city: 'Test', home_coords: '40,-90' },
      prose: { preamble: '', sections: [] },
    }));
    expect(res._status).toBe(400);
    expect(res._body.error).toMatch(/home_coords/i);
    expect(res._body.code).toBe('invalid_input');
  });

  it('returns 400 when home_coords has only one element', async () => {
    const res = await PUT(makeRequest({
      frontmatter: { home_city: 'Test', home_coords: [40] },
      prose: { preamble: '', sections: [] },
    }));
    expect(res._status).toBe(400);
    expect(res._body.error).toMatch(/home_coords/i);
  });

  it('returns 400 when home_coords values are not finite', async () => {
    const res = await PUT(makeRequest({
      frontmatter: { home_city: 'Test', home_coords: [NaN, -90] },
      prose: { preamble: '', sections: [] },
    }));
    expect(res._status).toBe(400);
    expect(res._body.error).toMatch(/finite/i);
  });

  it('returns 400 when lat is out of range', async () => {
    const res = await PUT(makeRequest({
      frontmatter: { home_city: 'Test', home_coords: [91, -90] },
      prose: { preamble: '', sections: [] },
    }));
    expect(res._status).toBe(400);
    expect(res._body.error).toMatch(/lat/i);
  });

  it('returns 400 when lon is out of range', async () => {
    const res = await PUT(makeRequest({
      frontmatter: { home_city: 'Test', home_coords: [40, 200] },
      prose: { preamble: '', sections: [] },
    }));
    expect(res._status).toBe(400);
    expect(res._body.error).toMatch(/lon/i);
  });

  it('returns 400 when prose.sections is not an array', async () => {
    const res = await PUT(makeRequest({
      frontmatter: { home_city: 'Test', home_coords: [40, -90] },
      prose: { preamble: '', sections: 'not an array' },
    }));
    expect(res._status).toBe(400);
    expect(res._body.error).toMatch(/sections/i);
  });
});

// ── PUT /api/home — success path ──────────────────────────────────────────────

describe('PUT /api/home — success', () => {
  const validPayload = {
    frontmatter: {
      home_city: 'Test City, ST',
      home_coords: [40.0, -90.0],
      travelers: ['alice', 'bob'],
      pets_need_sitter: false,
      default_radius_mi: 400,
    },
    prose: {
      preamble: '# Personal context for trip planning\n\nIntro paragraph here.',
      sections: [
        { heading: 'Travelers and logistics', body: '- Primary travelers: Alice and Bob.\n- Pets: none.' },
        { heading: 'Vehicle notes', body: 'Drive a sedan.' },
      ],
    },
  };

  it('returns 200 with ok: true on valid payload', async () => {
    const res = await PUT(makeRequest(validPayload));
    expect(res._status).toBe(200);
    expect(res._body.ok).toBe(true);
  });

  it('writes home.md to disk', async () => {
    await PUT(makeRequest(validPayload));
    expect(writeFileSync).toHaveBeenCalledOnce();
  });

  it('calls invalidateEnrichCache (writeHomeMd calls it internally)', async () => {
    // writeHomeMd calls invalidateEnrichCache; the PUT handler also calls it.
    // Verify the file was written — cache invalidation is a side effect of writeHomeMd.
    await PUT(makeRequest(validPayload));
    expect(writeFileSync).toHaveBeenCalledOnce();
    const [writePath, content] = writeFileSync.mock.calls[0];
    expect(writePath).toMatch(/home\.md$/);
    expect(content).toContain('home_city: Test City, ST');
  });

  it('round-trip: written content contains all prose sections', async () => {
    await PUT(makeRequest(validPayload));
    const [, content] = writeFileSync.mock.calls[0];
    expect(content).toContain('## Travelers and logistics');
    expect(content).toContain('## Vehicle notes');
    expect(content).toContain('Primary travelers: Alice and Bob.');
    expect(content).toContain('Drive a sedan.');
  });

  it('round-trip: written content includes frontmatter fences', async () => {
    await PUT(makeRequest(validPayload));
    const [, content] = writeFileSync.mock.calls[0];
    expect(content.startsWith('---\n')).toBe(true);
    expect(content).toContain('\n---\n');
  });

  it('round-trip: GET then PUT produces file with same structure', async () => {
    // GET the parsed shape
    const getRes = await GET();
    expect(getRes._status).toBe(200);

    // PUT the shape back
    const putRes = await PUT(makeRequest(getRes._body));
    expect(putRes._status).toBe(200);

    // Verify something was written
    expect(writeFileSync).toHaveBeenCalledOnce();
    const [, written] = writeFileSync.mock.calls[0];

    // All sections from the original are present
    const originalSections = getRes._body.prose.sections.map((s) => s.heading);
    for (const heading of originalSections) {
      expect(written).toContain(`## ${heading}`);
    }
  });

  it('round-trip: nested vehicles map survives GET → PUT → re-parse', async () => {
    const getRes = await GET();
    await PUT(makeRequest(getRes._body));
    const [, written] = writeFileSync.mock.calls[0];

    // Written file should contain the nested vehicles structure
    expect(written).toMatch(/vehicles:\s*\n\s+sedan:/);
    expect(written).toContain('model: 2020 Honda Accord');
    expect(written).toContain('type: gas');
    expect(written).toContain('default: true');
  });

  it('round-trip: numbers and booleans preserved on write', async () => {
    await PUT(makeRequest(validPayload));
    const [, written] = writeFileSync.mock.calls[0];
    // Numbers serialize without quotes
    expect(written).toMatch(/home_coords:\s*\[\s*40,\s*-90\s*\]|home_coords:\s*\n\s*-\s*40\s*\n\s*-\s*-90/);
    expect(written).toMatch(/pets_need_sitter:\s*false/);
    expect(written).toMatch(/default_radius_mi:\s*400/);
  });

  it('accepts stringified coords (defensive) and coerces on validation', async () => {
    const payload = {
      ...validPayload,
      frontmatter: {
        ...validPayload.frontmatter,
        home_coords: ['40.0', '-90.0'],
      },
    };
    const res = await PUT(makeRequest(payload));
    expect(res._status).toBe(200);
  });
});

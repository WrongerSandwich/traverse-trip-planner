import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- fs mock ---
const { mockExistsSync, mockReadFileSync, mockWriteFileSync, mockMkdirSync, mockUnlinkSync } = vi.hoisted(() => ({
  mockExistsSync: vi.fn(),
  mockReadFileSync: vi.fn(),
  mockWriteFileSync: vi.fn(),
  mockMkdirSync: vi.fn(),
  mockUnlinkSync: vi.fn(),
}));

vi.mock('node:fs', () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
  mkdirSync: mockMkdirSync,
  unlinkSync: mockUnlinkSync,
}));

// --- data mock ---
const {
  mockParseFrontmatter, mockParseFrontmatterFields,
  mockSetFrontmatterField, mockRemoveFrontmatterField,
  mockInvalidateEnrichCache,
} = vi.hoisted(() => ({
  mockParseFrontmatter: vi.fn(),
  mockParseFrontmatterFields: vi.fn(),
  mockSetFrontmatterField: vi.fn(),
  mockRemoveFrontmatterField: vi.fn(),
  mockInvalidateEnrichCache: vi.fn(),
}));

vi.mock('$lib/server/data.js', () => ({
  ROOT: '/test-root',
  readHomeMd: () => '---\ntravelers: [you]\npets_need_sitter: false\n---\n',
  parseFrontmatter: mockParseFrontmatter,
  parseFrontmatterFields: mockParseFrontmatterFields,
  setFrontmatterField: mockSetFrontmatterField,
  removeFrontmatterField: mockRemoveFrontmatterField,
  invalidateEnrichCache: mockInvalidateEnrichCache,
}));

// --- AI / search / config mocks ---
const mockChat = vi.hoisted(() => vi.fn());

vi.mock('$lib/server/ai.js', () => ({
  chat: mockChat,
  formatUsage: () => '[10 tokens]',
}));

vi.mock('$lib/server/search.js', () => ({
  search: vi.fn(),
  searchToolDefinition: () => ({
    kind: 'normalized',
    name: 'web_search',
    description: 'search the web',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
  }),
}));

vi.mock('$lib/server/config.js', () => ({
  getEffectiveConfig: () => ({
    features: { deepen: { provider: 'anthropic', model: 'claude-test' } },
  }),
}));

import { GET, POST } from '../src/routes/api/actions/deepen/[slug]/+server.js';

const IDEA_CONTENT = '---\ntitle: Test Trip\nstatus: idea\ndestination: Testville\n---\nGreat idea.';

beforeEach(() => {
  vi.clearAllMocks();
  // Default: file not found. Override per test.
  mockExistsSync.mockReturnValue(false);
  mockReadFileSync.mockReturnValue(IDEA_CONTENT);
  mockParseFrontmatter.mockReturnValue({ title: 'Test Trip', status: 'idea' });
  mockParseFrontmatterFields.mockReturnValue({});
  mockSetFrontmatterField.mockImplementation((content, field, value) => `${content}\n${field}: ${value}`);
  mockRemoveFrontmatterField.mockImplementation((content, field) => content);
  // Default chat: resolves (so fire-and-forget tests can control rejection separately).
  mockChat.mockResolvedValue({ text: '<overview_prose>prose</overview_prose>', usage: {} });
});

// ── GET ────────────────────────────────────────────────────────────────────────

describe('GET /api/actions/deepen/[slug]', () => {
  it('returns 200 when the idea file exists', () => {
    mockExistsSync.mockReturnValue(true);
    const res = GET({ params: { slug: 'test-trip' } });
    expect(res.status).toBe(200);
  });

  it('returns 404 when the idea file does not exist', () => {
    mockExistsSync.mockReturnValue(false);
    const res = GET({ params: { slug: 'missing' } });
    expect(res.status).toBe(404);
  });
});

// ── POST ───────────────────────────────────────────────────────────────────────

describe('POST /api/actions/deepen/[slug]', () => {
  it('returns 404 when slug not found in ideas/', async () => {
    mockExistsSync.mockReturnValue(false);
    const res = await POST({ params: { slug: 'missing-trip' } });
    expect(res.status).toBe(404);
  });

  it('returns 409 when researching flag is already set (string "true")', async () => {
    mockExistsSync.mockReturnValue(true);
    mockParseFrontmatter.mockReturnValue({ title: 'Test', researching: 'true' });
    const res = await POST({ params: { slug: 'test-trip' } });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/already researching/i);
  });

  it('returns 409 when researching flag is boolean true', async () => {
    mockExistsSync.mockReturnValue(true);
    mockParseFrontmatter.mockReturnValue({ title: 'Test', researching: true });
    const res = await POST({ params: { slug: 'test-trip' } });
    expect(res.status).toBe(409);
  });

  it('returns 202 and sets researching flag on first POST', async () => {
    mockExistsSync.mockReturnValue(true);
    const res = await POST({ params: { slug: 'test-trip' } });
    expect(res.status).toBe(202);
    expect(mockSetFrontmatterField).toHaveBeenCalledWith(IDEA_CONTENT, 'researching', 'true');
    expect(mockWriteFileSync).toHaveBeenCalled();
    expect(mockInvalidateEnrichCache).toHaveBeenCalled();
  });

  it('fire-and-forget catch path: clears researching flag when doResearch fails', async () => {
    mockExistsSync.mockReturnValue(true);
    mockChat.mockRejectedValue(new Error('network timeout'));

    const res = await POST({ params: { slug: 'test-trip' } });
    expect(res.status).toBe(202);

    // Let the fire-and-forget promise chain settle.
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(mockRemoveFrontmatterField).toHaveBeenCalledWith(
      expect.any(String),
      'researching'
    );
    // writeFileSync: once to set the flag, once to clear it.
    expect(mockWriteFileSync).toHaveBeenCalledTimes(2);
    expect(mockInvalidateEnrichCache).toHaveBeenCalledTimes(2);
  });

  it('fire-and-forget catch path: no cleanup when idea file is gone by the time catch runs', async () => {
    // existsSync: true for the initial file check, false in the catch block.
    mockExistsSync
      .mockReturnValueOnce(true)  // findIdeaFile in POST
      .mockReturnValueOnce(false); // existsSync(ideaPath) in catch block
    mockChat.mockRejectedValue(new Error('boom'));

    await POST({ params: { slug: 'test-trip' } });
    await new Promise(resolve => setTimeout(resolve, 50));

    // removeFrontmatterField and the second writeFileSync should NOT be called
    // because existsSync returned false in the catch block.
    expect(mockRemoveFrontmatterField).not.toHaveBeenCalled();
    // Only one writeFileSync: the initial flag-set.
    expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
  });
});

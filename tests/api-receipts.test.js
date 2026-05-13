import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- fs mock ---
const { mockExistsSync } = vi.hoisted(() => ({
  mockExistsSync: vi.fn(),
}));

vi.mock('node:fs', () => ({
  existsSync: mockExistsSync,
}));

// --- data mock ---
const mockAppendToNotes = vi.hoisted(() => vi.fn());

vi.mock('$lib/server/data.js', () => ({
  ROOT: '/test-root',
  appendToNotes: mockAppendToNotes,
}));

// --- AI / config mocks ---
const mockChat = vi.hoisted(() => vi.fn());

vi.mock('$lib/server/ai.js', () => ({
  chat: mockChat,
}));

vi.mock('$lib/server/config.js', () => ({
  getEffectiveConfig: () => ({
    features: { receipts: { provider: 'anthropic', model: 'claude-test' } },
  }),
}));

vi.mock('@sveltejs/kit', () => ({
  json: (body, init = {}) => ({ _body: body, _status: init.status ?? 200 }),
}));

import { POST } from '../src/routes/api/actions/receipts/[slug]/+server.js';

const MAX_IMAGES = 10;
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

function makeFile({ type = 'image/jpeg', name = 'receipt.jpg', size = 1000 } = {}) {
  return {
    type,
    name,
    arrayBuffer: async () => new ArrayBuffer(size),
  };
}

function makeRequest({ slug = 'test-trip', files = [], failFormData = false } = {}) {
  return {
    params: { slug },
    request: {
      formData: failFormData
        ? async () => { throw new Error('not multipart'); }
        : async () => ({ getAll: (key) => key === 'image' ? files : [] }),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: trip exists in completed/
  mockExistsSync.mockReturnValue(true);
  // Default: model returns a parseable receipt line
  mockChat.mockResolvedValue({
    text: '2026-01-15 · Blue Moon Cafe · $42.17 · food',
    usage: {},
  });
  mockAppendToNotes.mockReturnValue(true);
});

// ── 404 — trip not found ───────────────────────────────────────────────────────

describe('POST /api/actions/receipts/[slug] — trip lookup', () => {
  it('returns 404 when trip is not in completed/', async () => {
    mockExistsSync.mockReturnValue(false);
    const res = await POST(makeRequest({ files: [makeFile()] }));
    expect(res.status).toBe(404);
  });
});

// ── 400 — bad form data ────────────────────────────────────────────────────────

describe('POST /api/actions/receipts/[slug] — form validation', () => {
  it('returns 400 when request is not multipart form data', async () => {
    const res = await POST(makeRequest({ failFormData: true }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when no images are provided', async () => {
    const res = await POST(makeRequest({ files: [] }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when image count exceeds MAX_IMAGES (10)', async () => {
    const files = Array.from({ length: MAX_IMAGES + 1 }, () => makeFile());
    const res = await POST(makeRequest({ files }));
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/too many/i);
  });

  it('accepts exactly MAX_IMAGES images without a 400', async () => {
    const files = Array.from({ length: MAX_IMAGES }, () => makeFile());
    const res = await POST(makeRequest({ files }));
    // Should not be a 400 for count; other status codes are fine
    expect(res.status).not.toBe(400);
  });
});

// ── 415 — unsupported type ─────────────────────────────────────────────────────

describe('POST /api/actions/receipts/[slug] — MIME type allowlist', () => {
  it('returns 415 for an unsupported MIME type', async () => {
    const res = await POST(makeRequest({ files: [makeFile({ type: 'application/pdf' })] }));
    expect(res.status).toBe(415);
    expect(await res.text()).toMatch(/unsupported image type/i);
  });

  it('accepts image/jpeg', async () => {
    const res = await POST(makeRequest({ files: [makeFile({ type: 'image/jpeg' })] }));
    expect(res.status).not.toBe(415);
  });

  it('accepts image/png', async () => {
    const res = await POST(makeRequest({ files: [makeFile({ type: 'image/png' })] }));
    expect(res.status).not.toBe(415);
  });

  it('accepts image/webp', async () => {
    const res = await POST(makeRequest({ files: [makeFile({ type: 'image/webp' })] }));
    expect(res.status).not.toBe(415);
  });

  it('accepts image/gif', async () => {
    const res = await POST(makeRequest({ files: [makeFile({ type: 'image/gif' })] }));
    expect(res.status).not.toBe(415);
  });
});

// ── 413 — file too large ───────────────────────────────────────────────────────

describe('POST /api/actions/receipts/[slug] — size limit', () => {
  it('returns 413 when an image exceeds MAX_BYTES (5 MB)', async () => {
    const res = await POST(makeRequest({ files: [makeFile({ size: MAX_BYTES + 1 })] }));
    expect(res.status).toBe(413);
    expect(await res.text()).toMatch(/too large/i);
  });

  it('accepts an image exactly at MAX_BYTES', async () => {
    const res = await POST(makeRequest({ files: [makeFile({ size: MAX_BYTES })] }));
    expect(res.status).not.toBe(413);
  });
});

// ── 422 — no parseable lines ───────────────────────────────────────────────────

describe('POST /api/actions/receipts/[slug] — model output parsing', () => {
  it('returns 422 when model returns no lines containing " · "', async () => {
    mockChat.mockResolvedValueOnce({ text: 'No receipts found here.', usage: {} });
    const res = await POST(makeRequest({ files: [makeFile()] }));
    expect(res.status).toBe(422);
  });
});

// ── 200 — success ──────────────────────────────────────────────────────────────

describe('POST /api/actions/receipts/[slug] — success', () => {
  it('returns 200 with parsed lines and appends ## Receipts section to notes.md', async () => {
    mockChat.mockResolvedValueOnce({
      text: '2026-01-15 · Blue Moon Cafe · $42.17 · food\n2026-01-16 · Shell Gas · $58.00 · gas',
      usage: {},
    });

    const res = await POST(makeRequest({ files: [makeFile()] }));
    expect(res._status).toBe(200);
    expect(res._body.lines).toHaveLength(2);
    expect(res._body.lines[0]).toContain('Blue Moon Cafe');

    expect(mockAppendToNotes).toHaveBeenCalledWith(
      'test-trip',
      expect.stringContaining('## Receipts')
    );
    expect(mockAppendToNotes).toHaveBeenCalledWith(
      'test-trip',
      expect.stringContaining('Blue Moon Cafe')
    );
  });

  it('filters lines that do not contain the · separator', async () => {
    mockChat.mockResolvedValueOnce({
      text: 'Here are your receipts:\n2026-01-15 · Cafe · $10.00 · food\nSome trailing note',
      usage: {},
    });
    const res = await POST(makeRequest({ files: [makeFile()] }));
    expect(res._status).toBe(200);
    expect(res._body.lines).toHaveLength(1);
  });

  it('passes images to chat() as normalized image blocks', async () => {
    await POST(makeRequest({ files: [makeFile({ type: 'image/png' })] }));
    const call = mockChat.mock.calls[0][0];
    const userContent = call.messages[0].content;
    const imageBlock = userContent.find(b => b.type === 'image');
    expect(imageBlock).toBeDefined();
    expect(imageBlock.mediaType).toBe('image/png');
    expect(typeof imageBlock.data).toBe('string'); // base64
  });
});

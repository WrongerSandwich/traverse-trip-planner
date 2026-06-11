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
  DATA_DIR: '/test-root/data',
  appendToNotes: mockAppendToNotes,
  rejectInvalidSlug: () => null,
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
import { sniffImageType, imageDimensions } from '../src/lib/utils/sniffImageType.js';

const MAX_IMAGES = 10;
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_BODY_BYTES = MAX_IMAGES * MAX_BYTES + 64 * 1024;

// ── Magic byte headers per MIME type ──────────────────────────────────────────

const MAGIC = {
  'image/jpeg': [0xff, 0xd8, 0xff, 0xe0],
  'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  'image/gif': [0x47, 0x49, 0x46, 0x38, 0x39, 0x61], // GIF89a
  'image/webp': [
    0x52, 0x49, 0x46, 0x46, // RIFF
    0x00, 0x00, 0x00, 0x00, // size (dummy)
    0x57, 0x45, 0x42, 0x50, // WEBP
  ],
};

/**
 * Build an ArrayBuffer whose first bytes are the correct magic for `type` AND
 * carry a parseable, small (`w`×`h`) dimension header so it passes both the
 * magic-byte sniff and the pixel-dimension cap (#496). Defaults to 64×48.
 */
function magicBuf(type, size = 100, w = 64, h = 48) {
  const buf = new ArrayBuffer(Math.max(size, 64));
  const view = new Uint8Array(buf);
  const header = MAGIC[type] ?? [];
  for (let i = 0; i < header.length; i++) view[i] = header[i];

  const w16be = (o, v) => { view[o] = (v >> 8) & 0xff; view[o + 1] = v & 0xff; };
  const w32be = (o, v) => { view[o] = (v >>> 24) & 0xff; view[o + 1] = (v >> 16) & 0xff; view[o + 2] = (v >> 8) & 0xff; view[o + 3] = v & 0xff; };
  const w16le = (o, v) => { view[o] = v & 0xff; view[o + 1] = (v >> 8) & 0xff; };

  if (type === 'image/png') {
    // IHDR: width @16, height @20 (big-endian u32).
    w32be(16, w); w32be(20, h);
  } else if (type === 'image/gif') {
    // Logical screen width @6, height @8 (little-endian u16).
    w16le(6, w); w16le(8, h);
  } else if (type === 'image/webp') {
    // VP8X extended header: fourcc @12, 24-bit (w-1) @24, (h-1) @27 (LE).
    view[12] = 0x56; view[13] = 0x50; view[14] = 0x38; view[15] = 0x58; // "VP8X"
    const wm1 = w - 1, hm1 = h - 1;
    view[24] = wm1 & 0xff; view[25] = (wm1 >> 8) & 0xff; view[26] = (wm1 >> 16) & 0xff;
    view[27] = hm1 & 0xff; view[28] = (hm1 >> 8) & 0xff; view[29] = (hm1 >> 16) & 0xff;
  } else {
    // JPEG: the magic is ff d8 ff e0 (SOI + APP0 marker). Give APP0 a valid
    // length payload so the segment-walker skips it, then write SOF0 with the
    // real height/width. APP0 marker byte is at offset 3; its length starts @4.
    let o = 4;
    w16be(o, 4); o += 2;   // APP0 length = 4 (length field + 2 padding bytes)
    view[o++] = 0x00; view[o++] = 0x00; // 2 bytes of APP0 payload
    view[o++] = 0xff; view[o++] = 0xc0; // SOF0 marker
    w16be(o, 11); o += 2;  // segment length (8 + 3*1)
    view[o++] = 8;          // precision
    w16be(o, h); o += 2;    // height
    w16be(o, w); o += 2;    // width
    view[o++] = 1;          // component count
  }
  return buf;
}

/** Like magicBuf but with oversized dimensions to trip the pixel cap. */
function oversizeBuf(type, dim = 5000) {
  return magicBuf(type, 100, dim, dim);
}

/** ArrayBuffer filled with HTML bytes — wrong magic for any image type. */
function htmlBuf(size = 100) {
  const buf = new ArrayBuffer(size);
  const view = new Uint8Array(buf);
  const html = '<html>';
  for (let i = 0; i < html.length && i < size; i++) {
    view[i] = html.charCodeAt(i);
  }
  return buf;
}

function makeFile({
  type = 'image/jpeg',
  name = 'receipt.jpg',
  size = 100,
  buf = null,
} = {}) {
  return {
    type,
    name,
    arrayBuffer: async () => buf ?? magicBuf(type, size),
  };
}

function makeRequest({
  slug = 'test-trip',
  files = [],
  failFormData = false,
  contentLength = null,
} = {}) {
  const headers = new Map();
  if (contentLength !== null) headers.set('content-length', String(contentLength));
  return {
    params: { slug },
    request: {
      headers: { get: (k) => headers.get(k) ?? null },
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

// ── sniffImageType (pure utility) ─────────────────────────────────────────────

describe('sniffImageType', () => {
  it('detects JPEG from magic bytes', () => {
    expect(sniffImageType(magicBuf('image/jpeg'))).toBe('image/jpeg');
  });

  it('detects PNG from magic bytes', () => {
    expect(sniffImageType(magicBuf('image/png'))).toBe('image/png');
  });

  it('detects GIF from magic bytes', () => {
    expect(sniffImageType(magicBuf('image/gif'))).toBe('image/gif');
  });

  it('detects WebP from magic bytes', () => {
    expect(sniffImageType(magicBuf('image/webp'))).toBe('image/webp');
  });

  it('returns null for HTML bytes', () => {
    expect(sniffImageType(htmlBuf())).toBeNull();
  });

  it('returns null for an all-zero buffer', () => {
    expect(sniffImageType(new ArrayBuffer(12))).toBeNull();
  });
});

// ── imageDimensions (pure utility — pixel-dimension cap, #496) ────────────────

describe('imageDimensions', () => {
  it('reads PNG dimensions from the IHDR header', () => {
    expect(imageDimensions(magicBuf('image/png', 100, 800, 600))).toEqual({ width: 800, height: 600 });
  });

  it('reads GIF dimensions from the logical screen descriptor', () => {
    expect(imageDimensions(magicBuf('image/gif', 100, 320, 240))).toEqual({ width: 320, height: 240 });
  });

  it('reads WebP (VP8X) canvas dimensions', () => {
    expect(imageDimensions(magicBuf('image/webp', 100, 1024, 768))).toEqual({ width: 1024, height: 768 });
  });

  it('reads JPEG dimensions from the SOF0 frame header', () => {
    expect(imageDimensions(magicBuf('image/jpeg', 100, 1200, 900))).toEqual({ width: 1200, height: 900 });
  });

  it('returns null for non-image / truncated bytes', () => {
    expect(imageDimensions(htmlBuf())).toBeNull();
    expect(imageDimensions(new ArrayBuffer(8))).toBeNull();
  });

  it('surfaces oversized declared dimensions (decompression-bomb signal)', () => {
    const dims = imageDimensions(oversizeBuf('image/png', 50000));
    expect(dims.width).toBe(50000);
    expect(dims.height).toBe(50000);
  });
});

// ── 404 — trip not found ───────────────────────────────────────────────────────

describe('POST /api/actions/receipts/[slug] — trip lookup', () => {
  it('returns 404 when trip is not in completed/', async () => {
    mockExistsSync.mockReturnValue(false);
    const res = await POST(makeRequest({ files: [makeFile()] }));
    expect(res.status).toBe(404);
  });
});

// ── 413 — oversize Content-Length rejected before formData() ──────────────────

describe('POST /api/actions/receipts/[slug] — Content-Length cap', () => {
  it('returns 413 when Content-Length exceeds MAX_BODY_BYTES before formData()', async () => {
    const req = makeRequest({
      files: [], // formData never called — body rejected first
      contentLength: MAX_BODY_BYTES + 1,
      failFormData: false,
    });
    // Override formData to throw if called — it must NOT be called.
    let formDataCalled = false;
    req.request.formData = async () => { formDataCalled = true; throw new Error('should not be called'); };

    const res = await POST(req);
    expect(res.status).toBe(413);
    expect(formDataCalled).toBe(false);
    expect(await res.text()).toMatch(/too large/i);
  });

  it('does not reject when Content-Length is exactly at the limit', async () => {
    const req = makeRequest({ files: [makeFile()], contentLength: MAX_BODY_BYTES });
    const res = await POST(req);
    // Should not be 413 from the Content-Length check (may be other statuses)
    expect(res.status).not.toBe(413);
  });

  it('does not reject when Content-Length header is absent', async () => {
    // No content-length header — cannot pre-reject
    const req = makeRequest({ files: [makeFile()], contentLength: null });
    const res = await POST(req);
    expect(res.status).not.toBe(413);
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

// ── 415 — unsupported MIME type ───────────────────────────────────────────────

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

// ── 415 — magic-byte mismatch ─────────────────────────────────────────────────

describe('POST /api/actions/receipts/[slug] — magic-byte sniff', () => {
  it('returns 415 when file claims image/png but contains HTML bytes', async () => {
    const res = await POST(makeRequest({
      files: [makeFile({ type: 'image/png', buf: htmlBuf() })],
    }));
    expect(res.status).toBe(415);
    expect(await res.text()).toMatch(/does not match declared type/i);
  });

  it('returns 415 when file claims image/jpeg but contains PNG bytes', async () => {
    const res = await POST(makeRequest({
      files: [makeFile({ type: 'image/jpeg', buf: magicBuf('image/png') })],
    }));
    expect(res.status).toBe(415);
  });

  it('returns 415 when file claims image/gif but contains all-zero bytes', async () => {
    const res = await POST(makeRequest({
      files: [makeFile({ type: 'image/gif', buf: new ArrayBuffer(100) })],
    }));
    expect(res.status).toBe(415);
  });

  it('accepts image/png with correct PNG magic bytes', async () => {
    const res = await POST(makeRequest({
      files: [makeFile({ type: 'image/png', buf: magicBuf('image/png') })],
    }));
    expect(res.status).not.toBe(415);
  });

  it('accepts image/webp with correct RIFF/WEBP magic bytes', async () => {
    const res = await POST(makeRequest({
      files: [makeFile({ type: 'image/webp', buf: magicBuf('image/webp') })],
    }));
    expect(res.status).not.toBe(415);
  });
});

// ── 413 / 422 — pixel-dimension cap (#496) ────────────────────────────────────

describe('POST /api/actions/receipts/[slug] — pixel-dimension cap', () => {
  it('returns 413 for a PNG declaring dimensions over MAX_DIMENSION (decompression bomb)', async () => {
    // 50000×50000 px in a tiny file — the byte cap (5 MB) wouldn't catch this.
    const res = await POST(makeRequest({
      files: [makeFile({ type: 'image/png', buf: oversizeBuf('image/png', 50000) })],
    }));
    expect(res.status).toBe(413);
    expect(await res.text()).toMatch(/too large \(max 4096/i);
    expect(mockChat).not.toHaveBeenCalled();
  });

  it('returns 413 for an oversized JPEG over the cap on one axis', async () => {
    const res = await POST(makeRequest({
      files: [makeFile({ type: 'image/jpeg', buf: magicBuf('image/jpeg', 100, 100, 9000) })],
    }));
    expect(res.status).toBe(413);
    expect(mockChat).not.toHaveBeenCalled();
  });

  it('returns 422 when dimensions cannot be read from a valid-magic but headerless image', async () => {
    // Correct JPEG magic but no SOF segment → dimensions unknown → rejected.
    const jpegMagicOnly = new ArrayBuffer(64);
    new Uint8Array(jpegMagicOnly).set([0xff, 0xd8, 0xff, 0xe0]);
    const res = await POST(makeRequest({
      files: [makeFile({ type: 'image/jpeg', buf: jpegMagicOnly })],
    }));
    expect(res.status).toBe(422);
    expect(await res.text()).toMatch(/dimensions/i);
    expect(mockChat).not.toHaveBeenCalled();
  });

  it('accepts an image within the dimension cap', async () => {
    const res = await POST(makeRequest({
      files: [makeFile({ type: 'image/png', buf: magicBuf('image/png', 100, 4096, 4096) })],
    }));
    expect(res.status).not.toBe(413);
    expect(res.status).not.toBe(422);
  });
});

// ── 413 — file too large (per-file) ───────────────────────────────────────────

describe('POST /api/actions/receipts/[slug] — per-file size limit', () => {
  it('returns 413 when an image exceeds MAX_BYTES (5 MB)', async () => {
    const res = await POST(makeRequest({
      files: [makeFile({ size: MAX_BYTES + 1 })],
    }));
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
    await POST(makeRequest({ files: [makeFile({ type: 'image/png', buf: magicBuf('image/png') })] }));
    const call = mockChat.mock.calls[0][0];
    const userContent = call.messages[0].content;
    const imageBlock = userContent.find(b => b.type === 'image');
    expect(imageBlock).toBeDefined();
    expect(imageBlock.mediaType).toBe('image/png');
    expect(typeof imageBlock.data).toBe('string'); // base64
  });
});

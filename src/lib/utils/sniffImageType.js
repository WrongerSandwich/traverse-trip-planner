/**
 * Sniff the leading bytes of an ArrayBuffer or Node.js Buffer to determine
 * the actual image format. Used to guard against files whose MIME type claim
 * doesn't match their real content.
 *
 * Supported signatures:
 *   JPEG  : ff d8 ff
 *   PNG   : 89 50 4e 47 0d 0a 1a 0a
 *   GIF   : 47 49 46 38  ("GIF8")
 *   WebP  : 52 49 46 46 … 57 45 42 50  ("RIFF….WEBP", bytes 0-3 and 8-11)
 *
 * @param {ArrayBuffer | Buffer} buf  The raw file bytes (only the first 12 are read).
 * @returns {'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' | null}
 */
export function sniffImageType(buf) {
  const b = new Uint8Array(
    buf instanceof ArrayBuffer ? buf : buf.buffer,
    0,
    Math.min(12, buf.byteLength ?? buf.length)
  );

  // JPEG: ff d8 ff
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';

  // PNG: 89 50 4e 47 0d 0a 1a 0a
  if (
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
  ) return 'image/png';

  // GIF: 47 49 46 38 ("GIF8")
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif';

  // WebP: "RIFF" at bytes 0-3 and "WEBP" at bytes 8-11
  if (
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) return 'image/webp';

  return null;
}

/**
 * Normalize an ArrayBuffer | Buffer into a Uint8Array view over its real bytes,
 * respecting byteOffset/byteLength for sliced Node Buffers.
 *
 * @param {ArrayBuffer | Buffer | Uint8Array} buf
 * @returns {Uint8Array}
 */
function asBytes(buf) {
  if (buf instanceof Uint8Array) return buf; // also covers Node Buffer
  if (buf instanceof ArrayBuffer) return new Uint8Array(buf);
  // Fallback: ArrayBufferView-like with a backing .buffer.
  return new Uint8Array(buf.buffer, buf.byteOffset ?? 0, buf.byteLength ?? buf.length);
}

/**
 * Parse the pixel dimensions of an image from its header bytes, without
 * decoding the pixels. Header-only parsing means a "decompression bomb" — a
 * tiny file that expands to a huge raster — is caught by its declared
 * dimensions before any downstream consumer (e.g. the model API) tries to
 * process it. Supports the same four formats sniffImageType recognizes.
 *
 * Returns `{ width, height }` (positive integers) or `null` if the dimensions
 * can't be located (truncated header, unsupported sub-format). A `null` result
 * is intentionally *not* treated as a pass by the caller's cap check — see the
 * receipts endpoint, which rejects when dimensions are unknown.
 *
 * Issue #496 (receipts feature is disabled via #367; this is for its revival).
 *
 * @param {ArrayBuffer | Buffer | Uint8Array} buf
 * @returns {{ width: number, height: number } | null}
 */
export function imageDimensions(buf) {
  const b = asBytes(buf);
  const n = b.length;
  if (n < 12) return null;

  const u16be = (o) => (b[o] << 8) | b[o + 1];
  const u16le = (o) => b[o] | (b[o + 1] << 8);
  const u32be = (o) => ((b[o] * 0x1000000) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3]) >>> 0;

  // PNG: IHDR is the first chunk; width @16, height @20 (big-endian u32).
  if (
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
  ) {
    if (n < 24) return null;
    const width = u32be(16);
    const height = u32be(20);
    return width > 0 && height > 0 ? { width, height } : null;
  }

  // GIF: logical screen width @6, height @8 (little-endian u16).
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) {
    const width = u16le(6);
    const height = u16le(8);
    return width > 0 && height > 0 ? { width, height } : null;
  }

  // WebP: "RIFF"…"WEBP" then a chunk fourcc at offset 12.
  if (
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) {
    const fourcc = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (fourcc === 'VP8 ') {
      // Lossy: frame tag at 23-25 is the start code (9d 01 2a), then
      // width @26, height @28 as 14-bit little-endian values.
      if (n < 30) return null;
      const width = u16le(26) & 0x3fff;
      const height = u16le(28) & 0x3fff;
      return width > 0 && height > 0 ? { width, height } : null;
    }
    if (fourcc === 'VP8L') {
      // Lossless: 1 signature byte (0x2f) @20, then 14-bit (width-1) and
      // (height-1) packed little-endian starting @21. Reconstruct the four
      // bytes at 21..24 as a 32-bit little-endian integer (unsigned).
      if (n < 25) return null;
      const le = (b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)) >>> 0;
      const width = (le & 0x3fff) + 1;
      const height = ((le >> 14) & 0x3fff) + 1;
      return width > 0 && height > 0 ? { width, height } : null;
    }
    if (fourcc === 'VP8X') {
      // Extended: 24-bit canvas width-1 @24, height-1 @27 (little-endian).
      if (n < 30) return null;
      const width = (b[24] | (b[25] << 8) | (b[26] << 16)) + 1;
      const height = (b[27] | (b[28] << 8) | (b[29] << 16)) + 1;
      return width > 0 && height > 0 ? { width, height } : null;
    }
    return null;
  }

  // JPEG: walk the marker segments to the SOFn frame header. Dimensions live in
  // a Start-Of-Frame marker (C0–C3, C5–C7, C9–CB, CD–CF) which can be anywhere
  // after the SOI. Bounded by the buffer length.
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    let o = 2;
    while (o + 9 < n) {
      // Markers are 0xFF followed by a non-0xFF, non-0x00 byte. Skip fill 0xFF.
      if (b[o] !== 0xff) { o++; continue; }
      let marker = b[o + 1];
      while (marker === 0xff && o + 2 < n) { o++; marker = b[o + 1]; }
      o += 2;
      // Standalone markers (RSTn, SOI, EOI, TEM) carry no length payload.
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
        continue;
      }
      if (o + 1 >= n) break;
      const segLen = u16be(o);
      const isSOF =
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf);
      if (isSOF) {
        // SOF payload: precision(1) height(2) width(2) …
        if (o + 5 >= n) return null;
        const height = u16be(o + 3);
        const width = u16be(o + 5);
        return width > 0 && height > 0 ? { width, height } : null;
      }
      if (segLen < 2) break; // malformed
      o += segLen;
    }
    return null;
  }

  return null;
}

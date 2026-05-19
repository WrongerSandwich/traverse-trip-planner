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

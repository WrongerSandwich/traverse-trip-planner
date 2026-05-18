import { json } from '@sveltejs/kit';
import { join } from 'path';
import { existsSync } from 'fs';
import { ROOT, appendToNotes } from '$lib/server/data.js';
import { chat } from '$lib/server/ai.js';
import { usageToTokens } from '$lib/utils/formatTokens.js';
import { getEffectiveConfig } from '$lib/server/config.js';
import { HAND_DEFAULTS } from '$lib/server/promises.js';
import { sniffImageType } from '$lib/utils/sniffImageType.js';

export const _promise = HAND_DEFAULTS.receipts;

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_IMAGES = 10;
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB per image
// Hard cap on the entire request body: 10 files × 5 MB + 64 KB overhead for
// multipart boundaries and form fields. Checked via Content-Length before
// formData() materialises the full body into memory.
const MAX_BODY_BYTES = MAX_IMAGES * MAX_BYTES + 64 * 1024;

// POST — process receipt photos and append parsed lines to notes.md.
// Body: multipart form data with one or more "image" file fields.
// Returns: { lines: string[] } — one line per receipt parsed.
export async function POST({ params, request }) {
  const { slug } = params;

  if (!existsSync(join(ROOT, 'completed', slug))) {
    return new Response('Trip not in completed stage', { status: 404 });
  }

  // Reject oversize bodies before formData() materialises anything.
  const contentLength = request.headers.get('content-length');
  if (contentLength !== null && Number(contentLength) > MAX_BODY_BYTES) {
    return new Response(
      `Request body too large (max ${MAX_IMAGES} × 5 MB)`,
      { status: 413 }
    );
  }

  let formData;
  try {
    formData = await request.formData();
  } catch {
    return new Response('Request must be multipart/form-data', { status: 400 });
  }

  const imageFiles = formData.getAll('image');
  if (!imageFiles.length) return new Response('No images provided', { status: 400 });
  if (imageFiles.length > MAX_IMAGES) {
    return new Response(`Too many images (max ${MAX_IMAGES})`, { status: 400 });
  }

  const imageBlocks = [];
  for (const file of imageFiles) {
    if (typeof file === 'string') return new Response('Expected file, got string', { status: 400 });
    const mediaType = file.type || 'image/jpeg';
    if (!ALLOWED_TYPES.has(mediaType)) {
      return new Response(`Unsupported image type: ${mediaType}`, { status: 415 });
    }
    const buf = await file.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) {
      return new Response(`Image too large (max 5 MB): ${file.name}`, { status: 413 });
    }
    // Magic-byte sniff: verify actual content matches the claimed MIME type.
    const detected = sniffImageType(buf);
    if (detected !== mediaType) {
      return new Response(
        `File content does not match declared type ${mediaType}: ${file.name}`,
        { status: 415 }
      );
    }
    const data = Buffer.from(buf).toString('base64');
    imageBlocks.push({ type: 'image', mediaType, data });
  }

  const system = `You are a travel expense parser. The user has uploaded ${imageBlocks.length === 1 ? 'a receipt photo' : 'receipt photos'} from a trip. Extract one line per receipt in this exact format:

<date> · <merchant> · <amount> · <category>

Rules:
- date: ISO 8601 (YYYY-MM-DD). If only month/day visible, use today's year. If illegible, write "unknown".
- merchant: short name, title case (e.g. "Blue Moon Cafe", "Asheville REI"). Strip "Inc", "LLC", "#123" branch numbers.
- amount: include currency symbol and two decimal places (e.g. "$42.17"). Use the total charged, not subtotal.
- category: one of: food | lodging | gas | gear | activity | transport | other
- One line per receipt, no extra text, no markdown, no preamble.
- If an image is not a receipt (e.g. a landscape photo), skip it silently.`;

  const userContent = [
    { type: 'text', text: 'Parse these receipts.' },
    ...imageBlocks,
  ];

  let text;
  let receiptUsage;
  try {
    const result = await chat({
      ...getEffectiveConfig().features.receipts,
      label: 'receipts',
      maxTokens: 800,
      system,
      messages: [{ role: 'user', content: userContent }],
    });
    text = result.text;
    receiptUsage = result.usage;
  } catch (err) {
    const msg = err.message ?? '';
    const isVision = /vision|image|multimodal|does not support/i.test(msg);
    const detail = isVision
      ? 'The configured model does not support image input. Set TRAVERSE_MODEL_RECEIPTS to a vision-capable model (e.g. claude-sonnet-4-6, gpt-4o).'
      : `Receipt parsing failed: ${msg}`;
    return new Response(detail, { status: 502 });
  }

  const lines = text
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.includes(' · '));

  if (!lines.length) {
    return new Response('No receipts found in the uploaded images', { status: 422 });
  }

  const section = `## Receipts\n\n${lines.map(l => `- ${l}`).join('\n')}`;
  try {
    appendToNotes(slug, section);
  } catch (err) {
    return new Response(`Failed to append to notes.md: ${err.message}`, { status: 500 });
  }

  return json({ lines, tokens: usageToTokens(receiptUsage) });
}

import { json } from '@sveltejs/kit';
import { join } from 'path';
import { existsSync } from 'fs';
import { ROOT, appendToNotes } from '$lib/server/data.js';
import { chat } from '$lib/server/ai.js';
import { getEffectiveConfig } from '$lib/server/config.js';

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_IMAGES = 10;
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB per image

// POST — process receipt photos and append parsed lines to notes.md.
// Body: multipart form data with one or more "image" file fields.
// Returns: { lines: string[] } — one line per receipt parsed.
export async function POST({ params, request }) {
  const { slug } = params;

  if (!existsSync(join(ROOT, 'completed', slug))) {
    return new Response('Trip not in completed stage', { status: 404 });
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
  try {
    const result = await chat({
      ...getEffectiveConfig().features.receipts,
      label: 'receipts',
      maxTokens: 800,
      system,
      messages: [{ role: 'user', content: userContent }],
    });
    text = result.text;
  } catch (err) {
    return new Response(`Receipt parsing failed: ${err.message}`, { status: 502 });
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

  return json({ lines });
}

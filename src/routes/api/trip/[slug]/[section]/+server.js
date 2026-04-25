import { json } from '@sveltejs/kit';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const VALID_SECTIONS = new Set(['overview', 'route', 'stops', 'logistics']);

function sectionPath(slug, section) {
  return join(ROOT, 'planning', slug, `${section}.md`);
}

export async function PUT({ params, request }) {
  const { slug, section } = params;
  if (!VALID_SECTIONS.has(section)) {
    return new Response('Invalid section', { status: 400 });
  }

  const dir = join(ROOT, 'planning', slug);
  if (!existsSync(dir)) {
    return new Response('Trip not in planning stage', { status: 404 });
  }

  const body = await request.json();
  const newBody = typeof body?.content === 'string' ? body.content : null;
  if (newBody === null) {
    return new Response('Missing "content"', { status: 400 });
  }

  const filePath = sectionPath(slug, section);

  if (section === 'overview') {
    // Preserve frontmatter; only replace the body below the closing ---.
    let frontmatter = '';
    if (existsSync(filePath)) {
      const existing = readFileSync(filePath, 'utf8');
      const match = existing.match(/^(---\n[\s\S]*?\n---\n)/);
      if (match) frontmatter = match[1];
    }
    const trimmedBody = newBody.replace(/^\s+/, '');
    const final = frontmatter
      ? `${frontmatter}\n${trimmedBody}${trimmedBody.endsWith('\n') ? '' : '\n'}`
      : `${trimmedBody}${trimmedBody.endsWith('\n') ? '' : '\n'}`;
    writeFileSync(filePath, final);
  } else {
    const final = newBody.endsWith('\n') ? newBody : `${newBody}\n`;
    writeFileSync(filePath, final);
  }

  return json({ ok: true, slug, section });
}

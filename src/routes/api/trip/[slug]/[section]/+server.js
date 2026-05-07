import { json } from '@sveltejs/kit';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { ROOT, PLANNING_SECTIONS, writePlanningSection } from '$lib/server/data.js';
const VALID_SECTIONS = new Set(PLANNING_SECTIONS);

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

  // TODO: wrap in .catch(() => null) and return 400 on malformed JSON (unlike chat/+server.js which already does this)
  const body = await request.json();
  const newBody = typeof body?.content === 'string' ? body.content : null;
  if (newBody === null) {
    return new Response('Missing "content"', { status: 400 });
  }

  const filePath = sectionPath(slug, section);
  let frontmatter = '';
  if (section === 'overview' && existsSync(filePath)) {
    const match = readFileSync(filePath, 'utf8').match(/^(---\n[\s\S]*?\n---\n)/);
    if (match) frontmatter = match[1];
  }
  writePlanningSection(dir, section, frontmatter, newBody);

  return json({ ok: true, slug, section });
}

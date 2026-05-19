import { json } from '@sveltejs/kit';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { ROOT, PLANNING_SECTIONS, writePlanningSection, rejectInvalidSlug } from '$lib/server/data.js';
const VALID_SECTIONS = new Set(PLANNING_SECTIONS);

function sectionPath(slug, section) {
  return join(ROOT, 'planning', slug, `${section}.md`);
}

export async function PUT({ params, request }) {
  const invalid = rejectInvalidSlug(params.slug);
  if (invalid) return invalid;
  const { slug, section } = params;
  if (!VALID_SECTIONS.has(section)) {
    return new Response('Invalid section', { status: 400 });
  }

  const dir = join(ROOT, 'planning', slug);
  if (!existsSync(dir)) {
    return new Response('Trip not in planning stage', { status: 404 });
  }

  const body = await request.json().catch(() => null);
  if (body === null) {
    return new Response('Invalid JSON body', { status: 400 });
  }
  const newBody = typeof body?.content === 'string' ? body.content : null;
  if (newBody === null) {
    return new Response('Missing "content"', { status: 400 });
  }

  // TODO: consolidate findTripFile() in data.js, findTrip() in archive/[slug]/+server.js, and
  // findIdeaFile() in deepen/[slug]/+server.js into a single exported helper returning
  // { path, stage, kind: 'file' | 'dir' } — all three traverse the same stage directories.

  const filePath = sectionPath(slug, section);
  let frontmatter = '';
  if (section === 'overview' && existsSync(filePath)) {
    const match = readFileSync(filePath, 'utf8').match(/^(---\n[\s\S]*?\n---\n)/);
    if (match) frontmatter = match[1];
  }
  writePlanningSection(dir, section, frontmatter, newBody);

  return json({ ok: true, slug, section });
}

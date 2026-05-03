import { json } from '@sveltejs/kit';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'fs';
import { join } from 'path';
import { ROOT } from '$lib/server/data.js';

export function POST({ params }) {
  const { slug } = params;
  const fromDir = join(ROOT, 'planning', slug);
  const toDir   = join(ROOT, 'completed', slug);

  if (!existsSync(fromDir)) {
    return new Response('Trip not in planning stage', { status: 404 });
  }
  if (existsSync(toDir)) {
    return new Response('Trip already in completed stage', { status: 409 });
  }

  mkdirSync(join(ROOT, 'completed'), { recursive: true });
  renameSync(fromDir, toDir);

  const overviewPath = join(toDir, 'overview.md');
  if (existsSync(overviewPath)) {
    const content = readFileSync(overviewPath, 'utf8');
    let updated;
    if (/^status:.*$/m.test(content)) {
      updated = content.replace(/^status:.*$/m, 'status: completed');
    } else {
      updated = content.replace(/^---\n/, '---\nstatus: completed\n');
    }
    writeFileSync(overviewPath, updated);
  }

  return json({ ok: true, slug, stage: 'completed' });
}

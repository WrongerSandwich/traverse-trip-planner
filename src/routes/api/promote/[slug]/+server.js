import { json } from '@sveltejs/kit';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();

export function POST({ params }) {
  const { slug } = params;
  const fromDir = join(ROOT, 'exploring', slug);
  const toDir   = join(ROOT, 'planning', slug);

  if (!existsSync(fromDir)) {
    return new Response('Trip not in exploring stage', { status: 404 });
  }
  if (existsSync(toDir)) {
    return new Response('Trip already in planning stage', { status: 409 });
  }

  mkdirSync(join(ROOT, 'planning'), { recursive: true });

  // Move the folder. Rename works as long as both paths are on the same fs.
  renameSync(fromDir, toDir);

  // Rewrite overview.md frontmatter status: exploring -> planning
  const overviewPath = join(toDir, 'overview.md');
  if (existsSync(overviewPath)) {
    const content = readFileSync(overviewPath, 'utf8');
    let updated;
    if (/^status:.*$/m.test(content)) {
      updated = content.replace(/^status:.*$/m, 'status: planning');
    } else {
      updated = content.replace(/^---\n/, '---\nstatus: planning\n');
    }
    writeFileSync(overviewPath, updated);
  }

  return json({ ok: true, slug, stage: 'planning' });
}

#!/usr/bin/env node
// Copies sample-data/* into the repo root for first-run exploration.
//   node scripts/seed-sample.js
// Safe to re-run: never overwrites an existing home.md or trip slug.

import { existsSync, mkdirSync, readdirSync, statSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLE = join(ROOT, 'sample-data');

if (!existsSync(SAMPLE)) {
  console.error(`No sample-data/ directory at ${SAMPLE}. Are you running this from a fresh clone?`);
  process.exit(1);
}

let copied = 0;
let skipped = 0;

function copyIfMissing(srcRel, dstRel) {
  const src = join(SAMPLE, srcRel);
  const dst = join(ROOT, dstRel);
  if (existsSync(dst)) {
    skipped++;
    console.log(`  skip   ${dstRel} (already exists)`);
    return;
  }
  mkdirSync(dirname(dst), { recursive: true });
  copyFileSync(src, dst);
  copied++;
  console.log(`  copy   ${dstRel}`);
}

function copyDirIfMissingSlug(stageRel) {
  const sampleStage = join(SAMPLE, stageRel);
  if (!existsSync(sampleStage)) return;
  for (const entry of readdirSync(sampleStage, { withFileTypes: true })) {
    if (entry.name === 'README.md') continue;
    const srcPath = join(sampleStage, entry.name);
    const dstPath = join(ROOT, stageRel, entry.name);
    if (existsSync(dstPath)) {
      skipped++;
      console.log(`  skip   ${stageRel}/${entry.name} (already exists)`);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.md')) {
      copyIfMissing(join(stageRel, entry.name), join(stageRel, entry.name));
    } else if (entry.isDirectory()) {
      // walk the trip folder, copy every file
      mkdirSync(dstPath, { recursive: true });
      for (const inner of readdirSync(srcPath)) {
        const innerSrc = join(srcPath, inner);
        const innerDst = join(dstPath, inner);
        if (statSync(innerSrc).isFile()) {
          copyFileSync(innerSrc, innerDst);
          copied++;
          console.log(`  copy   ${stageRel}/${entry.name}/${inner}`);
        }
      }
    }
  }
}

console.log('Seeding sample data into the repo root…');
console.log('');

// home.md (single file; only if not present)
copyIfMissing('home.md', 'home.md');

// Trip stages
for (const stage of ['ideas', 'planning', 'completed']) {
  copyDirIfMissingSlug(stage);
}

console.log('');
console.log(`Done. ${copied} copied, ${skipped} skipped.`);
if (copied > 0) {
  console.log('');
  console.log('Next: `npm run dev` (or `npm run build && PORT=3456 node build/index.js`) and open http://localhost:3456.');
}

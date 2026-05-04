import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { ROOT } from '$lib/server/data.js';

export function readDestinationsFromStageDir(stageDir, destinations) {
  if (!existsSync(stageDir)) return;
  for (const entry of readdirSync(stageDir, { withFileTypes: true })) {
    let file;
    if (entry.isFile() && entry.name.endsWith('.md')) {
      file = join(stageDir, entry.name);
    } else if (entry.isDirectory()) {
      const ov = join(stageDir, entry.name, 'overview.md');
      if (existsSync(ov)) file = ov;
    }
    if (!file) continue;
    const dest = readFileSync(file, 'utf8').match(/^destination: (.+)$/m)?.[1]?.trim();
    if (dest) destinations.push(dest);
  }
}

export function collectExistingDestinations() {
  const destinations = [];
  for (const stage of ['ideas', 'exploring', 'planning', 'completed']) {
    readDestinationsFromStageDir(join(ROOT, stage), destinations);
  }
  for (const stage of ['ideas', 'exploring', 'planning', 'completed']) {
    readDestinationsFromStageDir(join(ROOT, 'archived', stage), destinations);
  }
  return destinations;
}

// One-shot migration from the pre-#411 layout (trip stage dirs + home.md +
// settings.json + .cache/ at the repo root) to the consolidated `data/` subdir.
//
// Runs at module load in data.js. Idempotent: if `data/` already exists, the
// shim is a no-op so restarts after the first boot are free. Leaves any
// stragglers at the root in place rather than risk clobbering manual state
// the user may have created post-migration.

import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';

// Names we know belong under data/. Anything else at the repo root (src/,
// tests/, README.md, …) is left alone.
const LEGACY_NAMES = [
  'ideas',
  'planning',
  'completed',
  'archived',
  'home.md',
  'settings.json',
  '.cache',
];

/**
 * Move pre-reorg trip data + config into `data/` on first boot.
 *
 * @param {string} root — absolute path to the repo root (process.cwd() in prod).
 * @returns {{ migrated: boolean, moves: Array<{ name: string }> }}
 */
export function migrateRootDataToDataDir(root) {
  const dataDir = join(root, 'data');

  // Idempotency: once data/ exists, the migration has happened. Leave any
  // root-level dirs in place — they're either pre-#411 stragglers the user
  // chose to keep, or manual state we should not touch.
  if (existsSync(dataDir)) return { migrated: false, moves: [] };

  // Don't create data/ unless there's at least one legacy name to move into
  // it. Fresh clones (no legacy state) get to stay layout-pristine.
  const present = LEGACY_NAMES.filter((name) => existsSync(join(root, name)));
  if (present.length === 0) return { migrated: false, moves: [] };

  mkdirSync(dataDir, { recursive: true });

  const moves = [];
  for (const name of present) {
    const from = join(root, name);
    const to = join(dataDir, name);
    try {
      renameSync(from, to);
      moves.push({ name });
      console.log(`[data-migration] moved ${name} → data/${name}`);
    } catch (e) {
      console.warn(`[data-migration] failed to move ${name} —`, e.message);
    }
  }

  return { migrated: moves.length > 0, moves };
}

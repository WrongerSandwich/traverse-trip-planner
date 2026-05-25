// One-shot migration from the pre-#411 layout (trip stage dirs + home.md +
// settings.json + .cache/ at the repo root) to the consolidated `data/` subdir.
//
// Runs at module load in data.js.
//
// **Recovery contract.** A `.migration-incomplete` marker file inside `data/`
// is the canonical signal that a previous attempt didn't finish all moves
// (e.g. one renameSync threw EACCES mid-loop). On boot:
//   • data/ absent           → fresh or pure-legacy install; run the migration.
//   • data/ + marker present → previous attempt was partial; resume.
//   • data/ + no marker      → fully migrated OR user-curated data/. Hard
//                              no-op so we never touch user state we don't
//                              own.
//
// We use crossMountRename (not bare renameSync) because the destination
// can live on a different mount than the legacy source — e.g. a Docker
// bare-metal upgrader whose host has /data on a separate volume. EXDEV
// without a copy+remove fallback would strand files.

import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { crossMountRename } from './cross-mount-rename.js';

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

const INCOMPLETE_MARKER = '.migration-incomplete';

/**
 * Move pre-reorg trip data + config into `data/` on first boot.
 *
 * @param {string} root — absolute path to the repo root (process.cwd() in prod).
 * @param {{ rename?: (src: string, dst: string) => void }} [opts] — `rename` is
 *   injectable for tests; defaults to `crossMountRename`.
 * @returns {{ migrated: boolean, moves: Array<{ name: string }> }}
 */
export function migrateRootDataToDataDir(root, { rename = crossMountRename } = {}) {
  const dataDir = join(root, 'data');
  const marker = join(dataDir, INCOMPLETE_MARKER);

  const dataExists = existsSync(dataDir);
  const incompleteResume = dataExists && existsSync(marker);

  // Idempotency: a fully-migrated install (data/ exists, no marker) is a
  // hard no-op. Anything still at the root is treated as user state we
  // don't own — never touch it.
  if (dataExists && !incompleteResume) return { migrated: false, moves: [] };

  // Don't create data/ unless there's at least one legacy name to move into
  // it. Fresh clones (no legacy state) stay layout-pristine.
  const present = LEGACY_NAMES.filter((name) => existsSync(join(root, name)));
  if (present.length === 0) {
    // Clean up a stray marker from a prior partial run that has since been
    // resolved out-of-band (e.g. the user moved the remaining items manually).
    if (incompleteResume) {
      try { unlinkSync(marker); } catch { /* best-effort cleanup */ }
    }
    return { migrated: false, moves: [] };
  }

  if (!dataExists) mkdirSync(dataDir, { recursive: true });

  // Write the marker BEFORE attempting any moves so that an abort partway
  // through (e.g. process kill, disk full) leaves the recovery signal intact.
  try { writeFileSync(marker, ''); } catch (e) {
    console.warn(`[data-migration] failed to write recovery marker —`, e.message);
  }

  const moves = [];
  let allSucceeded = true;
  for (const name of present) {
    const from = join(root, name);
    const to = join(dataDir, name);
    try {
      rename(from, to);
      moves.push({ name });
      console.log(`[data-migration] moved ${name} → data/${name}`);
    } catch (e) {
      allSucceeded = false;
      console.warn(`[data-migration] failed to move ${name} — ${e.message}. Will retry on next boot.`);
    }
  }

  // Only clear the marker if every present entry moved successfully. Any
  // failure leaves it so the next boot resumes — see the contract at the
  // top of this file.
  if (allSucceeded) {
    try { unlinkSync(marker); } catch { /* may not exist if the write above failed */ }
  }

  return { migrated: moves.length > 0, moves };
}

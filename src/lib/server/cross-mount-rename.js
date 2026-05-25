// rename(2) fails with EXDEV across mount points — including separate Docker
// bind mounts that happen to share a host filesystem. The lifecycle moves
// (complete, archive, unarchive) all cross the planning/completed/archived
// bind-mount boundaries in production, so fall back to copy + remove.

import { renameSync, cpSync, rmSync } from 'node:fs';

export function crossMountRename(from, to) {
  try {
    renameSync(from, to);
    return;
  } catch (e) {
    if (e?.code !== 'EXDEV') throw e;
  }
  cpSync(from, to, { recursive: true });
  rmSync(from, { recursive: true, force: true });
}

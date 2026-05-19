// Atomic file write via temp-file + rename.
// Write `data` to a `.tmp` file beside `path`, then rename it into place.
// A crash or SIGTERM between write and rename leaves the canonical file
// untouched; the stale `.tmp` is silently overwritten on the next call.

import { writeFileSync, renameSync } from 'node:fs';

export function atomicWrite(path, data) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}

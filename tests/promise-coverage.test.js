import { describe, it, expect } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

const PROJECT_ROOT = new URL('../', import.meta.url).pathname;
const ROUTES_DIR = new URL('../src/routes/api', import.meta.url).pathname;

/** Recursively collect all +server.js files under a directory */
async function collectServerFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectServerFiles(full)));
    } else if (entry.name === '+server.js') {
      files.push(full);
    }
  }
  return files;
}

describe('promise-coverage', () => {
  it('every AI action route exports a valid promise object', async () => {
    const allFiles = await collectServerFiles(ROUTES_DIR);

    // Filter to AI action routes: anything that imports chat() directly OR
    // declares a `_promise` export (matches both inline literals and
    // reference-based exports like `export const _promise = HAND_DEFAULTS.x`).
    // The second clause covers Ambient Background routes that delegate the
    // chat() call to a server-side library (e.g. brochure prepare →
    // prepareBrochure → chat()) so the route file itself no longer imports
    // ai.js but still owes the trigger UI a promise contract.
    const aiRoutes = [];
    for (const file of allFiles) {
      const src = await readFile(file, 'utf8');
      const importsAi =
        src.includes("from '$lib/server/ai.js'") ||
        src.includes('from "$lib/server/ai.js"');
      const declaresPromise = /export\s+const\s+_promise\s*=/.test(src);
      if (importsAi || declaresPromise) {
        aiRoutes.push(file);
      }
    }

    expect(aiRoutes.length, 'Expected at least 9 AI action routes').toBeGreaterThanOrEqual(9);

    const errors = [];

    for (const file of aiRoutes) {
      let mod;
      try {
        mod = await import(pathToFileURL(file).href);
      } catch (e) {
        errors.push(`${relative(PROJECT_ROOT, file)}: failed to import (${e?.message ?? e})`);
        continue;
      }
      const p = mod._promise;
      if (!p || typeof p !== 'object') {
        errors.push(`${relative(PROJECT_ROOT, file)}: missing "export const _promise"`);
        continue;
      }

      // Validate shape
      if (typeof p.verb !== 'string' || !p.verb.trim()) {
        errors.push(`${relative(PROJECT_ROOT, file)}: promise.verb must be a non-empty string`);
      }
      if (typeof p.produces !== 'string' || !p.produces.trim()) {
        errors.push(`${relative(PROJECT_ROOT, file)}: promise.produces must be a non-empty string`);
      }
      if (
        typeof p.time_seconds !== 'number' ||
        !Number.isFinite(p.time_seconds) ||
        p.time_seconds < 0
      ) {
        errors.push(`${relative(PROJECT_ROOT, file)}: promise.time_seconds must be a non-negative finite number`);
      }
      if (
        !Array.isArray(p.tokens_range) ||
        p.tokens_range.length !== 2 ||
        !Number.isFinite(p.tokens_range[0]) ||
        !Number.isFinite(p.tokens_range[1]) ||
        p.tokens_range[0] < 0 ||
        p.tokens_range[1] < p.tokens_range[0]
      ) {
        errors.push(
          `${relative(PROJECT_ROOT, file)}: promise.tokens_range must be [min, max] with 0 <= min <= max`,
        );
      }
    }

    expect(
      errors,
      `Routes with missing or invalid promise exports:\n${errors.join('\n')}`,
    ).toEqual([]);
  });
});

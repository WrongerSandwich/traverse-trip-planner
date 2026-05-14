import { describe, it, expect } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

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

/**
 * Extract the promise object literal from source text.
 * Looks for:  export const _promise = { ... };
 * Returns the raw object text or null.
 *
 * The export uses the `_promise` name (underscore prefix) because SvelteKit
 * only allows HTTP verb names and underscore-prefixed names as named exports
 * from +server.js route files.
 */
function extractPromiseLiteral(source) {
  // Match export const _promise = { ... }; allowing multi-line
  const m = source.match(/export\s+const\s+_promise\s*=\s*(\{[\s\S]*?\});/);
  return m ? m[1] : null;
}

/**
 * Parse the raw object literal into a plain object.
 * Uses Function constructor to evaluate the JS object literal
 * (which may contain array literals, numbers, strings).
 */
function parseObjectLiteral(raw) {
  try {
    // eslint-disable-next-line no-new-func
    return new Function(`return (${raw})`)();
  } catch {
    return null;
  }
}

describe('promise-coverage', () => {
  it('every AI action route exports a valid promise object', async () => {
    const allFiles = await collectServerFiles(ROUTES_DIR);

    // Filter to routes that import chat() from the AI module
    const aiRoutes = [];
    for (const file of allFiles) {
      const src = await readFile(file, 'utf8');
      if (
        src.includes("from '$lib/server/ai.js'") ||
        src.includes('from "$lib/server/ai.js"')
      ) {
        aiRoutes.push(file);
      }
    }

    expect(aiRoutes.length, 'Expected at least 9 AI action routes').toBeGreaterThanOrEqual(9);

    const errors = [];

    for (const file of aiRoutes) {
      const src = await readFile(file, 'utf8');
      const raw = extractPromiseLiteral(src);

      if (!raw) {
        errors.push(`${file}: missing "export const _promise = {...}"`);
        continue;
      }

      const p = parseObjectLiteral(raw);
      if (!p) {
        errors.push(`${file}: promise literal could not be parsed`);
        continue;
      }

      // Validate shape
      if (typeof p.verb !== 'string' || !p.verb.trim()) {
        errors.push(`${file}: promise.verb must be a non-empty string`);
      }
      if (typeof p.produces !== 'string' || !p.produces.trim()) {
        errors.push(`${file}: promise.produces must be a non-empty string`);
      }
      if (
        typeof p.time_seconds !== 'number' ||
        !Number.isFinite(p.time_seconds) ||
        p.time_seconds < 0
      ) {
        errors.push(`${file}: promise.time_seconds must be a non-negative finite number`);
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
          `${file}: promise.tokens_range must be [min, max] with 0 <= min <= max`,
        );
      }
    }

    expect(
      errors,
      `Routes with missing or invalid promise exports:\n${errors.join('\n')}`,
    ).toEqual([]);
  });
});

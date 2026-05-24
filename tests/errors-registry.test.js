import { describe, it, expect } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ERROR_REGISTRY, AFFORDANCES } from '../src/lib/server/errors.js';

// Recursively collect all .js files under a directory
async function collectJsFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectJsFiles(full)));
    } else if (entry.name.endsWith('.js')) {
      files.push(full);
    }
  }
  return files;
}

// Extract first string argument from new TraverseError('code', ...) calls
function extractTraverseErrorCodes(source) {
  const codes = [];
  const re = /new\s+TraverseError\(\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    codes.push(m[1]);
  }
  return codes;
}

describe('ERROR_REGISTRY', () => {
  it('every TraverseError code thrown in src/ has a registry entry', async () => {
    const srcDir = new URL('../src', import.meta.url).pathname;
    const files = await collectJsFiles(srcDir);
    const missing = [];
    for (const file of files) {
      const src = await readFile(file, 'utf8');
      for (const code of extractTraverseErrorCodes(src)) {
        if (!(code in ERROR_REGISTRY)) {
          missing.push(`${file}: '${code}'`);
        }
      }
    }
    expect(missing, `Codes with no registry entry:\n${missing.join('\n')}`).toEqual([]);
  });

  it('every affordance in the registry is in AFFORDANCES', () => {
    const affordanceSet = new Set(AFFORDANCES);
    const bad = [];
    for (const [code, entry] of Object.entries(ERROR_REGISTRY)) {
      for (const aff of entry.affordances) {
        if (!affordanceSet.has(aff)) {
          bad.push(`${code}: unknown affordance '${aff}'`);
        }
      }
    }
    expect(bad, `Unknown affordances:\n${bad.join('\n')}`).toEqual([]);
  });

  it('every interpolate key appears as {key} in the sentence template', () => {
    const bad = [];
    for (const [code, entry] of Object.entries(ERROR_REGISTRY)) {
      if (!entry.interpolate) continue;
      for (const key of entry.interpolate) {
        if (!entry.sentence.includes(`{${key}}`)) {
          bad.push(`${code}: interpolate key '${key}' not found as '{${key}}' in sentence`);
        }
      }
    }
    expect(bad, `Mismatched interpolate keys:\n${bad.join('\n')}`).toEqual([]);
  });
});

describe('image cover-photo codes', () => {
  it('exposes image_search_failed with a retry affordance', () => {
    expect(ERROR_REGISTRY.image_search_failed).toBeDefined();
    expect(ERROR_REGISTRY.image_search_failed.affordances).toContain('retry');
  });
  it('exposes image_search_unconfigured with a dismiss affordance', () => {
    expect(ERROR_REGISTRY.image_search_unconfigured).toBeDefined();
    expect(ERROR_REGISTRY.image_search_unconfigured.affordances).toContain('dismiss');
  });
  it('exposes image_save_failed with a retry affordance', () => {
    expect(ERROR_REGISTRY.image_save_failed).toBeDefined();
    expect(ERROR_REGISTRY.image_save_failed.affordances).toContain('retry');
  });
});

describe('candidate_duplicate', () => {
  it('is registered with name interpolation and dismiss affordance', () => {
    const entry = ERROR_REGISTRY.candidate_duplicate;
    expect(entry).toBeDefined();
    expect(entry.interpolate).toEqual(['name']);
    expect(entry.sentence).toContain('{name}');
    expect(entry.affordances).toEqual(['dismiss']);
    expect(entry.affordances.every((a) => AFFORDANCES.includes(a))).toBe(true);
  });
});

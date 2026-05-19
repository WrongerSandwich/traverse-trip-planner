/**
 * Tests for atomicWrite against the real filesystem.
 *
 * These tests use a real temp directory to verify the rename-based
 * crash-safety guarantee without needing to mock fs.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { atomicWrite } from '../src/lib/server/data.js';

let tmpDir;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'traverse-atomic-'));
});

afterEach(() => {
  // Best-effort cleanup — temp files from this test run
  for (const name of ['test.json', 'important.json', 'overwrite.json']) {
    const p = join(tmpDir, name);
    try { require('fs').unlinkSync(p); } catch {}
    try { require('fs').unlinkSync(`${p}.tmp`); } catch {}
  }
  try { require('fs').rmdirSync(tmpDir); } catch {}
});

describe('atomicWrite', () => {
  it('writes the data to the target path', () => {
    const target = join(tmpDir, 'test.json');
    atomicWrite(target, '{"ok":true}');
    expect(readFileSync(target, 'utf8')).toBe('{"ok":true}');
  });

  it('leaves no .tmp file behind after a successful write', () => {
    const target = join(tmpDir, 'test.json');
    atomicWrite(target, 'content');
    expect(existsSync(`${target}.tmp`)).toBe(false);
  });

  it('does NOT corrupt the canonical file when a stale .tmp file is present', () => {
    // Simulate: canonical file has valid content, stale .tmp exists from a
    // prior crash before the rename completed.
    const target = join(tmpDir, 'important.json');
    const goodContent = '{"valid":true}';
    writeFileSync(target, goodContent);

    // Manually leave a truncated .tmp (simulates mid-write crash of a prior run)
    writeFileSync(`${target}.tmp`, 'TRUNCATED');

    // The canonical file must still be readable and correct
    expect(readFileSync(target, 'utf8')).toBe(goodContent);

    // A fresh atomicWrite succeeds: it overwrites .tmp then renames it
    atomicWrite(target, '{"updated":true}');
    expect(readFileSync(target, 'utf8')).toBe('{"updated":true}');
    expect(existsSync(`${target}.tmp`)).toBe(false);
  });

  it('overwrites an existing canonical file atomically', () => {
    const target = join(tmpDir, 'overwrite.json');
    atomicWrite(target, 'first');
    atomicWrite(target, 'second');
    expect(readFileSync(target, 'utf8')).toBe('second');
  });
});

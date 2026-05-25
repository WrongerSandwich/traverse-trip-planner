/**
 * Tests for crossMountRename — the EXDEV fallback that lets lifecycle moves
 * (complete, archive, unarchive) work across Docker bind mounts.
 *
 * In production each of planning/ completed/ archived/ is a separate bind
 * mount, so rename(2) returns EXDEV even though they share a host disk.
 * The fallback copies recursively then removes the source.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockRenameSync, mockCpSync, mockRmSync } = vi.hoisted(() => ({
  mockRenameSync: vi.fn(),
  mockCpSync: vi.fn(),
  mockRmSync: vi.fn(),
}));

vi.mock('node:fs', () => ({
  renameSync: mockRenameSync,
  cpSync: mockCpSync,
  rmSync: mockRmSync,
}));

import { crossMountRename } from '../src/lib/server/cross-mount-rename.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('crossMountRename', () => {
  it('uses a single renameSync when no error is thrown', () => {
    crossMountRename('/from', '/to');

    expect(mockRenameSync).toHaveBeenCalledWith('/from', '/to');
    expect(mockCpSync).not.toHaveBeenCalled();
    expect(mockRmSync).not.toHaveBeenCalled();
  });

  it('falls back to copy + remove when renameSync throws EXDEV', () => {
    mockRenameSync.mockImplementationOnce(() => {
      const err = new Error('EXDEV: cross-device link not permitted');
      err.code = 'EXDEV';
      throw err;
    });

    crossMountRename('/planning/ozarks', '/completed/ozarks');

    expect(mockRenameSync).toHaveBeenCalledWith('/planning/ozarks', '/completed/ozarks');
    expect(mockCpSync).toHaveBeenCalledWith(
      '/planning/ozarks',
      '/completed/ozarks',
      { recursive: true }
    );
    expect(mockRmSync).toHaveBeenCalledWith(
      '/planning/ozarks',
      { recursive: true, force: true }
    );
  });

  it('rethrows non-EXDEV rename errors without falling back', () => {
    const err = new Error('EACCES: permission denied');
    err.code = 'EACCES';
    mockRenameSync.mockImplementationOnce(() => { throw err; });

    expect(() => crossMountRename('/from', '/to')).toThrow(/EACCES/);
    expect(mockCpSync).not.toHaveBeenCalled();
    expect(mockRmSync).not.toHaveBeenCalled();
  });
});

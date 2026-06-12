import { describe, it, expect } from 'vitest';
import { partitionPaletteUpdates } from '../src/lib/utils/paletteUpdates.js';

describe('partitionPaletteUpdates', () => {
  it('applies all updates when no section is being edited', () => {
    const updates = { overview: 'new o', route: 'new r' };
    const { applied, queued } = partitionPaletteUpdates(updates, {});
    expect(applied.sort()).toEqual(['overview', 'route']);
    expect(queued).toEqual([]);
  });

  it('queues an update for a section that is currently in edit mode', () => {
    const updates = { overview: 'new o' };
    const { applied, queued } = partitionPaletteUpdates(updates, { overview: true });
    // Would have caught #494: the old handler overwrote sections[overview] and
    // closed the editor, discarding the user's unsaved draft. Here the update
    // must NOT be in `applied` (no clobber) — it lands in `queued`.
    expect(applied).toEqual([]);
    expect(queued).toEqual(['overview']);
  });

  it('splits a mixed batch by per-section edit state', () => {
    const updates = { overview: 'new o', route: 'new r', logistics: 'new l' };
    const editing = { route: true };
    const { applied, queued } = partitionPaletteUpdates(updates, editing);
    expect(applied.sort()).toEqual(['logistics', 'overview']);
    expect(queued).toEqual(['route']);
  });

  it('treats a section with editing=false as applied', () => {
    const { applied, queued } = partitionPaletteUpdates({ overview: 'x' }, { overview: false });
    expect(applied).toEqual(['overview']);
    expect(queued).toEqual([]);
  });

  it('tolerates missing/empty arguments', () => {
    expect(partitionPaletteUpdates(undefined, undefined)).toEqual({ applied: [], queued: [] });
    expect(partitionPaletteUpdates({}, {})).toEqual({ applied: [], queued: [] });
  });
});

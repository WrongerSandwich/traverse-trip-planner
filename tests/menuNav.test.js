import { describe, it, expect } from 'vitest';
import { nextMenuIndex, collectMenuItems } from '../src/lib/utils/menuNav.js';

// ── nextMenuIndex ────────────────────────────────────────────────────────────

describe('nextMenuIndex', () => {
  const items = [
    { disabled: false },
    { disabled: false },
    { disabled: false },
  ];

  describe('direction: down', () => {
    it('moves from -1 to 0 on first down', () => {
      expect(nextMenuIndex(items, -1, 'down')).toBe(0);
    });

    it('advances forward', () => {
      expect(nextMenuIndex(items, 0, 'down')).toBe(1);
      expect(nextMenuIndex(items, 1, 'down')).toBe(2);
    });

    it('wraps from last to first', () => {
      expect(nextMenuIndex(items, 2, 'down')).toBe(0);
    });
  });

  describe('direction: up', () => {
    it('moves from -1 to last on first up', () => {
      expect(nextMenuIndex(items, -1, 'up')).toBe(2);
    });

    it('goes backward', () => {
      expect(nextMenuIndex(items, 2, 'up')).toBe(1);
      expect(nextMenuIndex(items, 1, 'up')).toBe(0);
    });

    it('wraps from first to last', () => {
      expect(nextMenuIndex(items, 0, 'up')).toBe(2);
    });
  });

  describe('direction: first / last', () => {
    it('first returns index 0 when nothing is disabled', () => {
      expect(nextMenuIndex(items, 2, 'first')).toBe(0);
    });

    it('last returns final index when nothing is disabled', () => {
      expect(nextMenuIndex(items, 0, 'last')).toBe(2);
    });
  });

  describe('disabled-item skipping', () => {
    const withDisabled = [
      { disabled: true },
      { disabled: false },
      { disabled: true },
    ];

    it('skips disabled on down', () => {
      expect(nextMenuIndex(withDisabled, -1, 'down')).toBe(1);
    });

    it('skips disabled on up', () => {
      expect(nextMenuIndex(withDisabled, -1, 'up')).toBe(1);
    });

    it('wraps past disabled item', () => {
      // from index 1 going down → wraps to 0 (disabled), skips to 1
      // only enabled item is 1 — should stay at 1
      expect(nextMenuIndex(withDisabled, 1, 'down')).toBe(1);
    });

    it('first skips leading disabled', () => {
      expect(nextMenuIndex(withDisabled, -1, 'first')).toBe(1);
    });

    it('last skips trailing disabled', () => {
      expect(nextMenuIndex(withDisabled, -1, 'last')).toBe(1);
    });
  });

  describe('all disabled', () => {
    const allDisabled = [{ disabled: true }, { disabled: true }];

    it('returns current unchanged when all items are disabled (down)', () => {
      expect(nextMenuIndex(allDisabled, 0, 'down')).toBe(0);
    });

    it('returns current unchanged when all items are disabled (up)', () => {
      expect(nextMenuIndex(allDisabled, 1, 'up')).toBe(1);
    });

    it('returns -1 for first when all disabled', () => {
      expect(nextMenuIndex(allDisabled, -1, 'first')).toBe(-1);
    });
  });

  describe('empty list', () => {
    it('returns -1', () => {
      expect(nextMenuIndex([], -1, 'down')).toBe(-1);
    });
  });
});

// ── collectMenuItems ─────────────────────────────────────────────────────────

describe('collectMenuItems', () => {
  it('collects buttons and links across groups', () => {
    const groups = [
      {
        label: 'Output',
        items: [
          { type: 'link', label: 'View brochure', href: '/x' },
          { type: 'button', label: 'Share', onclick: () => {} },
        ],
      },
      {
        label: 'Lifecycle',
        items: [
          { type: 'button', label: 'Complete', onclick: () => {} },
          { type: 'button', label: 'Archive', danger: true, onclick: () => {} },
        ],
      },
    ];
    const result = collectMenuItems(groups);
    expect(result).toHaveLength(4);
  });

  it('excludes hidden items', () => {
    const groups = [
      {
        label: 'Group',
        items: [
          { type: 'button', label: 'Visible', onclick: () => {} },
          { type: 'button', label: 'Hidden', hidden: true, onclick: () => {} },
        ],
      },
    ];
    expect(collectMenuItems(groups)).toHaveLength(1);
  });

  it('excludes text-type items', () => {
    const groups = [
      {
        label: 'Group',
        items: [
          { type: 'text', value: 'some text' },
          { type: 'button', label: 'Action', onclick: () => {} },
        ],
      },
    ];
    expect(collectMenuItems(groups)).toHaveLength(1);
  });

  it('excludes sub-row items', () => {
    const groups = [
      {
        label: 'Group',
        items: [
          { type: 'sub-row', key: 'share-url' },
          { type: 'button', label: 'Action', onclick: () => {} },
        ],
      },
    ];
    expect(collectMenuItems(groups)).toHaveLength(1);
  });

  it('preserves disabled flag', () => {
    const groups = [
      {
        items: [{ type: 'button', label: 'Grayed', disabled: true, onclick: () => {} }],
      },
    ];
    const [item] = collectMenuItems(groups);
    expect(item.disabled).toBe(true);
  });

  it('handles empty groups gracefully', () => {
    expect(collectMenuItems([])).toHaveLength(0);
    expect(collectMenuItems([{ label: 'Empty', items: [] }])).toHaveLength(0);
  });
});

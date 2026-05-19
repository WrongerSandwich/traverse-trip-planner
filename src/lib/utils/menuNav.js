/**
 * menuNav — pure keyboard-navigation helpers for KebabMenu.
 *
 * All functions are side-effect free so they can be unit-tested without DOM.
 */

/**
 * Given a flat list of navigable item descriptors, find the next focusable
 * index from `current` in the given `direction`.
 *
 * @param {Array<{disabled?: boolean}>} items   — flat list of menu items (non-hidden only)
 * @param {number}                       current — currently focused index (−1 = none)
 * @param {'down'|'up'|'first'|'last'}   direction
 * @returns {number}  new index, or current if no enabled item found
 */
export function nextMenuIndex(items, current, direction) {
  const len = items.length;
  if (len === 0) return -1;

  if (direction === 'first') {
    for (let i = 0; i < len; i++) {
      if (!items[i].disabled) return i;
    }
    return current;
  }

  if (direction === 'last') {
    for (let i = len - 1; i >= 0; i--) {
      if (!items[i].disabled) return i;
    }
    return current;
  }

  const step = direction === 'down' ? 1 : -1;
  let idx = current === -1 ? (direction === 'down' ? -1 : len) : current;

  for (let count = 0; count < len; count++) {
    idx = (idx + step + len) % len;
    if (!items[idx].disabled) return idx;
  }

  return current; // all disabled — don't move
}

/**
 * Collect the visible, focusable menu items from KebabMenu `groups`.
 *
 * Items with `hidden: true` are excluded.
 * Items of type 'text', 'sub-row', or undefined type are excluded.
 * Links and buttons (including disabled ones) are included.
 *
 * Returns a flat array so callers can index into it.
 *
 * @param {Array<{items: Array}>} groups
 * @returns {Array<{disabled?: boolean, type?: string}>}
 */
export function collectMenuItems(groups) {
  const result = [];
  for (const group of groups) {
    for (const item of group.items ?? []) {
      if (item.hidden) continue;
      if (item.type === 'text') continue;
      if (item.type === 'sub-row') continue;
      result.push(item);
    }
  }
  return result;
}

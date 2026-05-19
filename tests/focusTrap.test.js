/**
 * Tests for the focusTrap action (#280).
 *
 * Covers:
 *  - Initial focus lands on the provided `initial` element or the first
 *    focusable descendant.
 *  - Tab/Shift+Tab cycle within the trap and don't escape to the page.
 *  - Disabled / hidden elements are skipped during cycling.
 *  - Escape key invokes the onEscape callback when provided.
 *  - Destroying the action restores focus to the previously-active element.
 *  - When `enabled: false`, the trap doesn't steal focus on mount; flipping
 *    to enabled later moves focus in.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { focusTrap } from '../src/lib/actions/focusTrap.js';

function makeDialog({ buttons = 2, disabledIndex = -1 } = {}) {
  document.body.innerHTML = `
    <button id="trigger">Open</button>
    <div id="dialog" role="dialog">
      ${Array.from({ length: buttons }, (_, i) =>
        `<button id="b${i}"${i === disabledIndex ? ' disabled' : ''}>B${i}</button>`,
      ).join('')}
    </div>
  `;
  const trigger = document.getElementById('trigger');
  const dialog = document.getElementById('dialog');
  // jsdom-only: offsetParent returns null for elements not in a visible layout,
  // which breaks our focusable filter. Patch to always return a truthy value.
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get() { return document.body; },
  });
  return { trigger, dialog };
}

function tab(shift = false) {
  document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Tab', shiftKey: shift, bubbles: true, cancelable: true,
  }));
}
function esc() {
  document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Escape', bubbles: true, cancelable: true,
  }));
}
async function flush() { await new Promise((r) => queueMicrotask(r)); }

describe('focusTrap', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('focuses the first focusable descendant on mount', async () => {
    const { dialog } = makeDialog({ buttons: 2 });
    focusTrap(dialog);
    await flush();
    expect(document.activeElement.id).toBe('b0');
  });

  it('respects the `initial` element when provided', async () => {
    const { dialog } = makeDialog({ buttons: 2 });
    focusTrap(dialog, { initial: document.getElementById('b1') });
    await flush();
    expect(document.activeElement.id).toBe('b1');
  });

  it('Tab cycles from last back to first', async () => {
    const { dialog } = makeDialog({ buttons: 3 });
    focusTrap(dialog);
    await flush();
    document.getElementById('b2').focus();
    tab();
    expect(document.activeElement.id).toBe('b0');
  });

  it('Shift+Tab cycles from first to last', async () => {
    const { dialog } = makeDialog({ buttons: 3 });
    focusTrap(dialog);
    await flush();
    document.getElementById('b0').focus();
    tab(true);
    expect(document.activeElement.id).toBe('b2');
  });

  it('skips disabled elements when cycling', async () => {
    const { dialog } = makeDialog({ buttons: 3, disabledIndex: 1 });
    focusTrap(dialog);
    await flush();
    expect(document.activeElement.id).toBe('b0');
    document.getElementById('b2').focus();
    tab();
    expect(document.activeElement.id).toBe('b0');
  });

  it('invokes onEscape on Escape', async () => {
    const { dialog } = makeDialog();
    let called = 0;
    focusTrap(dialog, { onEscape: () => { called++; } });
    await flush();
    esc();
    expect(called).toBe(1);
  });

  it('does not focus on mount when enabled: false', async () => {
    const { trigger, dialog } = makeDialog();
    trigger.focus();
    focusTrap(dialog, { enabled: false });
    await flush();
    expect(document.activeElement.id).toBe('trigger');
  });

  it('moves focus in on update from enabled: false → true', async () => {
    const { trigger, dialog } = makeDialog();
    trigger.focus();
    const ctrl = focusTrap(dialog, { enabled: false });
    await flush();
    expect(document.activeElement.id).toBe('trigger');
    ctrl.update({ enabled: true });
    await flush();
    expect(document.activeElement.id).toBe('b0');
  });

  it('restores focus to previousFocus on destroy', async () => {
    const { trigger, dialog } = makeDialog();
    trigger.focus();
    const ctrl = focusTrap(dialog);
    await flush();
    expect(document.activeElement.id).toBe('b0');
    ctrl.destroy();
    expect(document.activeElement.id).toBe('trigger');
  });
});

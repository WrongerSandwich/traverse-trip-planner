/**
 * Svelte action: trap keyboard focus inside a modal-like surface (#280).
 *
 * Apply to any element with `role="dialog"` (or any focus-trapped container):
 *   <div role="dialog" use:focusTrap={{ initial: cancelBtn, onEscape: cancel }}>
 *
 * Behavior:
 *  - On mount: stashes `document.activeElement`, focuses `params.initial` if
 *    provided, else the first focusable descendant, else the node itself
 *    (which gets tabindex=-1 so it can receive focus).
 *  - On Tab / Shift+Tab: cycles focus within the node's focusable descendants,
 *    re-computing the list on each keydown so dynamically-mounted controls
 *    are included.
 *  - On Escape: calls `params.onEscape` if provided. Pass null/undefined to
 *    let the consumer wire its own keydown.
 *  - On destroy: restores focus to the stashed previousFocus element.
 *
 * `params` is reactive — pass a new `initial` or `onEscape` to update.
 *
 * For surfaces that mount unconditionally (e.g. a chat aside that animates
 * via a `.open` class instead of being inserted into the DOM), pass
 * `enabled: false` while the surface is closed so the trap doesn't steal
 * focus on first page load. Update with `enabled: true` when the surface
 * opens.
 *
 * @param {HTMLElement} node
 * @param {{ initial?: HTMLElement|null, onEscape?: (() => void)|null, enabled?: boolean }} params
 */
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function focusTrap(node, params = {}) {
  let { initial = null, onEscape = null, enabled = true } = params;

  const previousFocus = /** @type {HTMLElement|null} */ (document.activeElement);

  function focusables() {
    return /** @type {HTMLElement[]} */ ([...node.querySelectorAll(FOCUSABLE_SELECTOR)])
      .filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null);
  }

  function focusInitial() {
    if (initial && typeof initial.focus === 'function') {
      initial.focus();
      return;
    }
    const list = focusables();
    if (list.length > 0) {
      list[0].focus();
      return;
    }
    // No descendants focusable yet — let the container itself receive focus.
    if (!node.hasAttribute('tabindex')) node.setAttribute('tabindex', '-1');
    node.focus();
  }

  function handleKey(e) {
    if (!enabled) return;
    if (e.key === 'Escape' && onEscape) {
      e.preventDefault();
      onEscape();
      return;
    }
    if (e.key !== 'Tab') return;
    const list = focusables();
    if (list.length === 0) {
      e.preventDefault();
      return;
    }
    const first = list[0];
    const last = list[list.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !node.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !node.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  }

  node.addEventListener('keydown', handleKey);
  // Focus AFTER mount so child <bind:this> refs have populated, and only if
  // the trap is currently enabled (skip on always-mounted surfaces that are
  // closed at first render).
  if (enabled) queueMicrotask(focusInitial);

  return {
    update(next = {}) {
      const prevEnabled = enabled;
      initial = next.initial ?? null;
      onEscape = next.onEscape ?? null;
      enabled = next.enabled !== false;
      // Edge transition from disabled → enabled (e.g. chat aside opens).
      if (!prevEnabled && enabled) queueMicrotask(focusInitial);
    },
    destroy() {
      node.removeEventListener('keydown', handleKey);
      if (enabled && previousFocus && typeof previousFocus.focus === 'function') {
        previousFocus.focus();
      }
    },
  };
}

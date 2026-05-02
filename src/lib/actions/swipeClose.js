/**
 * Svelte action: calls onclose() when the user swipes right past the
 * threshold. Generous bounds intentionally — accidental closes are worse
 * than requiring a deliberate swipe.
 *
 * Usage: <aside use:swipeClose={() => open = false}>
 *
 * TODO: consider adding a left-swipe variant if any panel ever slides in from
 * the left side of the screen.
 */
export function swipeClose(node, onclose) {
  let startX = 0, startY = 0, startT = 0;

  function handleTouchStart(e) {
    const t = e.touches[0];
    startX = t.clientX; startY = t.clientY; startT = Date.now();
  }

  function handleTouchEnd(e) {
    const t = e.changedTouches[0];
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;
    const dt = Date.now() - startT;
    if (dx > 80 && Math.abs(dy) < 40 && dt < 500) onclose();
  }

  node.addEventListener('touchstart', handleTouchStart);
  node.addEventListener('touchend', handleTouchEnd);

  return {
    update(newOnclose) { onclose = newOnclose; },
    destroy() {
      node.removeEventListener('touchstart', handleTouchStart);
      node.removeEventListener('touchend', handleTouchEnd);
    }
  };
}

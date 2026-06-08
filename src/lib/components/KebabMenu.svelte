<script>
  /**
   * KebabMenu — a generic dropdown menu anchored to a ⋯ trigger button.
   *
   * Props:
   *   items  — array of group objects:
   *     { label: string, items: MenuItem[] }
   *   MenuItem:
   *     { type: 'button', label, onclick, danger?, disabled?, hidden? }
   *     { type: 'link',   label, href, target?, rel?, danger?, hidden? }
   *     { type: 'sub-row', hidden? }  — renders slot "subrow-<key>"
   *     { key?: string }  — optional key for sub-row matching
   *
   * Usage:
   *   <KebabMenu groups={[
   *     { label: 'Output', items: [
   *       { type: 'link', label: 'View full brochure ↗', href: '/trips/foo/brochure', target: '_blank' },
   *       { type: 'button', label: 'Generate share link', onclick: enableShare },
   *     ]},
   *     { label: 'Lifecycle', items: [
   *       { type: 'button', label: 'Mark as completed', onclick: completeTrip },
   *       { type: 'button', label: 'Archive', onclick: archiveTrip, danger: true },
   *     ]},
   *   ]} />
   */

  import { tick } from 'svelte';
  import { nextMenuIndex, collectMenuItems } from '$lib/utils/menuNav.js';

  /** @typedef {{ label: string, items: import('./KebabMenu.svelte').MenuItem[] }} MenuGroup */

  let { groups = [], triggerLabel = 'More actions' } = $props();

  let open = $state(false);
  let triggerEl = $state(null);
  let panelEl = $state(null);

  // Index of the currently keyboard-focused menu item (−1 = none).
  let focusedIndex = $state(-1);

  // Flat list of visible focusable items, recomputed whenever groups or open changes.
  const focusableItems = $derived(open ? collectMenuItems(groups) : []);

  /**
   * Focus the item at `idx` in the panel.
   * We find the rendered [role="menuitem"] elements by querying the panel.
   */
  async function focusItemAt(idx) {
    await tick();
    if (!panelEl) return;
    const els = panelEl.querySelectorAll('[role="menuitem"]:not([aria-disabled="true"])');
    // Map flat focusable index → DOM order index (same order since collectMenuItems mirrors render order).
    // We need to walk all menuitem elements and match enabled ones.
    const allItems = panelEl.querySelectorAll('[role="menuitem"]');
    // Build enabled-only list from DOM in order to align with focusableItems order.
    const enabledEls = [...allItems].filter(el => el.getAttribute('aria-disabled') !== 'true' && !el.disabled);
    if (enabledEls[idx]) {
      enabledEls[idx].focus();
    }
  }

  async function openMenu() {
    open = true;
    focusedIndex = -1;
    // Focus the first enabled item
    await tick();
    const firstIdx = nextMenuIndex(focusableItems, -1, 'first');
    if (firstIdx !== -1) {
      focusedIndex = firstIdx;
      focusItemAt(firstIdx);
    } else {
      // No enabled items — focus the panel itself so Escape still works
      await tick();
      panelEl?.focus();
    }
  }

  function closeMenu() {
    if (!open) return;
    open = false;
    focusedIndex = -1;
    // Return focus to the trigger
    triggerEl?.focus();
  }

  function toggle() {
    if (open) {
      closeMenu();
    } else {
      openMenu();
    }
  }

  function handleItemClick(item) {
    if (item.onclick) item.onclick();
    closeMenu();
  }

  function handleMenuKeydown(e) {
    if (!open) return;

    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        closeMenu();
        break;

      case 'ArrowDown': {
        e.preventDefault();
        const next = nextMenuIndex(focusableItems, focusedIndex, 'down');
        focusedIndex = next;
        focusItemAt(next);
        break;
      }

      case 'ArrowUp': {
        e.preventDefault();
        const prev = nextMenuIndex(focusableItems, focusedIndex, 'up');
        focusedIndex = prev;
        focusItemAt(prev);
        break;
      }

      case 'Home': {
        e.preventDefault();
        const first = nextMenuIndex(focusableItems, focusedIndex, 'first');
        focusedIndex = first;
        focusItemAt(first);
        break;
      }

      case 'End': {
        e.preventDefault();
        const last = nextMenuIndex(focusableItems, focusedIndex, 'last');
        focusedIndex = last;
        focusItemAt(last);
        break;
      }

      case 'Tab':
        // Close on Tab — let focus continue naturally to the next element.
        closeMenu();
        break;

      default:
        break;
    }
  }

  function handleGlobalKeydown(e) {
    if (e.key === 'Escape' && open) {
      e.preventDefault();
      closeMenu();
    }
  }

  function handlePointerDown(e) {
    if (!open) return;
    if (triggerEl && triggerEl.contains(e.target)) return;
    if (panelEl && panelEl.contains(e.target)) return;
    closeMenu();
  }
</script>

<svelte:window onkeydown={handleGlobalKeydown} onpointerdown={handlePointerDown} />

<div class="kebab-menu">
  <button
    bind:this={triggerEl}
    class="kebab-trigger"
    aria-haspopup="true"
    aria-expanded={open}
    aria-label={triggerLabel}
    title={triggerLabel}
    onclick={toggle}
    type="button"
  >
    ⋯
  </button>

  {#if open}
    <div
      bind:this={panelEl}
      class="kebab-panel"
      role="menu"
      tabindex="-1"
      onkeydown={handleMenuKeydown}
    >
      {#each groups as group, gi}
        {#if gi > 0}
          <div class="kebab-divider" role="separator"></div>
        {/if}
        {#if group.label}
          <div class="kebab-group-label" role="presentation">{group.label}</div>
        {/if}
        {#each group.items as item}
          {#if !item.hidden}
            {#if item.type === 'link'}
              <a
                class="kebab-item"
                class:danger={item.danger}
                href={item.href}
                target={item.target}
                rel={item.rel}
                download={item.download}
                role="menuitem"
                tabindex="-1"
                onclick={closeMenu}
              >{item.label}</a>
            {:else if item.type === 'text'}
              <div class="kebab-text" role="presentation">{item.value}</div>
            {:else}
              <button
                class="kebab-item"
                class:danger={item.danger}
                disabled={item.disabled}
                aria-disabled={item.disabled ? 'true' : undefined}
                role="menuitem"
                tabindex="-1"
                type="button"
                onclick={() => handleItemClick(item)}
              >{item.label}</button>
            {/if}
          {/if}
        {/each}
      {/each}
    </div>
  {/if}
</div>

<style>
  .kebab-menu {
    position: relative;
    display: inline-flex;
    align-items: center;
  }

  .kebab-trigger {
    background: none;
    border: 1.5px solid var(--border-default);
    color: var(--text-secondary);
    padding: 0.35rem 0.65rem;
    border-radius: 4px;
    cursor: pointer;
    font-size: 1rem;
    font-family: var(--font-sans);
    line-height: 1;
    letter-spacing: 0.05em;
    transition: background 0.12s, border-color 0.12s, color 0.12s;
    min-width: var(--tap-min);
    min-height: var(--tap-min);
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .kebab-trigger:hover {
    background: var(--surface-raised);
    border-color: var(--border-strong);
    color: var(--text-primary);
  }

  .kebab-trigger[aria-expanded="true"] {
    background: var(--surface-raised);
    border-color: var(--border-strong);
    color: var(--text-primary);
  }

  .kebab-panel {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    min-width: 200px;
    background: var(--surface-overlay);
    border: 1px solid var(--border-default);
    border-radius: 6px;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.12);
    z-index: 800;
    padding: 0.3rem 0;
    display: flex;
    flex-direction: column;
    outline: none;
  }

  .kebab-divider {
    height: 1px;
    background: var(--border-subtle);
    margin: 0.3rem 0;
  }

  .kebab-group-label {
    font-size: 0.6rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-tertiary);
    padding: 0.45rem 0.85rem 0.2rem;
    pointer-events: none;
  }

  .kebab-item {
    display: block;
    width: 100%;
    padding: 0.45rem 0.85rem;
    text-align: left;
    font-family: var(--font-sans);
    font-size: 0.84rem;
    font-weight: 500;
    color: var(--text-primary);
    background: none;
    border: none;
    cursor: pointer;
    text-decoration: none;
    line-height: 1.4;
    transition: background 0.1s, color 0.1s;
  }

  .kebab-item:hover:not(:disabled) {
    background: var(--surface-raised);
    color: var(--text-primary);
  }

  .kebab-item:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .kebab-item.danger {
    color: var(--state-danger);
  }

  .kebab-item.danger:hover:not(:disabled) {
    background: var(--state-danger-surface);
    color: var(--state-danger);
  }

  .kebab-text {
    padding: 0.3rem 0.85rem;
    font-size: 0.75rem;
    color: var(--text-tertiary);
    word-break: break-all;
    line-height: 1.4;
    font-family: var(--font-mono);
  }

  /* Touch: bump every menu item to the 44px tap floor. The desktop
     density (0.45rem vertical) reads at ~32px on a phone — under spec
     and easy to mis-tap. Group labels stay tight; they're presentational. */
  @media (pointer: coarse) {
    .kebab-item {
      min-height: var(--tap-min);
      display: flex;
      align-items: center;
      padding-top: 0.65rem;
      padding-bottom: 0.65rem;
    }
  }
</style>

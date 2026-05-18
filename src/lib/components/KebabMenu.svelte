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

  /** @typedef {{ label: string, items: import('./KebabMenu.svelte').MenuItem[] }} MenuGroup */

  let { groups = [] } = $props();

  let open = $state(false);
  let triggerEl = $state(null);
  let panelEl = $state(null);

  function toggle() {
    open = !open;
  }

  function close() {
    open = false;
  }

  function handleItemClick(item) {
    if (item.onclick) item.onclick();
    close();
  }

  function handleKeydown(e) {
    if (e.key === 'Escape') close();
  }

  function handlePointerDown(e) {
    if (!open) return;
    if (triggerEl && triggerEl.contains(e.target)) return;
    if (panelEl && panelEl.contains(e.target)) return;
    close();
  }
</script>

<svelte:window onkeydown={handleKeydown} onpointerdown={handlePointerDown} />

<div class="kebab-menu">
  <button
    bind:this={triggerEl}
    class="kebab-trigger"
    aria-haspopup="true"
    aria-expanded={open}
    aria-label="More actions"
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
                role="menuitem"
                onclick={close}
              >{item.label}</a>
            {:else if item.type === 'text'}
              <div class="kebab-text" role="presentation">{item.value}</div>
            {:else}
              <button
                class="kebab-item"
                class:danger={item.danger}
                disabled={item.disabled}
                role="menuitem"
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
    left: 0;
    min-width: 200px;
    background: var(--surface-overlay);
    border: 1px solid var(--border-default);
    border-radius: 6px;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.12);
    z-index: 800;
    padding: 0.3rem 0;
    display: flex;
    flex-direction: column;
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
</style>

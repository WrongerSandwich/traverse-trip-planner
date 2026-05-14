<script>
  // Render a row of recovery-affordance buttons. Shared by every archetype.
  //
  // Each affordance fires a single named callback:
  //   onretry, onswitchprovider, onedit, ondismiss, onopenfile
  // Plus a catch-all `onaffordance(name)` so callers can listen once and
  // dispatch themselves if preferred.
  //
  // `size` controls compact-vs-default sizing — Instant Inline uses 'sm';
  // banners/toasts use 'md'.

  let {
    affordances = [],
    size = 'md',
    onretry,
    onswitchprovider,
    onedit,
    ondismiss,
    onopenfile,
    onaffordance,
  } = $props();

  const LABELS = {
    retry: 'Retry',
    switch_provider: 'Switch provider',
    edit: 'Edit',
    dismiss: 'Dismiss',
    open_file: 'Open file',
  };

  function handle(affordance) {
    onaffordance?.(affordance);
    if (affordance === 'retry') onretry?.();
    else if (affordance === 'switch_provider') onswitchprovider?.();
    else if (affordance === 'edit') onedit?.();
    else if (affordance === 'dismiss') ondismiss?.();
    else if (affordance === 'open_file') onopenfile?.();
  }
</script>

{#if affordances.length > 0}
  <div class="affordances" class:sm={size === 'sm'} role="group" aria-label="Recovery actions">
    {#each affordances as affordance (affordance)}
      <button
        type="button"
        class="affordance-btn"
        class:primary={affordance === 'retry'}
        data-affordance={affordance}
        onclick={() => handle(affordance)}
      >
        {LABELS[affordance] ?? affordance}
      </button>
    {/each}
  </div>
{/if}

<style>
  .affordances {
    display: flex;
    gap: 0.4rem;
    flex-wrap: wrap;
  }

  .affordance-btn {
    background: var(--surface-raised);
    border: 1px solid var(--bone-400);
    color: var(--text-primary);
    font-family: var(--font-sans);
    font-size: 0.78rem;
    font-weight: 600;
    line-height: 1;
    padding: 0.4rem 0.7rem;
    border-radius: 4px;
    cursor: pointer;
    transition: background 0.12s, border-color 0.12s, color 0.12s;
  }
  .affordance-btn:hover {
    background: var(--bone-100);
    border-color: var(--bark-600);
  }
  .affordance-btn.primary {
    background: var(--forest-600);
    border-color: var(--forest-800);
    color: var(--text-inverse, #fff);
  }
  .affordance-btn.primary:hover {
    background: var(--forest-800);
  }

  .sm .affordance-btn {
    font-size: 0.72rem;
    padding: 0.3rem 0.55rem;
  }
</style>

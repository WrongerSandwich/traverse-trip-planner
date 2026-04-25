<script>
  let { messages = [], running = false, done = false, onclose } = $props();

  const isError = $derived(messages.some(m => m.toLowerCase().startsWith('error')));
</script>

<div class="panel" class:done class:is-error={isError}>
  <div class="panel-header">
    <span class="panel-title">
      {#if done && !isError}Atlas{:else if isError}Error{:else}Working…{/if}
    </span>
    {#if done}
      <button class="close-btn" onclick={onclose} aria-label="Close">✕</button>
    {/if}
  </div>

  <div class="log">
    {#each messages as msg}
      <div class="log-line" class:is-error-line={msg.toLowerCase().startsWith('error')}>
        {msg}
      </div>
    {/each}
    {#if running}
      <div class="spinner-row">
        <span class="spinner"></span>
        <span class="spinner-label">Working…</span>
      </div>
    {/if}
  </div>
</div>

<style>
  .panel {
    position: fixed;
    bottom: 1.5rem;
    right: 1.5rem;
    width: 360px;
    background: var(--header-bg);
    color: var(--header-text);
    border-radius: 8px;
    box-shadow: 0 8px 32px oklch(0% 0 0 / 0.3);
    z-index: 1000;
    overflow: hidden;
    font-size: 0.82rem;
    font-family: var(--font);
  }
  .panel.done     { box-shadow: 0 8px 32px oklch(36% 0.12 155 / 0.4); }
  .panel.is-error { box-shadow: 0 8px 32px oklch(50% 0.15 25 / 0.35); }

  .panel-header {
    padding: 0.75rem 1rem;
    display: flex; align-items: center; justify-content: space-between;
    border-bottom: 1px solid oklch(30% 0.025 155);
  }
  .panel-title {
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: oklch(62% 0.022 155);
  }

  .close-btn {
    background: none; border: none;
    color: oklch(55% 0.018 155);
    cursor: pointer; font-size: 0.9rem;
    padding: 0.1rem 0.2rem;
    transition: color 0.12s;
  }
  .close-btn:hover { color: var(--header-text); }

  .log {
    padding: 0.75rem 1rem;
    display: flex; flex-direction: column; gap: 0.3rem;
    max-height: 220px; overflow-y: auto;
  }

  .log-line { color: oklch(80% 0.012 80); line-height: 1.5; }
  .log-line.is-error-line { color: oklch(72% 0.15 25); }

  .spinner-row {
    display: flex; align-items: center; gap: 0.5rem;
    margin-top: 0.25rem; color: oklch(50% 0.02 155);
  }
  .spinner-label { font-size: 0.74rem; }

  @keyframes spin { to { transform: rotate(360deg); } }
  .spinner {
    width: 12px; height: 12px;
    border: 1.5px solid oklch(35% 0.025 155);
    border-top-color: oklch(58% 0.08 155);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    flex-shrink: 0;
  }
</style>

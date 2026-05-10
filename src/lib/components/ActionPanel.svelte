<script>
  let { messages = [], running = false, done = false, onclose, oncancel = null } = $props();

  const isError = $derived(messages.some(m => m.toLowerCase().startsWith('error')));
</script>

<div class="panel" class:done class:is-error={isError}>
  <div class="panel-header">
    <span class="panel-title">
      {#if done && !isError}Done{:else if isError}Something went wrong{:else}Working…{/if}
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
        {#if oncancel}
          <button class="cancel-btn" onclick={oncancel} type="button">Cancel</button>
        {/if}
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
    background: var(--surface-invert);
    color: var(--text-inverse);
    border-radius: 8px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
    z-index: 1000;
    overflow: hidden;
    font-size: 0.82rem;
    font-family: var(--font-sans);
  }
  .panel.done     { box-shadow: 0 8px 32px rgba(45, 88, 64, 0.4); }
  .panel.is-error { box-shadow: 0 8px 32px rgba(168, 47, 31, 0.35); }

  .panel-header {
    padding: 0.75rem 1rem;
    display: flex; align-items: center; justify-content: space-between;
    border-bottom: 1px solid var(--forest-800);
  }
  .panel-title {
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--bone-600);
  }

  .close-btn {
    background: none; border: none;
    color: var(--bone-600);
    cursor: pointer; font-size: 0.9rem;
    padding: 0.1rem 0.2rem;
    transition: color 0.12s;
  }
  .close-btn:hover { color: var(--text-inverse); }

  .log {
    padding: 0.75rem 1rem;
    display: flex; flex-direction: column; gap: 0.3rem;
    max-height: 220px; overflow-y: auto;
  }

  .log-line { color: var(--bone-400); line-height: 1.5; }
  .log-line.is-error-line { color: var(--embers-600); }

  .spinner-row {
    display: flex; align-items: center; gap: 0.5rem;
    margin-top: 0.25rem; color: var(--forest-600);
  }
  .spinner-label { font-size: 0.74rem; flex: 1; }

  .cancel-btn {
    background: none;
    border: 1px solid var(--forest-800);
    color: var(--bone-400);
    cursor: pointer;
    font-size: 0.7rem;
    font-weight: 600;
    line-height: 1;
    padding: 0.3rem 0.6rem;
    border-radius: 3px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    transition: color 0.12s, border-color 0.12s;
  }
  .cancel-btn:hover { color: var(--text-inverse); border-color: var(--forest-600); }

  @media (max-width: 768px) {
    .panel {
      bottom: 0; right: 0; left: 0;
      width: 100%;
      border-radius: 10px 10px 0 0;
    }
  }

  @keyframes spin { to { transform: rotate(360deg); } }
  .spinner {
    width: 12px; height: 12px;
    border: 1.5px solid var(--forest-800);
    border-top-color: var(--forest-400);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    flex-shrink: 0;
  }
</style>

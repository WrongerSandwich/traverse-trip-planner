<script>
  // In-Page Stream envelope (docs/ai-workflow-ux.md §2.2).
  //
  // Rendered as a top-of-section banner above the streamed content. While
  // in-progress: amber accent, title + estimated time + Cancel button.
  // Success: green ("✓ Trip locked · 12.4k tokens"). Failure: red with the
  // registry sentence + recovery affordances. Cancelled: quieter "Dismiss"
  // envelope.
  //
  // Usage:
  //   <StreamBanner
  //     state={state}
  //     title="Locking trip…"
  //     successTitle="Trip locked"
  //     tokens={usage?.totalTokens}
  //     estimateRemaining="~20s"
  //     errorCode={errorCode}
  //     errorContext={errorContext}
  //     oncancel={() => abort()}
  //     onretry={() => start()}
  //   />

  import { resolveStatus, formatTokens } from './core.js';
  import AffordanceButtons from './AffordanceButtons.svelte';

  let {
    state = 'in_progress',
    title = '',
    successTitle = null,
    sentence = null,
    errorCode = null,
    errorContext = null,
    affordances = null,
    tokens = null,
    estimateRemaining = null,
    oncancel,
    onretry,
    onswitchprovider,
    onedit,
    ondismiss,
    onopenfile,
    onaffordance,
  } = $props();

  const status = $derived(
    resolveStatus({
      state,
      sentence,
      code: state === 'failure' || state === 'cancelled' ? errorCode : null,
      context: errorContext,
      affordances: affordances ?? undefined,
    }),
  );

  const tokenLabel = $derived(formatTokens(tokens));

  const displayTitle = $derived.by(() => {
    if (state === 'success') return successTitle ?? title;
    if (state === 'failure') return status.sentence;
    if (state === 'cancelled') return status.sentence;
    return title;
  });
</script>

<div class="banner" data-state={state} data-tone={status.tone} role="status" aria-live="polite">
  <div class="banner-main">
    <div class="banner-text">
      <span class="banner-icon" aria-hidden="true">
        {#if state === 'in_progress'}
          <span class="spinner"></span>
        {:else if state === 'success'}
          ✓
        {:else if state === 'failure'}
          ✕
        {:else if state === 'cancelled'}
          ⊘
        {/if}
      </span>
      <span class="banner-title">{displayTitle}</span>
      {#if state === 'in_progress' && estimateRemaining}
        <span class="banner-meta">{estimateRemaining}</span>
      {/if}
      {#if state === 'success' && tokenLabel}
        <span class="banner-meta">· {tokenLabel}</span>
      {/if}
    </div>

    {#if state === 'in_progress' && oncancel}
      <button type="button" class="cancel-btn" onclick={oncancel}>Cancel</button>
    {/if}
  </div>

  {#if state === 'failure' || state === 'cancelled'}
    <div class="banner-affordances">
      <AffordanceButtons
        affordances={status.affordances}
        size="md"
        {onretry}
        {onswitchprovider}
        {onedit}
        {ondismiss}
        {onopenfile}
        {onaffordance}
      />
    </div>
  {/if}
</div>

<style>
  .banner {
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
    padding: 0.7rem 0.9rem;
    border-radius: 6px;
    border: 1px solid var(--bone-400);
    background: var(--surface-raised);
    font-family: var(--font-sans);
  }
  .banner[data-tone="progress"] {
    border-left: 4px solid var(--sunset-600);
    background: var(--sunset-50, #fff8f0);
  }
  .banner[data-tone="success"] {
    border-left: 4px solid var(--forest-600);
    background: var(--forest-50, #f0f8f2);
  }
  .banner[data-tone="failure"] {
    border-left: 4px solid var(--embers-600);
    background: var(--sunset-50, #fff4ed);
  }
  .banner[data-tone="cancelled"] {
    border-left: 4px solid var(--bark-600);
    background: var(--bone-100);
  }

  .banner-main {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    justify-content: space-between;
  }
  .banner-text {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex: 1;
    min-width: 0;
  }
  .banner-title {
    font-size: 0.88rem;
    font-weight: 600;
    color: var(--text-primary);
    line-height: 1.4;
  }
  .banner-meta {
    font-size: 0.78rem;
    color: var(--text-secondary);
    font-weight: 500;
  }
  .banner-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1rem;
    height: 1rem;
    font-size: 0.9rem;
    flex-shrink: 0;
  }
  .banner[data-tone="success"] .banner-icon { color: var(--forest-600); }
  .banner[data-tone="failure"] .banner-icon { color: var(--embers-600); }
  .banner[data-tone="cancelled"] .banner-icon { color: var(--bark-600); }

  .cancel-btn {
    background: var(--surface-raised);
    border: 1px solid var(--bark-600);
    color: var(--text-primary);
    font-family: var(--font-sans);
    font-size: 0.75rem;
    font-weight: 600;
    padding: 0.35rem 0.6rem;
    border-radius: 4px;
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
  }
  .cancel-btn:hover { background: var(--bone-100); }

  @keyframes spin { to { transform: rotate(360deg); } }
  .spinner {
    width: 12px; height: 12px;
    border: 1.5px solid var(--bone-400);
    border-top-color: var(--sunset-600);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    display: inline-block;
  }
</style>

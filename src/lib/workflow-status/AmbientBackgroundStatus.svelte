<script>
  // Ambient Background envelope (docs/ai-workflow-ux.md §2.3).
  //
  // This component renders the *content* of one of the three Ambient
  // surfaces:
  //   - layout="badge"  → per-trip badge text ("Preparing brochure…")
  //   - layout="toast"  → success/failure toast body for the global toast surface
  //   - layout="row"    → jobs-drawer row body
  //
  // It does NOT own positioning or the toast/drawer chrome itself — those
  // belong to issues #74 (global indicator) and #75 (per-trip badge). This
  // component is the shared content primitive both surfaces compose.
  //
  // The global indicator (#74) renders this with layout="toast" or
  // layout="row"; the per-trip badge (#75) renders this with layout="badge".

  import { resolveStatus, formatTokens } from './core.js';
  import AffordanceButtons from './AffordanceButtons.svelte';

  let {
    state = 'in_progress',
    layout = 'badge',
    title = '',
    sentence = null,
    errorCode = null,
    errorContext = null,
    affordances = null,
    tokens = null,
    elapsedLabel = null,
    estimateRemaining = null,
    onopen,
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

  const showAffordances = $derived(
    (state === 'failure' || state === 'cancelled') && (layout === 'toast' || layout === 'row'),
  );

  const showOpen = $derived(state === 'success' && layout === 'toast' && !!onopen);
</script>

<div class="ambient" data-state={state} data-tone={status.tone} data-layout={layout}>
  <div class="ambient-main">
    <span class="ambient-icon" aria-hidden="true">
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

    <div class="ambient-body">
      {#if title}
        <span class="ambient-title">{title}</span>
      {/if}
      {#if status.sentence && (state === 'failure' || state === 'cancelled' || (state !== 'in_progress' && !title))}
        <span class="ambient-sentence">{status.sentence}</span>
      {/if}
      {#if state === 'in_progress' && (elapsedLabel || estimateRemaining)}
        <span class="ambient-meta">
          {#if elapsedLabel}{elapsedLabel}{/if}
          {#if elapsedLabel && estimateRemaining} · {/if}
          {#if estimateRemaining}{estimateRemaining}{/if}
        </span>
      {/if}
      {#if state === 'success' && tokenLabel}
        <span class="ambient-meta">{tokenLabel}</span>
      {/if}
    </div>

    {#if state === 'in_progress' && layout === 'row' && oncancel}
      <button type="button" class="row-cancel" onclick={oncancel}>Cancel</button>
    {/if}

    {#if showOpen}
      <button type="button" class="row-open" onclick={onopen}>Open</button>
    {/if}
  </div>

  {#if showAffordances}
    <div class="ambient-affordances">
      <AffordanceButtons
        affordances={status.affordances}
        size="sm"
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
  .ambient {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    font-family: var(--font-sans);
    color: var(--text-primary);
  }

  .ambient[data-layout="badge"] {
    font-size: 0.74rem;
    color: var(--text-secondary);
  }
  /* Tone is conveyed by the icon color + a tone-tinted full border, not by
     a side stripe (banned per the shared design laws as a colored accent
     greater than 1px). */
  .ambient[data-layout="toast"] {
    padding: 0.6rem 0.8rem;
    background: var(--surface-overlay);
    border-radius: 6px;
    border: 1px solid var(--border-default);
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.18);
    min-width: 16rem;
    max-width: 24rem;
  }
  .ambient[data-layout="toast"][data-tone="success"]   { border-color: color-mix(in oklab, var(--state-success) 45%, var(--border-default)); }
  .ambient[data-layout="toast"][data-tone="failure"]   { border-color: color-mix(in oklab, var(--state-danger) 45%, var(--border-default)); }
  .ambient[data-layout="toast"][data-tone="cancelled"] { border-color: var(--border-strong); }

  .ambient[data-layout="row"] {
    padding: 0.6rem 0.7rem;
    border-bottom: 1px solid var(--border-subtle);
  }

  .ambient-main {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .ambient-body {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    flex: 1;
    min-width: 0;
  }
  .ambient-title {
    font-size: 0.82rem;
    font-weight: 600;
    line-height: 1.3;
  }
  .ambient-sentence {
    font-size: 0.78rem;
    color: var(--text-secondary);
    line-height: 1.35;
  }
  .ambient-meta {
    font-size: 0.72rem;
    color: var(--text-secondary);
  }

  .ambient[data-layout="badge"] .ambient-icon { font-size: 0.78rem; }
  .ambient[data-layout="badge"] .ambient-title { font-size: 0.74rem; font-weight: 500; }
  .ambient[data-layout="badge"] .ambient-body { flex-direction: row; gap: 0.3rem; }

  .ambient-icon { flex-shrink: 0; display: inline-flex; align-items: center; }
  .ambient[data-tone="success"]   .ambient-icon { color: var(--state-success); }
  .ambient[data-tone="failure"]   .ambient-icon { color: var(--state-danger); }
  .ambient[data-tone="cancelled"] .ambient-icon { color: var(--text-tertiary); }

  .row-cancel, .row-open {
    background: var(--surface-raised);
    border: 1px solid var(--border-default);
    color: var(--text-primary);
    font-family: var(--font-sans);
    font-size: 0.72rem;
    font-weight: 600;
    padding: 0.3rem 0.55rem;
    border-radius: 3px;
    cursor: pointer;
    transition: background 0.12s;
  }
  .row-cancel:hover, .row-open:hover { background: var(--surface-sunken); }
  .row-open {
    background: var(--surface-invert);
    color: var(--text-inverse);
    border-color: var(--border-default);
  }
  .row-open:hover { background: var(--surface-raised); }

  @keyframes spin { to { transform: rotate(360deg); } }
  .spinner {
    width: 10px; height: 10px;
    border: 1.5px solid var(--border-default);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    display: inline-block;
  }
</style>

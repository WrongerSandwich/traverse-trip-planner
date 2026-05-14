<script>
  // Conversational / Modal envelope (docs/ai-workflow-ux.md §2.4).
  //
  // A per-step envelope rendered inside a wizard modal. Each step has its
  // own loading state — the step shows a spinner while a model call is
  // happening. Failure renders an inline error envelope with affordances;
  // standard recovery is "retry this step" or "close the modal".
  //
  // Usage:
  //   <ConversationalStatus
  //     state={state}
  //     stepLabel="Question 3 of 5"
  //     progressLabel="Generating follow-up…"
  //     errorCode={errorCode}
  //     errorContext={errorContext}
  //     onretry={() => regenerate()}
  //     ondismiss={() => closeModal()}
  //   />

  import { resolveStatus, formatTokens } from './core.js';
  import AffordanceButtons from './AffordanceButtons.svelte';

  let {
    state = 'idle',
    stepLabel = null,
    progressLabel = 'Thinking…',
    successLabel = null,
    sentence = null,
    errorCode = null,
    errorContext = null,
    affordances = null,
    tokens = null,
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
</script>

<div class="conv" data-state={state} data-tone={status.tone}>
  {#if stepLabel}
    <p class="step-label">{stepLabel}</p>
  {/if}

  {#if state === 'in_progress'}
    <div class="row">
      <span class="spinner" aria-hidden="true"></span>
      <span class="text">{progressLabel}</span>
    </div>
  {:else if state === 'success'}
    <div class="row">
      <span class="icon success" aria-hidden="true">✓</span>
      <span class="text">{successLabel ?? sentence ?? 'Done.'}</span>
      {#if tokenLabel}
        <span class="meta">· {tokenLabel}</span>
      {/if}
    </div>
  {:else if state === 'failure' || state === 'cancelled'}
    <div class="error" role="alert">
      <div class="row">
        <span class="icon failure" aria-hidden="true">{state === 'failure' ? '✕' : '⊘'}</span>
        <span class="text">{status.sentence}</span>
      </div>
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
  .conv {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    font-family: var(--font-sans);
  }

  .step-label {
    margin: 0;
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-secondary);
  }

  .row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.88rem;
    color: var(--text-primary);
  }
  .text { line-height: 1.4; }
  .meta {
    font-size: 0.78rem;
    color: var(--text-secondary);
  }

  .icon { flex-shrink: 0; display: inline-flex; align-items: center; }
  .icon.success { color: var(--forest-600); }
  .icon.failure { color: var(--embers-600); }

  .error {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.7rem 0.9rem;
    background: var(--sunset-50, #fff4ed);
    border: 1px solid var(--embers-600);
    border-left-width: 4px;
    border-radius: 4px;
  }

  @keyframes spin { to { transform: rotate(360deg); } }
  .spinner {
    width: 12px; height: 12px;
    border: 1.5px solid var(--bone-400);
    border-top-color: var(--forest-600);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    display: inline-block;
    flex-shrink: 0;
  }
</style>

<script>
  // Instant Inline envelope (docs/ai-workflow-ux.md §2.1).
  //
  // The trigger button IS the spinner. While in-progress the button is
  // disabled and shows the verb's -ing form. Success is signaled by the
  // parent (toast + result swap), so this component just clears.
  // Failure renders an inline error envelope BELOW the button with the
  // registry-resolved sentence + recovery affordance buttons.
  //
  // Usage:
  //   <InstantInlineStatus
  //     state={state}
  //     idleLabel="Generate ideas"
  //     progressLabel="Generating ideas…"
  //     errorCode={errorCode}
  //     errorContext={errorContext}
  //     onclick={() => start()}
  //     onretry={() => start()}
  //     ondismiss={() => state = 'idle'}
  //   />

  import { resolveStatus, formatTokens } from './core.js';
  import AffordanceButtons from './AffordanceButtons.svelte';

  let {
    state = 'idle',
    idleLabel = 'Run',
    progressLabel = null,
    successLabel = null,
    sentence = null,
    errorCode = null,
    errorContext = null,
    affordances = null,
    tokens = null,
    disabled = false,
    onclick,
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

  const isBusy = $derived(state === 'in_progress');
  const buttonLabel = $derived(
    isBusy ? progressLabel || `${idleLabel}…` : state === 'success' && successLabel ? successLabel : idleLabel,
  );
</script>

<div class="instant-inline" data-state={state}>
  <button
    type="button"
    class="trigger"
    class:is-busy={isBusy}
    class:is-success={state === 'success'}
    class:is-failure={state === 'failure'}
    disabled={isBusy || disabled}
    aria-busy={isBusy}
    onclick={onclick}
  >
    {#if isBusy}
      <span class="spinner" aria-hidden="true"></span>
    {/if}
    <span class="label">{buttonLabel}</span>
    {#if state === 'success' && tokenLabel}
      <span class="tokens">· {tokenLabel}</span>
    {/if}
  </button>

  {#if state === 'failure' || state === 'cancelled'}
    <div class="error" role="alert" data-tone={status.tone}>
      <p class="sentence">{status.sentence}</p>
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
  .instant-inline {
    display: inline-flex;
    flex-direction: column;
    gap: 0.5rem;
    align-items: flex-start;
  }

  .trigger {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    background: var(--surface-invert);
    color: var(--text-inverse);
    border: 1px solid var(--border-strong);
    border-radius: 4px;
    padding: 0.5rem 0.9rem;
    font-family: var(--font-sans);
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.12s, opacity 0.12s;
  }
  .trigger:hover:not(:disabled) { background: var(--surface-raised); color: var(--text-primary); }
  .trigger:disabled { cursor: not-allowed; opacity: 0.7; }
  .trigger.is-busy { opacity: 0.8; }
  .trigger.is-failure { background: var(--state-danger-surface); color: var(--state-danger); border-color: var(--state-danger); }

  .label { line-height: 1; }
  .tokens {
    font-weight: 500;
    opacity: 0.8;
    font-size: 0.78rem;
  }

  .error {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    padding: 0.55rem 0.7rem;
    background: var(--state-danger-surface);
    border: 1px solid var(--state-danger);
    border-radius: 4px;
    max-width: 28rem;
  }
  .sentence {
    margin: 0;
    font-size: 0.82rem;
    color: var(--text-primary);
    line-height: 1.4;
  }

  @keyframes spin { to { transform: rotate(360deg); } }
  .spinner {
    width: 12px; height: 12px;
    border: 1.5px solid rgba(255, 255, 255, 0.35);
    border-top-color: var(--text-inverse, #fff);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    flex-shrink: 0;
  }
</style>

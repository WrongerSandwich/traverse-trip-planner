<script>
  import PromiseBody from './PromiseBody.svelte';
  import { focusTrap } from '$lib/actions/focusTrap.js';

  let {
    open = $bindable(false),
    title = '',
    body = '',
    promise = null,
    confirmLabel = 'Confirm',
    danger = false,
    onconfirm,
    oncancel,
  } = $props();

  let confirmBtn = $state(null);
  let cancelBtn  = $state(null);

  // Focus + Escape behavior come from src/lib/actions/focusTrap.js (#280).
  // Initial focus lands on Cancel for danger dialogs to prevent accidental
  // Enter-to-confirm; on Confirm otherwise. Focus restores to the trigger
  // element on destroy.

  function confirm() {
    open = false;
    onconfirm?.();
  }

  function cancel() {
    open = false;
    oncancel?.();
  }
</script>

{#if open}
  <div
    class="backdrop"
    onclick={!danger ? cancel : undefined}
    role="presentation"
  ></div>

  <div
    class="modal"
    role="dialog"
    aria-modal="true"
    aria-labelledby="confirm-title"
    aria-describedby={body || promise ? 'confirm-body' : undefined}
    use:focusTrap={{ initial: danger ? cancelBtn : confirmBtn, onEscape: cancel }}
  >
    <div class="modal-body">
      <h2 id="confirm-title" class="modal-title" class:danger>{title}</h2>
      {#if body}
        <p class="modal-desc" id="confirm-body">{body}</p>
      {/if}
      {#if promise}
        <div class="promise-wrap" id={!body ? 'confirm-body' : undefined}>
          <PromiseBody {promise} />
        </div>
      {/if}
    </div>
    <div class="modal-actions">
      <button class="btn btn-tertiary" bind:this={cancelBtn} onclick={cancel}>Cancel</button>
      <button
        class="btn"
        class:btn-danger={danger}
        class:btn-primary={!danger}
        bind:this={confirmBtn}
        onclick={confirm}
      >{confirmLabel}</button>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed; inset: 0;
    background: rgba(0, 0, 0, 0.45);
    z-index: 998;
  }

  .modal {
    position: fixed;
    top: 50%; left: 50%;
    transform: translate(-50%, -50%);
    width: min(420px, calc(100vw - 2rem));
    background: var(--surface-overlay);
    color: var(--text-primary);
    border-radius: 10px;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.35);
    z-index: 999;
    overflow: hidden;
    font-family: var(--font-sans);
  }

  .modal-body {
    padding: 1.4rem 1.4rem 0.9rem;
  }

  .modal-title {
    font-family: var(--font-serif);
    font-size: 1.1rem;
    font-weight: 500;
    margin: 0 0 0.35rem;
    color: var(--text-primary);
    line-height: 1.3;
  }
  .modal-title.danger { color: var(--state-danger); }

  .modal-desc {
    font-size: 0.87rem;
    color: var(--text-secondary);
    margin: 0;
    line-height: 1.55;
  }

  .promise-wrap {
    margin-top: 0.5rem;
  }

  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.6rem;
    padding: 0.75rem 1.4rem 1.1rem;
  }
</style>

<script>
  import PromiseBody from './PromiseBody.svelte';

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
  let previousFocus = null;

  // Focus management: capture trigger element on open, restore on close.
  // For danger dialogs, default focus lands on Cancel to prevent accidental
  // Enter-to-confirm on destructive actions.
  $effect(() => {
    if (open) {
      previousFocus = document.activeElement;
      (danger ? cancelBtn : confirmBtn)?.focus();
    } else if (previousFocus) {
      previousFocus.focus();
      previousFocus = null;
    }
  });

  function handleKey(e) {
    if (!open) return;
    if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    if (e.key === 'Tab') {
      const modal = (confirmBtn ?? cancelBtn)?.closest('[role="dialog"]');
      if (!modal) return;
      const focusable = [...modal.querySelectorAll('button:not(:disabled)')];
      if (focusable.length < 2) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    }
  }

  function confirm() {
    open = false;
    onconfirm?.();
  }

  function cancel() {
    open = false;
    oncancel?.();
  }
</script>

<svelte:window onkeydown={handleKey} />

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
    aria-describedby={body ? 'confirm-body' : undefined}
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
    background: var(--surface-raised);
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
    color: var(--forest-800);
    line-height: 1.3;
  }
  .modal-title.danger { color: var(--sunset-800); }

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

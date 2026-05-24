<script>
  // Bottom-sticky toast surfaced when a destructive-but-reversible
  // gesture fires (hide candidate, remove stop from day). Forest-800
  // pill with bone-100 text and an Undo affordance. Lives ~5s by
  // convention; the parent owns the timer and decides when to clear
  // `open`. We're a presentational component: render the message,
  // route the click handlers, no internal state.
  //
  // Extracted from PlanSection + CandidatesSection so the two sections
  // can't drift visually. Previous duplication: ~40 lines of CSS each.

  let {
    open = false,
    message = '',
    undoLabel = 'Undo',
    onUndo = () => {},
    onDismiss = () => {},
  } = $props();
</script>

{#if open}
  <div class="hide-toast" role="status" aria-live="polite">
    <span class="toast-message">{message}</span>
    <button type="button" class="toast-undo" onclick={onUndo}>{undoLabel}</button>
    <button type="button" class="toast-dismiss" onclick={onDismiss} aria-label="Dismiss">×</button>
  </div>
{/if}

<style>
  .hide-toast {
    position: sticky;
    bottom: 1rem;
    z-index: 30;
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0.85rem auto 0;
    width: max-content;
    max-width: 100%;
    background: var(--forest-800);
    color: var(--bone-100);
    border: 1px solid color-mix(in oklab, var(--bone-50) 20%, transparent);
    border-radius: 999px;
    padding: 0.4rem 0.6rem 0.4rem 0.85rem;
    font-family: var(--font-sans);
    font-size: 0.82rem;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
  }
  .toast-message { line-height: 1.4; }
  .toast-undo {
    background: transparent;
    border: 1px solid color-mix(in oklab, var(--bone-50) 30%, transparent);
    color: var(--bone-50);
    font-family: var(--font-sans);
    font-size: 0.78rem;
    font-weight: 600;
    padding: 0.18rem 0.55rem;
    border-radius: 999px;
    cursor: pointer;
    transition: background-color 0.12s;
  }
  .toast-undo:hover { background: color-mix(in oklab, var(--bone-50) 12%, transparent); }
  .toast-dismiss {
    background: transparent;
    border: none;
    color: color-mix(in oklab, var(--bone-50) 70%, transparent);
    font-size: 1rem;
    line-height: 1;
    padding: 0 0.15rem;
    cursor: pointer;
  }
  .toast-dismiss:hover { color: var(--bone-50); }
</style>

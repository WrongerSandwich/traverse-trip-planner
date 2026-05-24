<script>
  /**
   * FieldGuidePalette — Cmd-K command palette for AI-assisted trip edits.
   *
   * Replaces the slide-out chat panel: a centered floating bar where the user
   * describes an edit; the model's response renders as an in-section diff
   * overlay (rendered by the caller via separate components), not inside the
   * palette itself.
   *
   * This component is the UI surface only — the caller wires the send loop,
   * the in-section diff rendering, and the snapshot/revert plumbing.
   *
   * Props:
   *   - open: bool — controls visibility (caller toggles, palette respects).
   *   - scope: { kind: 'trip' } | { kind: 'section', section: string }
   *   - sectionLabel: string — display label for the scope chip when scoped.
   *   - assistantName: string — for placeholder + a11y.
   *   - busy: bool — request in flight; show spinner + Cancel.
   *   - blockedReason: string | null — when set, replaces the input with the
   *       reason copy (e.g., concurrent deepen-section job running).
   *   - errorSentence: string | null — typed failure surface inside the palette.
   *   - lastReply: string | null — most recent assistant turn (conversational
   *       fallback when the model returns a <reply> with no <update> blocks).
   *       Rendered in italic-serif below the input so the user can Refine or
   *       Esc out.
   *   - onsubmit(value): void — caller handles the send.
   *   - oncancel(): void — caller aborts the in-flight request.
   *   - onclose(): void — Esc / click-outside / explicit close.
   *   - onwidenscope(): void — clicked the scope chip while section-scoped.
   *
   * Keyboard:
   *   - Enter submits.
   *   - Esc closes (or cancels if busy — caller decides).
   */

  import { tick } from 'svelte';
  import { focusTrap } from '$lib/actions/focusTrap.js';

  /** @type {{
   *   open: boolean,
   *   scope: { kind: 'trip' } | { kind: 'section', section: string },
   *   sectionLabel?: string,
   *   assistantName: string,
   *   busy?: boolean,
   *   blockedReason?: string | null,
   *   errorSentence?: string | null,
   *   lastReply?: string | null,
   *   onsubmit: (value: string) => void,
   *   oncancel?: () => void,
   *   onclose: () => void,
   *   onwidenscope?: () => void,
   * }} */
  let {
    open,
    scope,
    sectionLabel = '',
    assistantName,
    busy = false,
    blockedReason = null,
    errorSentence = null,
    lastReply = null,
    onsubmit,
    oncancel,
    onclose,
    onwidenscope,
  } = $props();

  let value = $state('');
  let inputEl = $state(/** @type {HTMLInputElement | null} */ (null));

  const placeholder = $derived(
    scope.kind === 'section'
      ? `Ask ${assistantName} about ${sectionLabel || scope.section}…`
      : `Ask ${assistantName} to edit this trip…`,
  );

  const promiseLine = $derived(
    scope.kind === 'section'
      ? `${assistantName} will edit ${sectionLabel || scope.section} if it needs to. Esc to close.`
      : `${assistantName} will edit relevant sections if it needs to. Esc to close.`,
  );

  // Autofocus the input when the palette opens; reset value when it closes.
  $effect(() => {
    if (open) {
      tick().then(() => inputEl?.focus());
    } else {
      value = '';
    }
  });

  function handleKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (busy) oncancel?.();
      else onclose();
    }
  }

  function submit(e) {
    e?.preventDefault?.();
    const trimmed = value.trim();
    if (!trimmed || busy || blockedReason) return;
    onsubmit(trimmed);
  }
</script>

{#if open}
  <div class="palette-backdrop" onclick={onclose} role="presentation"></div>
  <div
    class="palette"
    role="dialog"
    aria-label="{assistantName} command palette"
    aria-modal="true"
    tabindex="-1"
    use:focusTrap={{ enabled: open, onEscape: () => (busy ? oncancel?.() : onclose()) }}
    onkeydown={handleKey}
  >
    {#if blockedReason}
      <div class="palette-blocked" role="alert">{blockedReason}</div>
    {:else}
      <form class="palette-row" onsubmit={submit}>
        <button
          type="button"
          class="palette-chip"
          class:section-scoped={scope.kind === 'section'}
          onclick={onwidenscope}
          disabled={scope.kind === 'trip' || !onwidenscope}
          title={scope.kind === 'section' ? 'Click to widen to trip-wide scope' : 'Scope: this trip'}
        >
          {#if scope.kind === 'section'}
            <span class="chip-icon" aria-hidden="true">📍</span>
            {sectionLabel || scope.section}
          {:else}
            <span class="chip-icon" aria-hidden="true">🗺</span>
            Trip
          {/if}
        </button>

        <input
          bind:this={inputEl}
          bind:value
          type="text"
          {placeholder}
          class="palette-input"
          autocomplete="off"
          spellcheck="true"
          disabled={busy}
          aria-label={placeholder}
        />

        {#if busy}
          <button
            type="button"
            class="palette-cancel"
            onclick={() => oncancel?.()}
            aria-label="Cancel request"
          >
            <span class="palette-spinner" aria-hidden="true"></span>
            Cancel
          </button>
        {:else}
          <button
            type="submit"
            class="palette-submit"
            disabled={!value.trim()}
            aria-label="Send to {assistantName}"
          >Send</button>
        {/if}
      </form>

      {#if lastReply}
        <div class="palette-reply" role="status" aria-live="polite">
          <span class="palette-reply-author">— {assistantName}:</span>
          {lastReply}
        </div>
      {/if}

      <div class="palette-promise">{promiseLine}</div>
    {/if}

    {#if errorSentence}
      <div class="palette-error" role="alert">{errorSentence}</div>
    {/if}
  </div>
{/if}

<style>
  .palette-backdrop {
    position: fixed;
    inset: 0;
    background: color-mix(in oklab, var(--text-primary) 35%, transparent);
    backdrop-filter: blur(2px);
    -webkit-backdrop-filter: blur(2px);
    z-index: 950;
  }

  .palette {
    position: fixed;
    top: 18vh;
    left: 50%;
    transform: translateX(-50%);
    width: min(600px, calc(100vw - 2rem));
    background: var(--surface-overlay);
    border: 1px solid var(--border-default);
    border-radius: 8px;
    box-shadow: 0 18px 50px rgba(0, 0, 0, 0.28);
    z-index: 960;
    font-family: var(--font-sans);
    overflow: hidden;
  }

  .palette-row {
    display: flex;
    align-items: stretch;
    gap: 0;
    padding: 0.5rem 0.5rem 0.5rem 0.55rem;
  }

  /* Scope chip — pinned to the left of the input. Clickable when scoped to a
     section (widens to trip); disabled and decorative when trip-wide. */
  .palette-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.4rem 0.6rem;
    background: var(--surface-raised);
    border: 1px solid var(--border-default);
    border-radius: 4px;
    color: var(--text-secondary);
    font-size: 0.78rem;
    font-weight: 600;
    font-family: var(--font-sans);
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.12s, border-color 0.12s, color 0.12s;
  }
  .palette-chip.section-scoped {
    background: color-mix(in oklab, var(--accent) 10%, var(--surface-raised));
    border-color: color-mix(in oklab, var(--accent) 30%, var(--border-default));
    color: var(--accent-text);
  }
  .palette-chip:hover:not(:disabled) {
    border-color: var(--border-strong);
    color: var(--text-primary);
  }
  .palette-chip:disabled {
    cursor: default;
  }
  .chip-icon {
    font-size: 0.9em;
    line-height: 1;
  }

  .palette-input {
    flex: 1;
    min-width: 0;
    padding: 0.4rem 0.7rem;
    background: transparent;
    border: none;
    color: var(--text-primary);
    font-family: var(--font-sans);
    font-size: 0.95rem;
    line-height: 1.4;
    outline: none;
  }
  .palette-input::placeholder { color: var(--text-tertiary); }
  .palette-input:disabled { color: var(--text-tertiary); }

  /* Submit / Cancel both anchor right; same min-width to keep layout stable
     across the in-flight swap (matches the prior chat input pattern). */
  .palette-submit,
  .palette-cancel {
    min-width: 5rem;
    padding: 0.4rem 0.85rem;
    border-radius: 4px;
    font-family: var(--font-sans);
    font-size: 0.82rem;
    font-weight: 700;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    white-space: nowrap;
    transition: background 0.12s, border-color 0.12s, color 0.12s;
  }
  .palette-submit {
    background: var(--surface-invert);
    color: var(--text-inverse);
    border: 1px solid var(--surface-invert);
  }
  .palette-submit:hover:not(:disabled) {
    background: var(--text-primary);
    border-color: var(--text-primary);
  }
  .palette-submit:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .palette-cancel {
    background: var(--surface-page);
    color: var(--state-danger);
    border: 1px solid var(--state-danger);
  }
  .palette-cancel:hover {
    background: var(--state-danger-surface);
  }

  @keyframes palette-spin { to { transform: rotate(360deg); } }
  .palette-spinner {
    width: 11px;
    height: 11px;
    border: 1.5px solid color-mix(in oklab, var(--state-danger) 35%, transparent);
    border-top-color: var(--state-danger);
    border-radius: 50%;
    animation: palette-spin 0.8s linear infinite;
    flex-shrink: 0;
  }

  /* Conversational reply (no <update> blocks): rendered below the input
     in italic serif to carry the Field-guide voice from the section banner
     into the palette itself. */
  .palette-reply {
    padding: 0.7rem 0.95rem;
    font-family: var(--font-serif);
    font-style: italic;
    font-size: 0.95rem;
    line-height: 1.5;
    color: var(--text-primary);
    background: var(--surface-raised);
    border-top: 1px solid var(--border-subtle);
  }
  .palette-reply-author {
    font-style: italic;
    color: var(--text-secondary);
    margin-right: 0.15rem;
  }

  .palette-promise {
    padding: 0.4rem 0.85rem 0.7rem;
    color: var(--text-tertiary);
    font-size: 0.74rem;
    line-height: 1.4;
    border-top: 1px solid var(--border-subtle);
    background: var(--surface-raised);
  }

  .palette-blocked {
    padding: 0.7rem 0.95rem;
    background: var(--state-warning-surface);
    color: var(--state-warning);
    font-size: 0.82rem;
    line-height: 1.45;
  }

  .palette-error {
    padding: 0.55rem 0.85rem;
    background: var(--state-warning-surface);
    color: var(--state-warning);
    border-top: 1px solid color-mix(in oklab, var(--state-warning) 40%, transparent);
    font-size: 0.78rem;
    line-height: 1.4;
  }

  @media (max-width: 640px) {
    .palette {
      top: auto;
      bottom: 0;
      left: 0;
      transform: none;
      width: 100vw;
      border-radius: 8px 8px 0 0;
    }

    /* Reflow the row so the input gets the full viewport width. The
       desktop pattern (chip | input | Send) at 375px squeezed the input
       to ~184px and clipped long queries. Mobile: input on its own row
       above the scope chip + Send so the user can see what they typed. */
    .palette-row {
      flex-wrap: wrap;
      padding: 0.55rem;
      gap: 0.4rem;
    }
    .palette-input {
      order: 1;
      flex: 1 1 100%;
      padding: 0.65rem 0.7rem;
      font-size: 16px; /* iOS will not auto-zoom on focus at 16px+ */
    }
    .palette-chip {
      order: 2;
      min-height: var(--tap-min);
    }
    .palette-submit,
    .palette-cancel {
      order: 3;
      margin-left: auto;
      min-height: var(--tap-min);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .palette-backdrop { backdrop-filter: none; -webkit-backdrop-filter: none; }
    .palette-spinner { animation: none; }
  }
</style>

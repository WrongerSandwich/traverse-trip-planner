<script>
  import ConfirmModal from './ConfirmModal.svelte';
  import { failureSentence } from '$lib/errors-registry.js';
  import { formatTokens } from '$lib/utils/formatTokens.js';

  let { slug, assistantName = 'Field guide', onclose, onsaved } = $props();

  // Phases: loading | answering | saving | success | error
  let phase = $state('loading');

  // Error state — code from errors-registry, ctx for interpolation.
  let errorCode = $state('');
  let errorCtx  = $state({});
  // Track which action last failed so retry knows where to resume.
  let lastFailedAction = $state('post');

  let questions = $state([]);
  let answers = $state([]);
  let rating = $state(0);            // 0 = unset; 1-5
  let wouldRepeat = $state(true);    // optimistic default; user can flip

  // Aggregated tokens across POST (question generation) + PUT (note writing).
  let totalTokens = $state(0);

  // Cancel-mid-flow confirmation.
  let showDiscardConfirm = $state(false);

  // Maps an HTTP response (or null for network failure) to a registry error code.
  function classifyError(res, text) {
    if (!res) return { code: 'network_error', ctx: {} };
    if (res.status === 409) return { code: 'file_conflict', ctx: { artifact: 'notes.md' } };
    if (res.status === 404) return { code: 'trip_not_found', ctx: {} };
    if (res.status === 502) return { code: 'empty_model_output', ctx: {} };
    if (res.status === 400) return { code: 'invalid_input', ctx: { reason: text || 'Bad request' } };
    return { code: 'network_error', ctx: {} };
  }

  function startLoad() {
    phase = 'loading';
    errorCode = '';
    errorCtx  = {};
    lastFailedAction = 'post';

    fetch(`/api/actions/retro/${encodeURIComponent(slug)}`, { method: 'POST' })
      .then(async r => {
        if (!r.ok) {
          const text = await r.text().catch(() => '');
          const { code, ctx } = classifyError(r, text);
          const err = new Error(text);
          err._code = code;
          err._ctx  = ctx;
          throw err;
        }
        return r.json();
      })
      .then(data => {
        questions = data.questions || [];
        answers = questions.map(() => '');
        totalTokens += (data.tokens || 0);
        phase = 'answering';
      })
      .catch(err => {
        errorCode = err._code || 'network_error';
        errorCtx  = err._ctx  || {};
        lastFailedAction = 'post';
        phase = 'error';
      });
  }

  $effect(() => {
    if (!slug) return;
    totalTokens = 0;
    startLoad();
  });

  async function save() {
    phase = 'saving';
    errorCode = '';
    errorCtx  = {};
    lastFailedAction = 'put';

    try {
      const res = await fetch(`/api/actions/retro/${encodeURIComponent(slug)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questions,
          answers,
          rating: rating || null,
          would_repeat: wouldRepeat,
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        const { code, ctx } = classifyError(res, text);
        errorCode = code;
        errorCtx  = ctx;
        phase = 'error';
        return;
      }
      const data = await res.json().catch(() => ({}));
      totalTokens += (data.tokens || 0);
      phase = 'success';
      // Give the user a moment to see the success state, then advance.
      setTimeout(() => onsaved?.(), 1800);
    } catch (err) {
      errorCode = err._code || 'network_error';
      errorCtx  = err._ctx  || {};
      phase = 'error';
    }
  }

  function retryAction() {
    if (lastFailedAction === 'put') {
      save();
    } else {
      startLoad();
    }
  }

  // Returns true for codes where a retry is meaningful.
  function isRetryable(code) {
    return ['network_error', 'empty_model_output', 'timeout', 'provider_error'].includes(code);
  }

  // Gate close through confirmation when mid-flow with answers entered.
  function requestClose() {
    if (phase === 'saving') return;   // non-interruptible
    if (phase === 'answering' && hasAnyAnswer) {
      showDiscardConfirm = true;
      return;
    }
    onclose?.();
  }

  function handleKey(e) {
    if (e.key === 'Escape') requestClose();
  }

  const hasAnyAnswer = $derived(answers.some(a => a.trim().length > 0));

  // 0-indexed count of questions that have a non-empty answer — drives step indicator.
  const answeredCount = $derived(answers.filter(a => a.trim().length > 0).length);
</script>

<svelte:window onkeydown={handleKey} />

<div class="backdrop" onclick={requestClose} role="presentation"></div>

<div class="modal" role="dialog" aria-modal="true" aria-labelledby="retro-title">
  <header class="modal-header">
    <h2 id="retro-title">How was the trip?</h2>
    {#if phase !== 'saving'}
      <button class="close" onclick={requestClose} aria-label="Close">✕</button>
    {/if}
  </header>

  {#if phase === 'answering' || phase === 'saving' || phase === 'success'}
    <div
      class="step-indicator"
      role="progressbar"
      aria-label="Questions answered"
      aria-valuenow={answeredCount}
      aria-valuemax={5}
    >
      {#each [0, 1, 2, 3, 4] as i}
        <span
          class="step-seg"
          class:complete={phase === 'success' || (phase !== 'saving' && i < answeredCount)}
          class:current={phase === 'saving' || (phase === 'answering' && i === answeredCount)}
        ></span>
      {/each}
    </div>
  {/if}

  <div class="modal-body">
    {#if phase === 'loading'}
      <div class="status">
        <span class="spinner"></span>
        <span>{assistantName} is reading through your trip…</span>
      </div>
    {:else if phase === 'error'}
      <div class="status error" role="alert">
        <p class="error-sentence">{failureSentence(errorCode, errorCtx)}</p>
        <div class="error-actions">
          {#if isRetryable(errorCode)}
            <button class="btn btn-primary btn-compact" onclick={retryAction}>Try again</button>
          {/if}
          <button class="btn btn-tertiary btn-compact" onclick={onclose}>Close</button>
        </div>
      </div>
    {:else if phase === 'answering'}
      <p class="intro">
        Answer what you want — skip the rest. {assistantName} will write it up. You can always edit
        <code>notes.md</code> directly later.
      </p>

      {#each questions as q, i}
        <div class="qa">
          <label for={`retro-a-${i}`}><span class="qa-num">{i + 1}.</span> {q}</label>
          <textarea
            id={`retro-a-${i}`}
            bind:value={answers[i]}
            rows="3"
            placeholder="(skip)"
            spellcheck="true"
          ></textarea>
        </div>
      {/each}

      <div class="structured">
        <div class="rating">
          <span class="label">Overall</span>
          <div class="stars" role="radiogroup" aria-label="Rating">
            {#each [1, 2, 3, 4, 5] as n}
              <button
                type="button"
                class="star"
                class:active={rating >= n}
                onclick={() => rating = (rating === n ? 0 : n)}
                aria-label={`${n} out of 5`}
                aria-pressed={rating >= n}
              >★</button>
            {/each}
          </div>
        </div>

        <label class="repeat">
          <input type="checkbox" bind:checked={wouldRepeat} />
          <span>Would do this trip again</span>
        </label>
      </div>

      <div class="actions">
        <button class="btn btn-tertiary" onclick={requestClose}>Skip for now</button>
        <button class="btn btn-primary" onclick={save} disabled={!hasAnyAnswer && !rating}>
          Save retro
        </button>
      </div>
    {:else if phase === 'saving'}
      <div class="status">
        <span class="spinner"></span>
        <span>{assistantName} is writing it up…</span>
      </div>
    {:else if phase === 'success'}
      <div class="status success" role="status">
        <span class="success-icon" aria-hidden="true">✓</span>
        <span>Retro saved{totalTokens > 0 ? ` · ${formatTokens(totalTokens)}` : ''}</span>
      </div>
    {/if}
  </div>
</div>

<ConfirmModal
  bind:open={showDiscardConfirm}
  title="Discard your retro answers?"
  body="Your answers haven't been saved yet. Closing now will lose them."
  confirmLabel="Discard"
  danger={true}
  onconfirm={() => onclose?.()}
  oncancel={() => { showDiscardConfirm = false; }}
/>

<style>
  .backdrop {
    position: fixed; inset: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 998;
  }

  .modal {
    position: fixed;
    top: 50%; left: 50%;
    transform: translate(-50%, -50%);
    width: min(640px, calc(100vw - 2rem));
    max-height: calc(100vh - 4rem);
    display: flex; flex-direction: column;
    background: var(--surface-overlay);
    color: var(--text-primary);
    border-radius: 10px;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.35);
    z-index: 999;
    overflow: hidden;
    font-family: var(--font-sans);
  }

  .modal-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 0.9rem 1.2rem;
    border-bottom: 1px solid var(--surface-sunken);
  }
  .modal-header h2 {
    font-family: var(--font-serif);
    font-size: 1.2rem;
    font-weight: 500;
    margin: 0;
    color: var(--text-primary);
  }
  .close {
    background: none; border: none;
    color: var(--text-tertiary);
    cursor: pointer; font-size: 1rem;
    padding: 0.2rem 0.4rem;
    transition: color 0.12s;
  }
  .close:hover { color: var(--text-primary); }

  /* Step indicator — 5 segments, sits between header and body */
  .step-indicator {
    display: flex;
    gap: 0.25rem;
    padding: 0.55rem 1.2rem 0;
  }
  .step-seg {
    flex: 1;
    height: 3px;
    border-radius: 2px;
    background: var(--surface-sunken);
    transition: background 0.2s;
  }
  .step-seg.complete { background: var(--state-success); }
  .step-seg.current  { background: var(--accent-text); }

  .modal-body {
    padding: 1rem 1.2rem 1.2rem;
    overflow-y: auto;
  }

  .intro {
    font-size: 0.85rem;
    color: var(--text-secondary);
    margin: 0 0 1rem;
    line-height: 1.5;
  }
  .intro code {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.78rem;
    background: var(--surface-sunken);
    padding: 0.05rem 0.3rem;
    border-radius: 2px;
  }

  .qa { margin-bottom: 1rem; }
  .qa label {
    display: block;
    font-size: 0.88rem;
    font-weight: 500;
    color: var(--text-primary);
    margin-bottom: 0.4rem;
    line-height: 1.4;
  }
  .qa-num {
    color: var(--text-tertiary);
    font-weight: 600;
    margin-right: 0.25rem;
  }
  .qa textarea {
    width: 100%;
    font-family: var(--font-sans);
    font-size: 0.88rem;
    color: var(--text-primary);
    background: var(--surface-page);
    border: 1px solid var(--surface-sunken);
    border-radius: 4px;
    padding: 0.5rem 0.6rem;
    resize: vertical;
    line-height: 1.5;
  }
  .qa textarea:focus {
    outline: none;
    border-color: var(--focus-ring);
  }

  .structured {
    display: flex; align-items: center; justify-content: space-between;
    gap: 1rem;
    padding: 0.8rem 0;
    border-top: 1px solid var(--surface-sunken);
    border-bottom: 1px solid var(--surface-sunken);
    margin: 0.5rem 0 1rem;
    flex-wrap: wrap;
  }
  .rating { display: flex; align-items: center; gap: 0.6rem; }
  .rating .label {
    font-size: 0.82rem;
    color: var(--text-secondary);
    font-weight: 500;
  }
  .stars { display: inline-flex; gap: 0.15rem; }
  .star {
    background: none; border: none;
    cursor: pointer;
    font-size: 1.2rem;
    line-height: 1;
    color: var(--surface-sunken);
    padding: 0.1rem 0.15rem;
    transition: color 0.1s;
  }
  .star.active { color: var(--accent-text); }
  .star:hover { color: var(--accent-text); }

  .repeat {
    display: flex; align-items: center; gap: 0.4rem;
    font-size: 0.85rem;
    color: var(--text-primary);
    cursor: pointer;
  }
  .repeat input { cursor: pointer; }

  .actions {
    display: flex; justify-content: flex-end; gap: 0.5rem;
  }

  .status {
    display: flex; align-items: center; gap: 0.6rem;
    padding: 1rem 0;
    color: var(--text-secondary);
    font-size: 0.9rem;
  }
  .status.error {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.6rem;
    color: var(--text-primary);
  }
  .status.success {
    color: var(--state-success);
  }

  .error-sentence {
    margin: 0;
    font-size: 0.88rem;
    line-height: 1.4;
  }
  .error-actions {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .success-icon {
    color: var(--state-success);
    font-weight: 700;
    font-size: 1rem;
  }

  @keyframes spin { to { transform: rotate(360deg); } }
  .spinner {
    width: 14px; height: 14px;
    border: 1.5px solid var(--border-subtle);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    flex-shrink: 0;
  }

  @media (max-width: 768px) {
    .modal {
      top: auto; bottom: 0;
      left: 0;
      transform: none;
      width: 100%;
      max-height: 90vh;
      border-radius: 10px 10px 0 0;
    }
  }
</style>

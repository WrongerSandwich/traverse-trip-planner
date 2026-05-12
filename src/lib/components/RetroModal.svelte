<script>
  let { slug, assistantName = 'Field guide', onclose, onsaved } = $props();

  // Phases: loading | answering | saving | error
  let phase = $state('loading');
  let errorMsg = $state('');
  let questions = $state([]);
  let answers = $state([]);
  let rating = $state(0);            // 0 = unset; 1-5
  let wouldRepeat = $state(true);    // optimistic default; user can flip

  $effect(() => {
    if (!slug) return;
    phase = 'loading';
    errorMsg = '';
    fetch(`/api/actions/retro/${encodeURIComponent(slug)}`, { method: 'POST' })
      .then(async r => {
        if (!r.ok) {
          const text = await r.text().catch(() => '');
          throw new Error(text || `Failed to start retro (${r.status})`);
        }
        return r.json();
      })
      .then(data => {
        questions = data.questions || [];
        answers = questions.map(() => '');
        phase = 'answering';
      })
      .catch(err => {
        errorMsg = err.message;
        phase = 'error';
      });
  });

  async function save() {
    phase = 'saving';
    errorMsg = '';
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
        throw new Error(text || `Save failed (${res.status})`);
      }
      onsaved?.();
    } catch (err) {
      errorMsg = err.message;
      phase = 'error';
    }
  }

  function handleKey(e) {
    if (e.key === 'Escape' && phase !== 'saving') onclose?.();
  }

  const hasAnyAnswer = $derived(answers.some(a => a.trim().length > 0));
</script>

<svelte:window onkeydown={handleKey} />

<div class="backdrop" onclick={() => phase !== 'saving' && onclose?.()} role="presentation"></div>

<div class="modal" role="dialog" aria-modal="true" aria-labelledby="retro-title">
  <header class="modal-header">
    <h2 id="retro-title">How was the trip?</h2>
    {#if phase !== 'saving'}
      <button class="close" onclick={onclose} aria-label="Close">✕</button>
    {/if}
  </header>

  <div class="modal-body">
    {#if phase === 'loading'}
      <div class="status">
        <span class="spinner"></span>
        <span>{assistantName} is reading through your trip…</span>
      </div>
    {:else if phase === 'error'}
      <div class="status error">
        <p><strong>Something went wrong.</strong></p>
        <p class="error-msg">{errorMsg}</p>
        <button class="btn btn-secondary btn-compact" onclick={onclose}>Close</button>
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
        <button class="btn btn-tertiary" onclick={onclose}>Skip for now</button>
        <button class="btn btn-primary" onclick={save} disabled={!hasAnyAnswer && !rating}>
          Save retro
        </button>
      </div>
    {:else if phase === 'saving'}
      <div class="status">
        <span class="spinner"></span>
        <span>{assistantName} is writing it up…</span>
      </div>
    {/if}
  </div>
</div>

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
    background: var(--surface-raised);
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
    color: var(--forest-800);
  }
  .close {
    background: none; border: none;
    color: var(--text-tertiary);
    cursor: pointer; font-size: 1rem;
    padding: 0.2rem 0.4rem;
    transition: color 0.12s;
  }
  .close:hover { color: var(--text-primary); }

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
    border-color: var(--forest-600);
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
  .star.active { color: var(--sunset-400); }
  .star:hover { color: var(--sunset-400); }

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
  }
  .error-msg {
    margin: 0;
    color: var(--embers-600);
    font-size: 0.85rem;
  }

  @keyframes spin { to { transform: rotate(360deg); } }
  .spinner {
    width: 14px; height: 14px;
    border: 1.5px solid var(--surface-sunken);
    border-top-color: var(--forest-600);
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

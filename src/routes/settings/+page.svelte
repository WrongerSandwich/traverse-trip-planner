<script>
  import { untrack } from 'svelte';
  import Logo from '$lib/components/Logo.svelte';

  let { data } = $props();

  const PROVIDERS = ['anthropic', 'openai', 'openrouter'];
  const PROVIDER_LABELS = {
    anthropic: 'Anthropic',
    openai: 'OpenAI',
    openrouter: 'OpenRouter',
  };

  // Editable form state — keys are plaintext (user is typing), slots are provider+model.
  // We start with empty key fields (not the redacted preview) so the user can type a new key.
  let keys = $state({
    anthropic: '',
    openai: '',
    openrouter: '',
  });

  let slots = $state(untrack(() => ({
    default: {
      provider: data.settingsView.slots.default?.provider ?? '',
      model: data.settingsView.slots.default?.model ?? '',
    },
    research: {
      provider: data.settingsView.slots.research?.provider ?? '',
      model: data.settingsView.slots.research?.model ?? '',
    },
  })));

  let busy = $state(false);
  let savedOk = $state(false);
  let saveError = $state('');

  // Per-provider remove confirmation state.
  let removingKey = $state({ anthropic: false, openai: false, openrouter: false });

  async function removeKey(provider) {
    if (busy) return;
    busy = true;
    savedOk = false;
    saveError = '';
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keysToClear: [provider] }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        saveError = body.error ?? `Server error ${res.status}`;
      } else {
        removingKey[provider] = false;
        const updated = await res.json();
        if (updated.settingsView) {
          data = { ...data, settingsView: updated.settingsView };
        }
      }
    } catch (e) {
      saveError = e.message;
    } finally {
      busy = false;
    }
  }

  async function save() {
    if (busy) return;
    busy = true;
    savedOk = false;
    saveError = '';

    // Build payload: only include non-empty values so we don't overwrite
    // existing settings with blank placeholders.
    const keysPayload = {};
    for (const p of PROVIDERS) {
      if (keys[p].trim()) keysPayload[p] = keys[p].trim();
    }

    const slotsPayload = {};
    if (slots.default.provider || slots.default.model) {
      slotsPayload.default = {};
      if (slots.default.provider) slotsPayload.default.provider = slots.default.provider;
      if (slots.default.model)    slotsPayload.default.model    = slots.default.model;
    }
    if (slots.research.provider || slots.research.model) {
      slotsPayload.research = {};
      if (slots.research.provider) slotsPayload.research.provider = slots.research.provider;
      if (slots.research.model)    slotsPayload.research.model    = slots.research.model;
    }

    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keys: keysPayload, slots: slotsPayload }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        saveError = body.error ?? `Server error ${res.status}`;
      } else {
        savedOk = true;
        keys = { anthropic: '', openai: '', openrouter: '' };
        // Reload to get fresh redacted previews
        const updated = await res.json();
        if (updated.settingsView) {
          data = { ...data, settingsView: updated.settingsView };
        }
      }
    } catch (e) {
      saveError = e.message;
    } finally {
      busy = false;
    }
  }


</script>

<svelte:head>
  <title>Settings — Traverse</title>
</svelte:head>

<div class="page">
  <header>
    <div class="wordmark">
      <Logo variant="inverse" size={28} />
      <h1><a href="/" class="back-link">Traverse</a> <span class="slash">/</span> Settings</h1>
    </div>
  </header>

  <main>
    <section class="settings-section">
      <h2>API Keys</h2>
      <p class="section-desc">Provider API keys are stored in <code>settings.json</code> at the server root and overlay your <code>.env</code> values. The full key is never sent back to the browser after saving.</p>

      <div class="field-group">
        {#each PROVIDERS as provider}
          {@const current = data.settingsView.keys[provider]}
          <div class="field">
            <div class="field-label-row">
              <label for="key-{provider}" class="field-label">{PROVIDER_LABELS[provider]}</label>
              {#if current?.isSet}
                <span class="badge badge-set">set — {current.preview}</span>
                {#if removingKey[provider]}
                  <span class="remove-confirm">
                    Remove key?
                    <button class="btn-confirm-yes" onclick={() => removeKey(provider)} disabled={busy}>Yes, remove</button>
                    <button class="btn-confirm-cancel" onclick={() => removingKey[provider] = false}>Cancel</button>
                  </span>
                {:else}
                  <button class="btn-remove" onclick={() => removingKey[provider] = true} title="Remove stored key — .env value resumes">Remove</button>
                {/if}
              {:else}
                <span class="badge badge-unset">not set</span>
              {/if}
            </div>
            <input
              id="key-{provider}"
              type="password"
              autocomplete="off"
              spellcheck="false"
              class="field-input"
              placeholder={current?.isSet ? 'Paste new key to replace…' : 'Paste API key…'}
              bind:value={keys[provider]}
            />
          </div>
        {/each}
      </div>
    </section>

    <section class="settings-section">
      <h2>Model slots</h2>
      <p class="section-desc">Set the provider and model for each slot. Leave blank to keep the current value (from <code>.env</code> or a previous save). Changes take effect on the next AI call — no restart needed.</p>

      {#each [['default', 'Default (seed, chat, lock, add)'], ['research', 'Research (deepen)']] as [slotKey, slotLabel]}
        <div class="slot-group">
          <div class="slot-header">{slotLabel}</div>
          <div class="slot-fields">
            <div class="field">
              <label for="slot-{slotKey}-provider" class="field-label">Provider</label>
              <select
                id="slot-{slotKey}-provider"
                class="field-select"
                bind:value={slots[slotKey].provider}
              >
                <option value="">— inherit from .env —</option>
                <option value="anthropic">anthropic</option>
                <option value="openai">openai</option>
                <option value="openrouter">openrouter</option>
              </select>
            </div>
            <div class="field">
              <label for="slot-{slotKey}-model" class="field-label">Model</label>
              <input
                id="slot-{slotKey}-model"
                type="text"
                class="field-input"
                placeholder="e.g. claude-sonnet-4-6"
                bind:value={slots[slotKey].model}
              />
            </div>
          </div>
        </div>
      {/each}
    </section>

    <div class="actions">
      <button class="btn btn-primary" onclick={save} disabled={busy}>
        {busy ? 'Saving…' : 'Save settings'}
      </button>
      {#if savedOk}
        <span class="feedback feedback-ok">Saved. Changes take effect on the next request.</span>
      {/if}
      {#if saveError}
        <span class="feedback feedback-err">{saveError}</span>
      {/if}
    </div>
  </main>
</div>

<style>
  .page {
    min-height: 100vh;
    background: var(--surface-page);
    color: var(--text-primary);
    font-family: var(--font-sans);
  }

  header {
    background: var(--surface-invert);
    color: var(--text-inverse);
    padding: 0 24px;
    height: 52px;
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .wordmark {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .wordmark h1 {
    font-size: 15px;
    font-weight: 500;
    font-family: var(--font-sans);
    color: var(--bone-200);
    margin: 0;
    letter-spacing: 0.01em;
  }

  .back-link {
    color: inherit;
    text-decoration: none;
  }
  .back-link:hover { text-decoration: underline; }

  .slash {
    opacity: 0.4;
    margin: 0 2px;
  }

  main {
    max-width: 600px;
    margin: 0 auto;
    padding: 40px 24px 80px;
  }

  .settings-section {
    margin-bottom: 48px;
  }

  h2 {
    font-family: var(--font-serif);
    font-size: 18px;
    font-weight: 400;
    font-style: italic;
    color: var(--forest-800);
    margin: 0 0 6px;
  }

  .section-desc {
    font-size: 12px;
    color: var(--text-tertiary);
    margin: 0 0 20px;
    line-height: 1.6;
  }

  code {
    font-family: var(--font-mono);
    font-size: 11px;
    background: var(--surface-sunken);
    padding: 1px 4px;
    border-radius: 3px;
  }

  .field-group {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .field-label-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .field-label {
    font-size: 12px;
    font-weight: 500;
    color: var(--text-secondary);
  }

  .badge {
    font-size: 10px;
    font-family: var(--font-mono);
    padding: 2px 6px;
    border-radius: 3px;
    font-weight: 400;
    letter-spacing: 0.02em;
  }

  .badge-set {
    background: var(--forest-100);
    color: var(--forest-600);
  }

  .badge-unset {
    background: var(--bone-200);
    color: var(--bone-800);
  }

  .field-input,
  .field-select {
    background: var(--surface-raised);
    border: 1px solid var(--bone-400);
    border-radius: 4px;
    padding: 8px 10px;
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-primary);
    width: 100%;
    box-sizing: border-box;
    transition: border-color 0.15s;
  }

  .field-input:focus,
  .field-select:focus {
    outline: none;
    border-color: var(--forest-400);
  }

  .field-input::placeholder {
    color: var(--text-tertiary);
    font-family: var(--font-sans);
  }

  .slot-group {
    margin-bottom: 20px;
  }

  .slot-header {
    font-size: 12px;
    font-weight: 500;
    color: var(--text-secondary);
    margin-bottom: 8px;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--bone-200);
  }

  .slot-fields {
    display: grid;
    grid-template-columns: 160px 1fr;
    gap: 12px;
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 16px;
    flex-wrap: wrap;
  }

  .feedback {
    font-size: 12px;
    font-family: var(--font-mono);
  }

  .feedback-ok  { color: var(--state-success); }
  .feedback-err { color: var(--sunset-800); }

  .btn-remove {
    font-size: 10px;
    font-family: var(--font-mono);
    padding: 1px 6px;
    border-radius: 3px;
    border: 1px solid var(--bone-400);
    background: transparent;
    color: var(--text-tertiary);
    cursor: pointer;
    line-height: 1.6;
    transition: border-color 0.15s, color 0.15s;
  }
  .btn-remove:hover {
    border-color: var(--sunset-600);
    color: var(--sunset-700);
  }

  .remove-confirm {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 10px;
    font-family: var(--font-mono);
    color: var(--text-tertiary);
  }

  .btn-confirm-yes,
  .btn-confirm-cancel {
    font-size: 10px;
    font-family: var(--font-mono);
    padding: 1px 6px;
    border-radius: 3px;
    cursor: pointer;
    line-height: 1.6;
    border: 1px solid transparent;
  }
  .btn-confirm-yes {
    background: var(--sunset-100);
    border-color: var(--sunset-400);
    color: var(--sunset-800);
  }
  .btn-confirm-yes:hover:not(:disabled) {
    background: var(--sunset-200);
  }
  .btn-confirm-yes:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .btn-confirm-cancel {
    background: transparent;
    border-color: var(--bone-400);
    color: var(--text-tertiary);
  }
  .btn-confirm-cancel:hover {
    border-color: var(--bone-600);
    color: var(--text-secondary);
  }
</style>

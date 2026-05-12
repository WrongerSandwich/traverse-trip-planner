<script>
  import { onMount, untrack } from 'svelte';
  import Logo from '$lib/components/Logo.svelte';

  // The home page sets `:global(html, body) { height: 100%; overflow: hidden }`
  // in its route stylesheet. SvelteKit doesn't unload route stylesheets on
  // client-side navigation, so that rule lingers and competes with any CSS
  // override we put here — load order isn't deterministic enough to rely on.
  // Set inline styles instead (highest specificity beats any sheet rule),
  // and restore the previous values on unmount so nav-away is clean.
  onMount(() => {
    const html = document.documentElement;
    const body = document.body;
    const prev = {
      htmlOverflow: html.style.overflow,
      htmlHeight: html.style.height,
      bodyOverflow: body.style.overflow,
      bodyHeight: body.style.height,
    };
    html.style.overflow = 'auto';
    html.style.height = 'auto';
    body.style.overflow = 'auto';
    body.style.height = 'auto';
    return () => {
      html.style.overflow = prev.htmlOverflow;
      html.style.height = prev.htmlHeight;
      body.style.overflow = prev.bodyOverflow;
      body.style.height = prev.bodyHeight;
    };
  });

  let { data } = $props();

  const PROVIDERS = ['anthropic', 'openai', 'openrouter'];
  const PROVIDER_LABELS = {
    anthropic: 'Anthropic',
    openai: 'OpenAI',
    openrouter: 'OpenRouter',
  };

  const SERVICES = ['tavily', 'pexels', 'stadia'];
  const SERVICE_LABELS = {
    tavily: 'Tavily',
    pexels: 'Pexels',
    stadia: 'Stadia Maps',
  };
  const SERVICE_DESCRIPTIONS = {
    tavily: 'Web search backend (used by deepen when TRAVERSE_SEARCH_PROVIDER=tavily).',
    pexels: 'Cover photos shown on trip cards and brochures.',
    stadia: 'Static destination maps in the brochure.',
  };

  // Editable form state — keys are plaintext (user is typing), slots are provider+model.
  // We start with empty key fields (not the redacted preview) so the user can type a new key.
  let keys = $state({
    anthropic: '',
    openai: '',
    openrouter: '',
  });

  let services = $state({
    tavily: '',
    pexels: '',
    stadia: '',
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

  // Empty string means "inherit from .env"; storing this value clears the override.
  let searchProvider = $state(untrack(() => data.settingsView.search?.provider ?? ''));
  let assistantName  = $state(untrack(() => data.settingsView.assistantName ?? ''));

  // Warning when anthropic-builtin is selected but the research slot will use
  // a non-anthropic provider — that combo is rejected at runtime.
  let researchProviderEffective = $derived(
    slots.research.provider || data.settingsView.slots.research?.provider || 'anthropic'
  );
  let searchProviderEffective = $derived(
    searchProvider || data.effectiveSearchProvider
  );
  let searchProviderWarning = $derived(
    searchProviderEffective === 'anthropic-builtin' && researchProviderEffective !== 'anthropic'
      ? `"anthropic-builtin" only works when the research slot uses anthropic — currently "${researchProviderEffective}".`
      : ''
  );

  const FEATURE_LABELS = {
    seed:   'Seed ideas',
    add:    'Add destination',
    lock:   'Lock itinerary',
    chat:   'Ask Field guide',
    deepen: 'Research (deepen)',
    share:  'Share links',
  };

  let busy = $state(false);
  let savedOk = $state(false);
  let saveError = $state('');

  // Per-provider / per-service remove confirmation state.
  let removingKey = $state({ anthropic: false, openai: false, openrouter: false });
  let removingService = $state({ tavily: false, pexels: false, stadia: false });

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

  async function removeService(service) {
    if (busy) return;
    busy = true;
    savedOk = false;
    saveError = '';
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ servicesToClear: [service] }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        saveError = body.error ?? `Server error ${res.status}`;
      } else {
        removingService[service] = false;
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

    const servicesPayload = {};
    for (const s of SERVICES) {
      if (services[s].trim()) servicesPayload[s] = services[s].trim();
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

    const payload = {
      keys: keysPayload,
      services: servicesPayload,
      slots: slotsPayload,
      // Always send search.provider and assistantName — blank clears any override,
      // a value sets it. This is the only way to "remove" them from the UI.
      search: { provider: searchProvider },
      assistantName: assistantName,
    };

    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        saveError = body.error ?? `Server error ${res.status}`;
      } else {
        savedOk = true;
        keys = { anthropic: '', openai: '', openrouter: '' };
        services = { tavily: '', pexels: '', stadia: '' };
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
      <h2>Feature health</h2>
      <p class="section-desc">Live status for each feature based on the keys, slots, and search backend currently in effect. ✓ means the feature should work; ✗ means it's missing a key or has a mismatched configuration.</p>
      <ul class="health-grid">
        {#each Object.entries(FEATURE_LABELS) as [feature, label]}
          {@const ok = data.features?.[feature]}
          <li class="health-row {ok ? 'health-ok' : 'health-bad'}">
            <span class="health-mark" aria-hidden="true">{ok ? '✓' : '✗'}</span>
            <span class="health-label">{label}</span>
            <span class="health-status">{ok ? 'available' : 'unavailable'}</span>
          </li>
        {/each}
      </ul>
    </section>

    <section class="settings-section">
      <h2>Model provider keys</h2>
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
      <h2>Service keys</h2>
      <p class="section-desc">Non-model integrations — search, photos, maps. Same overlay rules as provider keys: stored in <code>settings.json</code>, overlay your <code>.env</code>, never sent back to the browser.</p>

      <div class="field-group">
        {#each SERVICES as service}
          {@const current = data.settingsView.services?.[service]}
          <div class="field">
            <div class="field-label-row">
              <label for="service-{service}" class="field-label">{SERVICE_LABELS[service]}</label>
              {#if current?.isSet}
                <span class="badge badge-set">set — {current.preview}</span>
                {#if removingService[service]}
                  <span class="remove-confirm">
                    Remove key?
                    <button class="btn-confirm-yes" onclick={() => removeService(service)} disabled={busy}>Yes, remove</button>
                    <button class="btn-confirm-cancel" onclick={() => removingService[service] = false}>Cancel</button>
                  </span>
                {:else}
                  <button class="btn-remove" onclick={() => removingService[service] = true} title="Remove stored key — .env value resumes">Remove</button>
                {/if}
              {:else}
                <span class="badge badge-unset">not set</span>
              {/if}
            </div>
            <p class="field-hint">{SERVICE_DESCRIPTIONS[service]}</p>
            <input
              id="service-{service}"
              type="password"
              autocomplete="off"
              spellcheck="false"
              class="field-input"
              placeholder={current?.isSet ? 'Paste new key to replace…' : 'Paste API key…'}
              bind:value={services[service]}
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

    <section class="settings-section">
      <h2>Search</h2>
      <p class="section-desc">Which backend to use when a feature needs a web search (today: Research/deepen). <code>anthropic-builtin</code> uses Anthropic's native search tool — but only works when the Research slot is also Anthropic. <code>tavily</code> works with any model provider but requires a Tavily key above.</p>

      <div class="slot-fields">
        <div class="field">
          <label for="search-provider" class="field-label">Search provider</label>
          <select id="search-provider" class="field-select" bind:value={searchProvider}>
            <option value="">— inherit from .env ({data.effectiveSearchProvider}) —</option>
            {#each data.supportedSearchProviders as sp}
              <option value={sp}>{sp}</option>
            {/each}
          </select>
        </div>
      </div>
      {#if searchProviderWarning}
        <p class="field-warn">{searchProviderWarning}</p>
      {/if}
    </section>

    <section class="settings-section">
      <h2>Assistant</h2>
      <p class="section-desc">Display name used wherever the trip-assistant chat is referenced ("Ask {data.effectiveAssistantName}", section headings, etc.). Leave blank to inherit from <code>.env</code>.</p>

      <div class="field">
        <label for="assistant-name" class="field-label">Assistant name</label>
        <input
          id="assistant-name"
          type="text"
          class="field-input"
          maxlength="60"
          placeholder={data.effectiveAssistantName}
          bind:value={assistantName}
        />
      </div>
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

  .field-hint {
    font-size: 11px;
    color: var(--text-tertiary);
    margin: 0 0 2px;
    line-height: 1.5;
  }

  .field-warn {
    font-size: 11px;
    color: var(--sunset-800);
    margin: 10px 0 0;
    line-height: 1.5;
  }

  .health-grid {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 6px 16px;
  }

  .health-row {
    display: grid;
    grid-template-columns: 18px 1fr auto;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border-radius: 4px;
    background: var(--surface-raised);
    border: 1px solid var(--bone-200);
  }

  .health-ok  { border-color: var(--forest-200); }
  .health-bad { border-color: var(--sunset-200); }

  .health-mark {
    font-family: var(--font-mono);
    font-size: 14px;
    text-align: center;
    line-height: 1;
  }
  .health-ok  .health-mark { color: var(--forest-600); }
  .health-bad .health-mark { color: var(--sunset-700); }

  .health-label {
    font-size: 12px;
    color: var(--text-primary);
  }

  .health-status {
    font-size: 10px;
    font-family: var(--font-mono);
    color: var(--text-tertiary);
    letter-spacing: 0.02em;
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

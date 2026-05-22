<script>
  import { onMount, untrack } from 'svelte';
  import { invalidateAll, beforeNavigate } from '$app/navigation';
  import Logo from '$lib/components/Logo.svelte';
  import SettingsSubnav from '$lib/components/SettingsSubnav.svelte';
  import { getStoredTheme, setTheme } from '$lib/theme.js';
  import { failureSentence } from '$lib/errors-registry.js';

  let { data } = $props();

  // ── Constants ──────────────────────────────────────────────────────────────
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
  const FEATURE_LABELS = {
    seed:   'Seed ideas',
    add:    'Add destination',
    lock:   'Lock itinerary',
    chat:   'Ask Field guide',
    deepen: 'Research (deepen)',
  };

  // ── Theme (local-only, no save endpoint) ───────────────────────────────────
  let theme = $state('system');

  // The home page sets `:global(html, body) { height: 100%; overflow: hidden }`
  // in its route stylesheet. SvelteKit doesn't unload route stylesheets on
  // client nav, so override with inline styles (highest specificity) and
  // restore on unmount.
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

  onMount(() => {
    theme = getStoredTheme();
  });

  function chooseTheme(next) {
    theme = next;
    setTheme(next);
  }

  // ── Preferences state ──────────────────────────────────────────────────────
  // Key/service inputs are write-only (user is typing); previews live on
  // data.settingsView.
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
  let searchProvider = $state(untrack(() => data.settingsView.search?.provider ?? ''));
  let assistantName  = $state(untrack(() => data.settingsView.assistantName ?? ''));

  // Inline remove-confirmation state (provider keys + service keys).
  let removingKey = $state({ anthropic: false, openai: false, openrouter: false });
  let removingService = $state({ tavily: false, pexels: false, stadia: false });

  // Save state for the configuration zone.
  let busy = $state(false);
  let savedOk = $state(false);
  let saveError = $state('');

  // Derived warning: anthropic-builtin requires the research slot to also be Anthropic.
  let researchProviderEffective = $derived(
    slots.research.provider || data.settingsView.slots.research?.provider || 'anthropic'
  );
  let searchProviderEffective = $derived(
    searchProvider || data.effectiveSearchProvider
  );
  let searchProviderWarning = $derived(
    searchProviderEffective === 'anthropic-builtin' && researchProviderEffective !== 'anthropic'
      ? `"anthropic-builtin" only works when the research slot uses anthropic. Currently set to "${researchProviderEffective}".`
      : ''
  );

  // Pristine tracking. The initial snapshot derives from data.settingsView
  // (kept in sync when /api/settings POST returns a fresh view), so it updates
  // after a successful save and the button re-disables when nothing is dirty.
  let prefsInitialJson = $derived(JSON.stringify({
    slots: {
      default: {
        provider: data.settingsView.slots.default?.provider ?? '',
        model: data.settingsView.slots.default?.model ?? '',
      },
      research: {
        provider: data.settingsView.slots.research?.provider ?? '',
        model: data.settingsView.slots.research?.model ?? '',
      },
    },
    searchProvider: data.settingsView.search?.provider ?? '',
    assistantName: data.settingsView.assistantName ?? '',
  }));
  let prefsCurrentJson = $derived(JSON.stringify({
    slots,
    searchProvider,
    assistantName,
  }));
  let prefsIsPristine = $derived(
    prefsCurrentJson === prefsInitialJson &&
    !keys.anthropic.trim() && !keys.openai.trim() && !keys.openrouter.trim() &&
    !services.tavily.trim() && !services.pexels.trim() && !services.stadia.trim()
  );

  // Feature health: only render the strip when something is failing.
  let failingFeatures = $derived(
    Object.entries(FEATURE_LABELS)
      .filter(([key]) => data.features?.[key] === false)
      .map(([key, label]) => ({ key, label }))
  );

  // ── Unsaved-changes guard ──────────────────────────────────────────────────
  beforeNavigate(({ cancel }) => {
    if (!prefsIsPristine) {
      const ok = confirm('You have unsaved configuration changes. Leave anyway?');
      if (!ok) cancel();
    }
  });

  // ── Provider/service remove ────────────────────────────────────────────────
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
        saveError = failureSentence('save_failed');
      } else {
        removingKey[provider] = false;
        const updated = await res.json();
        if (updated.settingsView) {
          data = { ...data, settingsView: updated.settingsView };
        }
        await invalidateAll();
      }
    } catch {
      saveError = failureSentence('network_error');
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
        saveError = failureSentence('save_failed');
      } else {
        removingService[service] = false;
        const updated = await res.json();
        if (updated.settingsView) {
          data = { ...data, settingsView: updated.settingsView };
        }
        await invalidateAll();
      }
    } catch {
      saveError = failureSentence('network_error');
    } finally {
      busy = false;
    }
  }

  // ── Save ───────────────────────────────────────────────────────────────────
  async function save() {
    if (busy) return;
    busy = true;
    savedOk = false;
    saveError = '';

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
        saveError = failureSentence('save_failed');
      } else {
        savedOk = true;
        keys = { anthropic: '', openai: '', openrouter: '' };
        services = { tavily: '', pexels: '', stadia: '' };
        const updated = await res.json();
        if (updated.settingsView) {
          data = { ...data, settingsView: updated.settingsView };
        }
        await invalidateAll();
      }
    } catch {
      saveError = failureSentence('network_error');
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head>
  <title>Configuration · Traverse</title>
</svelte:head>

<div class="page">
  <header>
    <div class="wordmark">
      <Logo variant="inverse" size={28} aria-hidden="true" />
      <h1><a href="/" class="back-link">Traverse</a></h1>
    </div>
    <SettingsSubnav current="configuration" />
  </header>

  <main>
    {#if failingFeatures.length > 0}
      <div class="health-strip" role="status">
        <span class="health-strip-icon" aria-hidden="true">!</span>
        <span class="health-strip-text">
          <strong>Some features unavailable:</strong>
          {#each failingFeatures as f, i (f.key)}
            {f.label}{i < failingFeatures.length - 1 ? ', ' : ''}
          {/each}.
          Add the missing keys below.
        </span>
      </div>
    {/if}

    <section class="settings-section">
      <h2>Configuration</h2>
      <p class="section-desc">Theme is stored on this device. Everything else (assistant name, provider keys, model slots, search backend) is saved to <code>settings.json</code>.</p>

      <div class="subsection">
        <span class="subsection-label">Personal</span>

        <div class="field-group">
          <div class="field">
            <span class="field-label">Theme</span>
            <p class="field-hint">"Match system" follows your OS dark-mode setting. Brochures always render in light mode for printing.</p>
            <div class="theme-options" role="radiogroup" aria-label="Theme">
              {#each [['system', 'Match system'], ['light', 'Light'], ['dark', 'Dark']] as [value, label]}
                <label class="theme-option" class:theme-option-active={theme === value}>
                  <input
                    type="radio"
                    name="theme"
                    value={value}
                    checked={theme === value}
                    onchange={() => chooseTheme(value)}
                  />
                  <span>{label}</span>
                </label>
              {/each}
            </div>
          </div>

          <div class="field">
            <label for="assistant-name" class="field-label">Assistant name</label>
            <p class="field-hint">Display name used wherever the trip-assistant chat is referenced ("Ask {data.effectiveAssistantName}", section headings). Leave blank to inherit from <code>.env</code>.</p>
            <input
              id="assistant-name"
              type="text"
              class="field-input"
              maxlength="60"
              placeholder={data.effectiveAssistantName}
              bind:value={assistantName}
            />
          </div>
        </div>
      </div>

      <div class="subsection">
        <span class="subsection-label">Model provider keys</span>
        <p class="field-hint">Keys can live in either <code>.env</code> or <code>settings.json</code>; values saved here override <code>.env</code> per key. The full key is never sent back to the browser after saving.</p>

        <div class="field-group">
          {#each PROVIDERS as provider}
            {@const current = data.settingsView.keys[provider]}
            <div class="field">
              <div class="field-label-row">
                <label for="key-{provider}" class="field-label">{PROVIDER_LABELS[provider]}</label>
                {#if current?.source === 'settings'}
                  <span class="badge badge-set">settings.json: {current.preview}</span>
                  {#if removingKey[provider]}
                    <span class="remove-confirm">
                      {#if current.envShadowed}
                        Remove? <code>.env</code> value <code>{current.envShadowed.preview}</code> will resume.
                      {:else}
                        Remove? No <code>.env</code> fallback, this provider becomes unconfigured.
                      {/if}
                      <button class="btn-confirm-yes" onclick={() => removeKey(provider)} disabled={busy}>Yes, remove</button>
                      <button class="btn-confirm-cancel" onclick={() => removingKey[provider] = false}>Cancel</button>
                    </span>
                  {:else}
                    <button class="btn-remove" onclick={() => removingKey[provider] = true}>Remove</button>
                  {/if}
                {:else if current?.source === 'env'}
                  <span class="badge badge-env">from .env: {current.preview}</span>
                {:else}
                  <span class="badge badge-unset">not set</span>
                {/if}
              </div>
              {#if current?.source === 'settings' && current.envShadowed}
                <p class="source-note">Overriding <code>.env</code> value <code>{current.envShadowed.preview}</code>.</p>
              {:else if current?.source === 'env'}
                <p class="source-note">Paste a key here to override the <code>.env</code> value.</p>
              {/if}
              <input
                id="key-{provider}"
                type="password"
                autocomplete="off"
                spellcheck="false"
                class="field-input field-input-code"
                placeholder={current?.isSet ? 'Paste new key to replace…' : 'Paste API key…'}
                bind:value={keys[provider]}
              />
            </div>
          {/each}
        </div>
      </div>

      <div class="subsection">
        <span class="subsection-label">Service keys</span>
        <p class="field-hint">Non-model integrations: search, photos, maps. Same overlay rules as provider keys.</p>

        <div class="field-group">
          {#each SERVICES as service}
            {@const current = data.settingsView.services?.[service]}
            <div class="field">
              <div class="field-label-row">
                <label for="service-{service}" class="field-label">{SERVICE_LABELS[service]}</label>
                {#if current?.source === 'settings'}
                  <span class="badge badge-set">settings.json: {current.preview}</span>
                  {#if removingService[service]}
                    <span class="remove-confirm">
                      {#if current.envShadowed}
                        Remove? <code>.env</code> value <code>{current.envShadowed.preview}</code> will resume.
                      {:else}
                        Remove? No <code>.env</code> fallback, this service becomes unconfigured.
                      {/if}
                      <button class="btn-confirm-yes" onclick={() => removeService(service)} disabled={busy}>Yes, remove</button>
                      <button class="btn-confirm-cancel" onclick={() => removingService[service] = false}>Cancel</button>
                    </span>
                  {:else}
                    <button class="btn-remove" onclick={() => removingService[service] = true}>Remove</button>
                  {/if}
                {:else if current?.source === 'env'}
                  <span class="badge badge-env">from .env: {current.preview}</span>
                {:else}
                  <span class="badge badge-unset">not set</span>
                {/if}
              </div>
              <p class="field-hint">{SERVICE_DESCRIPTIONS[service]}</p>
              {#if current?.source === 'settings' && current.envShadowed}
                <p class="source-note">Overriding <code>.env</code> value <code>{current.envShadowed.preview}</code>.</p>
              {:else if current?.source === 'env'}
                <p class="source-note">Paste a key here to override the <code>.env</code> value.</p>
              {/if}
              <input
                id="service-{service}"
                type="password"
                autocomplete="off"
                spellcheck="false"
                class="field-input field-input-code"
                placeholder={current?.isSet ? 'Paste new key to replace…' : 'Paste API key…'}
                bind:value={services[service]}
              />
            </div>
          {/each}
        </div>
      </div>

      <div class="subsection">
        <span class="subsection-label">Model slots</span>
        <p class="field-hint">Set the provider and model for each slot. Leave blank to keep the current value (from <code>.env</code> or a previous save).</p>

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
                  <option value="">(inherit from .env)</option>
                  {#each PROVIDERS as p}
                    <option value={p}>{PROVIDER_LABELS[p]}</option>
                  {/each}
                </select>
              </div>
              <div class="field">
                <label for="slot-{slotKey}-model" class="field-label">Model</label>
                <input
                  id="slot-{slotKey}-model"
                  type="text"
                  class="field-input field-input-code"
                  placeholder="e.g. claude-sonnet-4-6"
                  bind:value={slots[slotKey].model}
                />
              </div>
            </div>
          </div>
        {/each}
      </div>

      <div class="subsection">
        <span class="subsection-label">Environment-only configuration</span>
        <p class="field-hint">These knobs live only in <code>.env</code>, each has a reason it can't be UI-edited. See the configuration reference in <code>DEPLOY.md</code> for the full list.</p>

        <div class="field-group env-only-list">
          {#each data.envOnlyKnobs as knob (knob.name)}
            <div class="field env-only-row">
              <div class="field-label-row">
                <code class="field-label env-only-name">{knob.name}</code>
                <span class="badge {knob.isSet ? 'badge-env' : 'badge-unset'}">{knob.displayValue}</span>
              </div>
              <p class="field-hint">{knob.reason}</p>
            </div>
          {/each}
        </div>
      </div>

      <div class="subsection">
        <span class="subsection-label">Search backend</span>
        <p class="field-hint">Which backend to use for web search (today: Research/deepen). <code>anthropic-builtin</code> uses Anthropic's native search tool but only works when the Research slot is also Anthropic. <code>tavily</code> works with any provider but needs a Tavily key above.</p>

        <div class="slot-fields">
          <div class="field">
            <label for="search-provider" class="field-label">Provider</label>
            <select id="search-provider" class="field-select" bind:value={searchProvider}>
              <option value="">(inherit from .env: {data.effectiveSearchProvider})</option>
              {#each data.supportedSearchProviders as sp}
                <option value={sp}>{sp}</option>
              {/each}
            </select>
          </div>
        </div>
        {#if searchProviderWarning}
          <p class="field-warn">{searchProviderWarning}</p>
        {/if}
      </div>

      <div class="actions">
        <button class="btn btn-primary" onclick={save} disabled={busy || prefsIsPristine}>
          {busy ? 'Saving…' : 'Save configuration'}
        </button>
        {#if savedOk}
          <span class="feedback feedback-ok">Saved. Changes take effect on the next request.</span>
        {/if}
        {#if saveError}
          <span class="feedback feedback-err">{saveError}</span>
        {/if}
      </div>
    </section>
  </main>
</div>

<style>
  /* ── Page chrome ── */
  .page {
    min-height: 100vh;
    background: var(--surface-page);
    color: var(--text-primary);
    font-family: var(--font-sans);
  }

  header {
    background: var(--forest-800);
    color: var(--bone-200);
    padding: 0 24px;
    height: 52px;
    display: flex;
    align-items: center;
    gap: 16px;
    border-bottom: 1px solid var(--border-default);
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

  /* ── Main column ── */
  main {
    max-width: 720px;
    margin: 0 auto;
    padding: 32px 24px 96px;
  }

  /* ── Feature health strip ── */
  .health-strip {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 12px 16px;
    margin-bottom: 36px;
    background: var(--state-warning-surface);
    border: 1px solid var(--state-warning);
    border-radius: 6px;
    font-size: 13px;
    line-height: 1.5;
    color: var(--text-primary);
  }
  .health-strip-icon {
    flex-shrink: 0;
    width: 20px;
    height: 20px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: var(--state-warning);
    color: var(--text-inverse);
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 700;
    border-radius: 50%;
    line-height: 1;
  }
  .health-strip-text { flex: 1; }

  /* ── Section ── */
  h2 {
    font-family: var(--font-serif);
    font-size: 22px;
    font-weight: 400;
    font-style: italic;
    color: var(--text-primary);
    margin: 0 0 8px;
  }

  .section-desc {
    font-size: 13px;
    color: var(--text-secondary);
    margin: 0 0 28px;
    line-height: 1.55;
    max-width: 60ch;
  }

  /* Subsection eyebrows inside a section. */
  .subsection + .subsection { margin-top: 32px; }
  .subsection-label {
    display: block;
    font-family: var(--font-sans);
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-tertiary);
    margin-bottom: 14px;
  }

  /* ── Form primitives ── */
  .field-group {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .field-label-row {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }

  .field-label {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-primary);
  }

  .field-hint {
    font-size: 12px;
    color: var(--text-tertiary);
    margin: 0;
    line-height: 1.5;
    max-width: 65ch;
  }

  .field-warn {
    font-size: 13px;
    color: var(--state-warning);
    margin: 10px 0 0;
    line-height: 1.5;
  }

  code {
    font-family: var(--font-mono);
    font-size: 12px;
    background: var(--surface-sunken);
    padding: 1px 5px;
    border-radius: 3px;
  }

  /* Form inputs default to sans (prose register); code-y inputs opt into
     mono via .field-input-code. */
  .field-input,
  .field-select {
    background: var(--surface-raised);
    border: 1px solid var(--border-default);
    border-radius: 4px;
    padding: 10px 12px;
    font-family: var(--font-sans);
    font-size: 13px;
    color: var(--text-primary);
    width: 100%;
    box-sizing: border-box;
    transition: border-color 0.15s;
  }
  .field-input-code {
    font-family: var(--font-mono);
  }
  .field-input:focus-visible,
  .field-select:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
    border-color: var(--border-strong);
  }
  .field-input::placeholder {
    color: var(--text-tertiary);
  }

  /* ── Save actions ── */
  .actions {
    display: flex;
    align-items: center;
    gap: 16px;
    flex-wrap: wrap;
    margin-top: 36px;
  }
  .feedback {
    font-size: 12px;
    font-family: var(--font-mono);
  }
  .feedback-ok  { color: var(--state-success); }
  .feedback-err { color: var(--state-danger); }

  /* ── Remove + confirm ── */
  .btn-remove {
    font-size: 12px;
    font-family: var(--font-sans);
    padding: 6px 12px;
    border-radius: 4px;
    border: 1px solid var(--border-default);
    background: transparent;
    color: var(--text-tertiary);
    cursor: pointer;
    line-height: 1.4;
    min-height: 30px;
    transition: border-color 0.15s, color 0.15s;
  }
  .btn-remove:hover {
    border-color: var(--state-danger);
    color: var(--state-danger);
  }
  .btn-remove:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }
  .remove-confirm {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: var(--text-secondary);
  }
  .btn-confirm-yes,
  .btn-confirm-cancel {
    font-size: 12px;
    font-family: var(--font-sans);
    padding: 6px 12px;
    border-radius: 4px;
    cursor: pointer;
    line-height: 1.4;
    min-height: 30px;
    border: 1px solid transparent;
  }
  .btn-confirm-yes {
    background: var(--state-danger-surface);
    border-color: var(--state-danger);
    color: var(--state-danger);
    font-weight: 500;
  }
  .btn-confirm-yes:hover:not(:disabled) {
    background: color-mix(in oklab, var(--state-danger) 14%, transparent);
  }
  .btn-confirm-yes:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-confirm-cancel {
    background: transparent;
    border-color: var(--border-default);
    color: var(--text-tertiary);
  }
  .btn-confirm-cancel:hover {
    border-color: var(--border-strong);
    color: var(--text-secondary);
  }
  .btn-confirm-yes:focus-visible,
  .btn-confirm-cancel:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }

  /* ── Theme & radio chips ── */
  .theme-options {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    margin-top: 4px;
  }
  .theme-option {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 10px 14px;
    border: 1px solid var(--border-default);
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
    color: var(--text-secondary);
    min-height: 36px;
    transition: border-color 0.15s, color 0.15s, background-color 0.15s;
  }
  .theme-option:hover { border-color: var(--border-strong); }
  .theme-option-active {
    border-color: var(--accent);
    color: var(--text-primary);
    background: var(--surface-raised);
  }
  .theme-option input[type="radio"] {
    accent-color: var(--accent);
    margin: 0;
  }
  .theme-option:focus-within {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }

  /* ── Badges ── */
  .badge {
    font-size: 11px;
    font-family: var(--font-mono);
    padding: 3px 8px;
    border-radius: 3px;
    font-weight: 400;
    letter-spacing: 0.02em;
  }
  .badge-set {
    background: var(--state-success-surface);
    color: var(--state-success);
  }
  .badge-env {
    background: var(--surface-raised);
    color: var(--text-secondary);
    border: 1px solid var(--border-default);
  }
  .badge-unset {
    background: var(--surface-sunken);
    color: var(--text-tertiary);
  }

  .source-note {
    font-size: 12px;
    color: var(--text-tertiary);
    margin: 0;
    line-height: 1.5;
    font-style: italic;
    max-width: 65ch;
  }
  .source-note code {
    font-family: var(--font-mono);
    font-style: normal;
  }

  .env-only-list .env-only-row + .env-only-row { margin-top: 4px; }
  .env-only-name {
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 500;
    background: var(--surface-sunken);
    padding: 2px 6px;
    border-radius: 3px;
  }

  /* ── Slot fields ── */
  .slot-group + .slot-group { margin-top: 20px; }
  .slot-header {
    font-size: 12px;
    font-weight: 500;
    color: var(--text-secondary);
    margin-bottom: 8px;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--border-subtle);
  }
  .slot-fields {
    display: grid;
    grid-template-columns: 180px 1fr;
    gap: 12px;
  }

  /* ── Mobile ── */
  @media (max-width: 768px) {
    main {
      padding: 24px 16px 64px;
    }
    .slot-fields {
      grid-template-columns: 1fr;
    }
    .health-strip { font-size: 12px; }
  }
</style>

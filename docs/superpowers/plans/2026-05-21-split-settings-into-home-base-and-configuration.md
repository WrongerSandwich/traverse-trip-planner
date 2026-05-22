# Split Settings into Home Base and Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the 1732-line `/settings` page into two focused top-level routes: `/home-base` (edits `home.md`) and `/configuration` (edits `settings.json`), with a small tab-style sub-nav linking them and a `beforeNavigate` unsaved-changes guard on each.

**Architecture:** Two new top-level routes, each owning their own `+page.svelte` and `+page.server.js`. A small reusable `SettingsSubnav.svelte` component renders the tab strip in each page's forest-800 header. The old `/settings` route becomes a 308 redirect to `/home-base` so existing bookmarks keep working. Cross-section dirty advisory is removed (no longer applicable when sections live on separate pages); replaced by `beforeNavigate` confirm on each page when its own state is dirty.

**Tech Stack:** SvelteKit 2 (Svelte 5 runes), existing `vi.mock`-based config tests, existing playwright/vitest setup, no new dependencies.

---

## File Structure

**Create:**
- `src/lib/components/SettingsSubnav.svelte` — tab strip for the forest-800 header on both settings pages
- `src/routes/home-base/+page.svelte` — Home base form (city, vehicles, prose context)
- `src/routes/home-base/+page.server.js` — minimal loader (no settings.json data needed; home.md fetched client-side via `/api/home`)
- `src/routes/configuration/+page.svelte` — Theme + assistant name + provider keys + service keys + model slots + env-only knobs + search backend
- `src/routes/configuration/+page.server.js` — full settings loader (moved from `/settings/+page.server.js`)

**Modify:**
- `src/routes/+page.svelte` — 5 link updates (welcome banner CTA, pexels banner CTA, two AI-setup CTAs, footer link)
- `src/routes/onboarding/+page.svelte` — 3 muted text references pointing users to where they can edit home.md
- `src/routes/onboarding/+page.server.js` — 1 comment update
- `src/hooks.server.js` — startup banner mentions `/settings`

**Replace:**
- `src/routes/settings/+page.server.js` — gutted to a 308 redirect to `/home-base`

**Delete:**
- `src/routes/settings/+page.svelte`

**Shared CSS note:** Each new page duplicates the form-primitive CSS (`.field`, `.field-input`, `.subsection`, `.badge`, `.btn-remove`, etc.) from the original settings page. This matches the existing project convention of page-scoped CSS. A future refactor could extract a shared stylesheet; not in scope here.

---

## Task 1: Create SettingsSubnav component

**Files:**
- Create: `src/lib/components/SettingsSubnav.svelte`

- [ ] **Step 1: Write the component**

```svelte
<script>
  /** @type {{ current: 'home-base' | 'configuration' }} */
  let { current } = $props();
</script>

<nav class="settings-subnav" aria-label="Settings sections">
  <a
    href="/home-base"
    class:active={current === 'home-base'}
    aria-current={current === 'home-base' ? 'page' : undefined}
  >Home base</a>
  <a
    href="/configuration"
    class:active={current === 'configuration'}
    aria-current={current === 'configuration' ? 'page' : undefined}
  >Configuration</a>
</nav>

<style>
  .settings-subnav {
    display: flex;
    gap: 18px;
    margin-left: 16px;
  }
  .settings-subnav a {
    color: var(--bone-400);
    text-decoration: none;
    font-family: var(--font-sans);
    font-size: 14px;
    font-weight: 500;
    padding: 4px 0;
    border-bottom: 2px solid transparent;
    transition: color 0.15s, border-color 0.15s;
  }
  .settings-subnav a:hover {
    color: var(--bone-200);
  }
  .settings-subnav a.active {
    color: var(--bone-100);
    border-bottom-color: var(--accent);
  }
  .settings-subnav a:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
    border-radius: 2px;
  }
</style>
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run check`
Expected: 0 ERRORS, 0 WARNINGS (component compiles; not yet used anywhere).

- [ ] **Step 3: Commit**

```bash
git add src/lib/components/SettingsSubnav.svelte
git commit -m "feat(settings): add SettingsSubnav tab-strip component"
```

---

## Task 2: Create /configuration route

This task creates the new `/configuration` page by adapting the current settings page's "Preferences" section. We do this first (before `/home-base`) because the welcome banner CTA on the home page and the pexels banner CTA both need to land here, and because most of the existing `/settings/+page.server.js` loader logic moves here unchanged.

**Files:**
- Create: `src/routes/configuration/+page.server.js`
- Create: `src/routes/configuration/+page.svelte`
- Reference: `src/routes/settings/+page.svelte` (source of all extracted code) and `src/routes/settings/+page.server.js` (source loader)

- [ ] **Step 1: Create the server loader (copy from existing settings loader)**

Create `src/routes/configuration/+page.server.js` with the EXACT contents of `src/routes/settings/+page.server.js` (no changes; the loader stays the same):

```js
import { error } from '@sveltejs/kit';
import {
  readSettings,
  redactSettings,
  SUPPORTED_PROVIDERS,
  SUPPORTED_SEARCH_PROVIDERS,
} from '$lib/server/settings.js';
import { getFeatureAvailability, getEffectiveConfig } from '$lib/server/config.js';

// Env-only knobs the Settings UI surfaces as read-only. Each row has a reason
// it's not editable from the UI; the canonical full list lives in DEPLOY.md's
// "Configuration reference" section. The order here is the rendering order.
//
// Display modes:
//   - 'boolean'  — render "on" if any non-empty value is set, else "unset"
//   - 'secret'   — render "set" if non-empty, else "unset" (never echo the value)
//   - 'verbatim' — render the value as-is (no secrets)
const ENV_ONLY_KNOBS = [
  {
    name: 'TRAVERSE_DISABLE_SETTINGS_UI',
    display: 'boolean',
    reason: 'Trust boundary — disables this UI, so it must live in .env (otherwise the UI it disables could re-enable itself).',
  },
  {
    name: 'TRAVERSE_ALLOW_LAN_WRITES',
    display: 'boolean',
    reason: 'Auth gate for POST /api/settings and PUT /api/home. Opens config writes to non-loopback clients on a trusted LAN.',
  },
  {
    name: 'TRUST_PROXY_FOR_AUTH',
    display: 'boolean',
    reason: 'Trust the first hop of X-Forwarded-For when gating auth — set when running behind a reverse proxy that overwrites this header.',
  },
  {
    name: 'TRAVERSE_SHARE_SECRET',
    display: 'secret',
    reason: 'HMAC secret for public share links. Generate with `openssl rand -base64 32`; rotating it invalidates every existing link.',
  },
];

function describeEnvOnlyKnob(knob) {
  const raw = process.env[knob.name];
  const isSet = typeof raw === 'string' && raw.trim() !== '';
  let displayValue;
  if (!isSet) displayValue = 'unset';
  else if (knob.display === 'secret') displayValue = 'set';
  else if (knob.display === 'boolean') displayValue = 'on';
  else displayValue = raw;
  return { name: knob.name, isSet, displayValue, reason: knob.reason };
}

export function load() {
  if (process.env.TRAVERSE_DISABLE_SETTINGS_UI) {
    error(403, 'Settings UI is disabled on this server. Unset TRAVERSE_DISABLE_SETTINGS_UI to re-enable.');
  }

  const settings = readSettings();
  const effective = getEffectiveConfig();
  return {
    settingsView: redactSettings(settings),
    supportedProviders: SUPPORTED_PROVIDERS,
    supportedSearchProviders: SUPPORTED_SEARCH_PROVIDERS,
    features: getFeatureAvailability(),
    effectiveSearchProvider: effective.search.provider,
    effectiveAssistantName: effective.assistantName,
    envOnlyKnobs: ENV_ONLY_KNOBS.map(describeEnvOnlyKnob),
  };
}
```

- [ ] **Step 2: Create the configuration page**

Create `src/routes/configuration/+page.svelte`. The script and template extract the Preferences-related content from `src/routes/settings/+page.svelte`. Drop the home-base content, the cross-section dirty advisory, and rename the section title from "Preferences" to "Configuration".

Full file contents:

```svelte
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
    font-family: var(--font-sans);
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
```

Note: this template uses `.field-input-code` on the API key, service key, slot model, and the env-only name `<code>` chip — that's the [P2] mono/sans split from the critique. Prose-y inputs (assistant name) get the sans default.

- [ ] **Step 3: Run check and tests**

Run: `npm run check && npm test`
Expected: 0 errors, 0 warnings, 1117/1117 tests pass. (`/settings` still exists and works; `/configuration` is new but not yet linked anywhere except by direct URL.)

- [ ] **Step 4: Smoke test in browser**

Run: `npm run dev -- --port 3456` in one terminal, then visit `http://localhost:3456/configuration` in a browser.

Expected:
- Page loads. Header shows "Traverse" + tab strip with "Home base | Configuration", Configuration tab active (accent underline).
- "Configuration" h2 in italic serif.
- "Personal" subsection at the top with Theme radios and Assistant name input. Assistant name input uses SANS font (not mono).
- "Model provider keys" subsection with three rows. Key inputs use MONO font.
- "Service keys", "Model slots", "Environment-only configuration", "Search backend" subsections render.
- "Save configuration" button at the bottom, disabled while pristine.
- Health strip appears only if features are failing.

Stop the dev server (Ctrl+C).

- [ ] **Step 5: Commit**

```bash
git add src/routes/configuration/+page.server.js src/routes/configuration/+page.svelte
git commit -m "feat(settings): add /configuration route (theme + assistant + server config)"
```

---

## Task 3: Create /home-base route

**Files:**
- Create: `src/routes/home-base/+page.server.js`
- Create: `src/routes/home-base/+page.svelte`

- [ ] **Step 1: Create the minimal server loader**

Create `src/routes/home-base/+page.server.js`:

```js
import { error } from '@sveltejs/kit';
import { getFeatureAvailability } from '$lib/server/config.js';

// /home-base only needs feature availability for any future advisory; the
// home.md content is fetched client-side via /api/home (same pattern as the
// pre-split /settings page).
//
// The TRAVERSE_DISABLE_SETTINGS_UI gate also blocks home-base since
// PUT /api/home is the write path it disables.
export function load() {
  if (process.env.TRAVERSE_DISABLE_SETTINGS_UI) {
    error(403, 'Settings UI is disabled on this server. Unset TRAVERSE_DISABLE_SETTINGS_UI to re-enable.');
  }
  return {
    features: getFeatureAvailability(),
  };
}
```

- [ ] **Step 2: Create the home-base page**

Create `src/routes/home-base/+page.svelte`. This is the Home base section extracted from the old settings page, plus the sub-nav header.

Full file contents:

```svelte
<script>
  import { onMount } from 'svelte';
  import { beforeNavigate } from '$app/navigation';
  import Logo from '$lib/components/Logo.svelte';
  import LocationPicker from '$lib/components/LocationPicker.svelte';
  import SettingsSubnav from '$lib/components/SettingsSubnav.svelte';
  import { travelersToString, stringToTravelers } from '$lib/utils/homeForm.js';
  import { failureSentence } from '$lib/errors-registry.js';
  import {
    setDefaultVehicle,
    addVehicle,
    removeVehicle,
    updateVehicleField,
    validateVehicles,
  } from '$lib/utils/vehicleHelpers.js';

  let { data } = $props();

  // The home page sets `:global(html, body) { height: 100%; overflow: hidden }`
  // in its route stylesheet. SvelteKit doesn't unload route stylesheets on
  // client nav, so override with inline styles and restore on unmount.
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

  // ── Home base state ────────────────────────────────────────────────────────
  /** @type {'loading'|'missing'|'error'|'ready'} */
  let homeStatus = $state('loading');
  let homeSnapshot = $state(/** @type {null | {frontmatter: object, prose: object}} */ (null));
  let homeLoadError = $state('');

  let homeCity = $state('');
  let homeLat  = $state('');
  let homeLon  = $state('');
  let homeRadius = $state('');
  let homeTravelersStr = $state('');
  let homePetsNeedSitter = $state(false);
  let homeDistanceUnit = $state('mi');

  let homeFieldErrors = $state(/** @type {Record<string, string>} */ ({}));

  let homeBusy     = $state(false);
  let homeSavedOk  = $state(false);
  let homeSaveError = $state('');

  let homeVehicles = $state(/** @type {Record<string, object>} */ ({}));
  let newVehicleKey = $state('');
  let newVehicleType = $state('gas');
  let vehicleErrors = $state(/** @type {string[]} */ ([]));

  let removingVehicle = $state('');

  let homePreamble = $state('');
  let homeSections = $state(/** @type {Array<{heading: string, body: string}>} */ ([]));
  let showPreambleEditor = $state(false);

  let homePristine = $state('');
  let homeCurrentJson = $derived(JSON.stringify({
    homeCity,
    homeLat,
    homeLon,
    homeRadius,
    homeTravelersStr,
    homePetsNeedSitter,
    homeDistanceUnit,
    homeVehicles,
    homePreamble,
    homeSections,
  }));
  let homeIsPristine = $derived(homePristine !== '' && homeCurrentJson === homePristine);

  // Radius label tracks the chosen distance unit.
  let radiusLabel = $derived(`Default radius (${homeDistanceUnit})`);

  // ── Unsaved-changes guard ──────────────────────────────────────────────────
  beforeNavigate(({ cancel }) => {
    if (homeStatus === 'ready' && !homeIsPristine) {
      const ok = confirm('You have unsaved home base changes. Leave anyway?');
      if (!ok) cancel();
    }
  });

  onMount(async () => {
    try {
      const res = await fetch('/api/home');
      if (!res.ok) {
        if (res.status === 404) {
          homeStatus = 'missing';
        } else {
          homeStatus = 'error';
          homeLoadError = failureSentence('save_failed');
        }
        return;
      }
      const body = await res.json();
      homeSnapshot = body;

      const fm = body.frontmatter ?? {};
      homeCity = fm.home_city ?? '';
      homeLat  = fm.home_coords?.[0] != null ? String(fm.home_coords[0]) : '';
      homeLon  = fm.home_coords?.[1] != null ? String(fm.home_coords[1]) : '';
      homeRadius = fm.default_radius_mi != null ? String(fm.default_radius_mi) : '';
      homeTravelersStr = travelersToString(fm.travelers ?? []);
      homePetsNeedSitter = fm.pets_need_sitter ?? false;
      homeDistanceUnit = fm.units?.distance ?? 'mi';
      homeVehicles = JSON.parse(JSON.stringify(fm.vehicles ?? {}));
      homePreamble = body.prose?.preamble ?? '';
      homeSections = JSON.parse(JSON.stringify(body.prose?.sections ?? []));

      homePristine = JSON.stringify({
        homeCity, homeLat, homeLon, homeRadius, homeTravelersStr,
        homePetsNeedSitter, homeDistanceUnit, homeVehicles,
        homePreamble, homeSections,
      });
      homeStatus = 'ready';
    } catch {
      homeStatus = 'error';
      homeLoadError = failureSentence('network_error');
    }
  });

  // ── Vehicle handlers ───────────────────────────────────────────────────────
  function handleVehicleField(key, field, value) {
    homeVehicles = updateVehicleField(homeVehicles, key, field, value);
    homeSavedOk = false;
    vehicleErrors = [];
  }
  function handleSetDefault(key) {
    homeVehicles = setDefaultVehicle(homeVehicles, key);
    homeSavedOk = false;
    vehicleErrors = [];
  }
  function handleAddVehicle() {
    const key = newVehicleKey.trim().toLowerCase();
    if (!key || !/^[a-z0-9][a-z0-9-]*$/.test(key) || key in homeVehicles) return;
    homeVehicles = addVehicle(homeVehicles, key, { type: newVehicleType });
    newVehicleKey = '';
    newVehicleType = 'gas';
    homeSavedOk = false;
    vehicleErrors = [];
  }
  function confirmRemoveVehicle(key) {
    homeVehicles = removeVehicle(homeVehicles, key);
    homeSavedOk = false;
    vehicleErrors = [];
    removingVehicle = '';
  }

  // ── Save ───────────────────────────────────────────────────────────────────
  async function saveHome() {
    if (homeBusy || !homeSnapshot) return;

    const vErrors = validateVehicles(homeVehicles);
    if (vErrors.length > 0) {
      vehicleErrors = vErrors;
      return;
    }
    vehicleErrors = [];

    homeBusy = true;
    homeSavedOk = false;
    homeSaveError = '';
    homeFieldErrors = {};

    const updatedFrontmatter = {
      ...homeSnapshot.frontmatter,
      home_city: homeCity.trim(),
      home_coords: [Number(homeLat), Number(homeLon)],
      default_radius_mi: homeRadius === '' ? undefined : Number(homeRadius),
      travelers: stringToTravelers(homeTravelersStr),
      vehicles: homeVehicles,
      pets_need_sitter: homePetsNeedSitter,
      units: {
        ...(homeSnapshot.frontmatter.units ?? {}),
        distance: homeDistanceUnit,
      },
    };
    if (updatedFrontmatter.default_radius_mi === undefined) {
      delete updatedFrontmatter.default_radius_mi;
    }

    const payload = {
      frontmatter: updatedFrontmatter,
      prose: { preamble: homePreamble, sections: homeSections },
    };

    try {
      const res = await fetch('/api/home', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const respBody = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = respBody.error ?? '';
        if (msg.toLowerCase().includes('home_city')) {
          homeFieldErrors = { ...homeFieldErrors, home_city: msg };
        } else if (msg.toLowerCase().includes('home_coords')) {
          homeFieldErrors = { ...homeFieldErrors, home_coords: msg };
        } else {
          homeSaveError = failureSentence('save_failed');
        }
      } else {
        homeSavedOk = true;
        homeSnapshot = {
          ...homeSnapshot,
          frontmatter: updatedFrontmatter,
          prose: { preamble: homePreamble, sections: homeSections },
        };
        homePristine = homeCurrentJson;
      }
    } catch {
      homeSaveError = failureSentence('network_error');
    } finally {
      homeBusy = false;
    }
  }
</script>

<svelte:head>
  <title>Home base · Traverse</title>
</svelte:head>

<div class="page">
  <header>
    <div class="wordmark">
      <Logo variant="inverse" size={28} aria-hidden="true" />
      <h1><a href="/" class="back-link">Traverse</a></h1>
    </div>
    <SettingsSubnav current="home-base" />
  </header>

  <main>
    <section class="settings-section">
      <h2>Home base</h2>
      <p class="section-desc">Your home, vehicles, and the prose context the planner reads on every seed, research, and chat call. Saved to <code>home.md</code>.</p>

      {#if homeStatus === 'loading'}
        <p class="field-hint">Loading…</p>
      {:else if homeStatus === 'missing'}
        <div class="empty-state">
          <p class="empty-state-title">home.md isn't set up yet.</p>
          <p class="empty-state-body">The planner needs a home base before it can suggest trips. Set one up to enable seed, research, and chat.</p>
          <a href="/onboarding" class="btn btn-primary">Create from template</a>
        </div>
      {:else if homeStatus === 'error'}
        <p class="field-warn">{homeLoadError}</p>
      {:else}
        <div class="subsection">
          <span class="subsection-label">Location</span>
          <div class="field-group">
            <div class="field">
              <label for="home-city" class="field-label">Home city</label>
              <input
                id="home-city"
                type="text"
                class="field-input"
                class:field-input-error={!!homeFieldErrors.home_city}
                placeholder="e.g. Cleveland, OH"
                bind:value={homeCity}
                oninput={() => { homeFieldErrors = { ...homeFieldErrors, home_city: '' }; homeSavedOk = false; }}
              />
              {#if homeFieldErrors.home_city}
                <p class="field-error">{homeFieldErrors.home_city}</p>
              {/if}
            </div>

            <div class="field">
              <LocationPicker
                bind:city={homeCity}
                bind:lat={homeLat}
                bind:lon={homeLon}
                label="Home coordinates"
              />
              {#if homeFieldErrors.home_coords}
                <p class="field-error">{homeFieldErrors.home_coords}</p>
              {/if}
            </div>

            <div class="row-2">
              <div class="field">
                <label for="home-radius" class="field-label">{radiusLabel}</label>
                <input
                  id="home-radius"
                  type="number"
                  min="0"
                  step="1"
                  class="field-input field-input-narrow field-input-code"
                  placeholder="450"
                  bind:value={homeRadius}
                  oninput={() => { homeSavedOk = false; }}
                />
              </div>

              <div class="field">
                <span class="field-label">Distance units</span>
                <div class="radio-row" role="radiogroup" aria-label="Distance units">
                  {#each [['mi', 'Miles'], ['km', 'Kilometers']] as [value, label]}
                    <label class="radio-option" class:radio-option-active={homeDistanceUnit === value}>
                      <input
                        type="radio"
                        name="home-distance-unit"
                        {value}
                        checked={homeDistanceUnit === value}
                        onchange={() => { homeDistanceUnit = value; homeSavedOk = false; }}
                      />
                      <span>{label}</span>
                    </label>
                  {/each}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="subsection">
          <span class="subsection-label">Travelers &amp; vehicles</span>
          <div class="field-group">
            <div class="field">
              <label for="home-travelers" class="field-label">Travelers</label>
              <input
                id="home-travelers"
                type="text"
                class="field-input"
                placeholder="alex, sam"
                bind:value={homeTravelersStr}
                oninput={() => { homeSavedOk = false; }}
              />
              <p class="field-hint">Comma-separated names. Used when seeding ideas and checking logistics.</p>
            </div>

            <div class="field">
              <label class="checkbox-row">
                <input
                  type="checkbox"
                  bind:checked={homePetsNeedSitter}
                  onchange={() => { homeSavedOk = false; }}
                />
                <span class="checkbox-label">Pets need a sitter for overnight trips</span>
              </label>
            </div>

            <div class="field vehicles-block">
              <span class="field-label">Vehicles</span>
              <p class="field-hint">Each trip uses the default unless overridden with <code>vehicle: &lt;key&gt;</code> in its frontmatter. EV trips use <code>range_mi</code> and <code>dc_fast_charge_kw</code> to plan charging stops.</p>

              {#if Object.keys(homeVehicles).length === 0}
                <p class="field-warn">No vehicles configured. Add at least one below.</p>
              {/if}

              {#each Object.entries(homeVehicles) as [key, v] (key)}
                <div class="vehicle-card">
                  <div class="vehicle-header">
                    <span class="vehicle-key-wrap">
                      <span class="vehicle-key-text">{key}</span>
                      <span class="vehicle-key-note">key is permanent; remove and re-add to rename</span>
                    </span>
                    <label class="default-radio" class:default-radio-active={v.default}>
                      <input
                        type="radio"
                        name="default-vehicle"
                        checked={v.default}
                        onchange={() => handleSetDefault(key)}
                      />
                      <span>Default</span>
                    </label>
                    {#if removingVehicle === key}
                      <span class="remove-confirm">
                        Remove?
                        <button class="btn-confirm-yes" onclick={() => confirmRemoveVehicle(key)}>Yes, remove</button>
                        <button class="btn-confirm-cancel" onclick={() => removingVehicle = ''}>Cancel</button>
                      </span>
                    {:else}
                      <button
                        type="button"
                        class="btn-remove btn-remove-vehicle"
                        aria-label="Remove vehicle {key}"
                        onclick={() => removingVehicle = key}
                      >Remove</button>
                    {/if}
                  </div>

                  <div class="vehicle-fields">
                    <div class="field">
                      <label for="vehicle-model-{key}" class="field-label">Model</label>
                      <input
                        id="vehicle-model-{key}"
                        type="text"
                        class="field-input"
                        placeholder="e.g. 2019 Toyota RAV4"
                        value={v.model ?? ''}
                        oninput={(e) => handleVehicleField(key, 'model', e.currentTarget.value)}
                      />
                    </div>

                    <div class="field">
                      <span class="field-label">Type</span>
                      <div class="radio-row" role="radiogroup" aria-label="Vehicle type">
                        {#each [['gas', 'Gas'], ['ev', 'Electric']] as [value, label]}
                          <label class="radio-option" class:radio-option-active={v.type === value}>
                            <input
                              type="radio"
                              name="vehicle-type-{key}"
                              {value}
                              checked={v.type === value}
                              onchange={() => handleVehicleField(key, 'type', value)}
                            />
                            <span>{label}</span>
                          </label>
                        {/each}
                      </div>
                    </div>

                    {#if v.type === 'ev'}
                      <div class="row-2">
                        <div class="field">
                          <label for="vehicle-range-{key}" class="field-label">EPA range (mi)</label>
                          <input
                            id="vehicle-range-{key}"
                            type="number"
                            min="0"
                            step="1"
                            class="field-input field-input-narrow field-input-code"
                            placeholder="247"
                            value={v.range_mi ?? ''}
                            oninput={(e) => handleVehicleField(key, 'range_mi', e.currentTarget.value === '' ? null : Number(e.currentTarget.value))}
                          />
                        </div>
                        <div class="field">
                          <label for="vehicle-kw-{key}" class="field-label">DC fast-charge (kW)</label>
                          <input
                            id="vehicle-kw-{key}"
                            type="number"
                            min="0"
                            step="1"
                            class="field-input field-input-narrow field-input-code"
                            placeholder="55"
                            value={v.dc_fast_charge_kw ?? ''}
                            oninput={(e) => handleVehicleField(key, 'dc_fast_charge_kw', e.currentTarget.value === '' ? null : Number(e.currentTarget.value))}
                          />
                        </div>
                      </div>
                    {/if}

                    <div class="field">
                      <label for="vehicle-notes-{key}" class="field-label">Notes</label>
                      <textarea
                        id="vehicle-notes-{key}"
                        class="field-input"
                        rows="2"
                        placeholder="Anything trip-relevant: cargo, towing, charging quirks."
                        value={v.notes ?? ''}
                        oninput={(e) => handleVehicleField(key, 'notes', e.currentTarget.value)}
                      ></textarea>
                    </div>
                  </div>
                </div>
              {/each}

              <div class="vehicle-add">
                <input
                  type="text"
                  class="field-input field-input-narrow field-input-code"
                  placeholder="key (e.g. rav4)"
                  bind:value={newVehicleKey}
                />
                <div class="radio-row" role="radiogroup" aria-label="New vehicle type">
                  {#each [['gas', 'Gas'], ['ev', 'Electric']] as [value, label]}
                    <label class="radio-option" class:radio-option-active={newVehicleType === value}>
                      <input
                        type="radio"
                        name="new-vehicle-type"
                        {value}
                        checked={newVehicleType === value}
                        onchange={() => { newVehicleType = value; }}
                      />
                      <span>{label}</span>
                    </label>
                  {/each}
                </div>
                <button
                  type="button"
                  class="btn btn-secondary"
                  disabled={!newVehicleKey.trim() || !/^[a-z0-9][a-z0-9-]*$/.test(newVehicleKey.trim().toLowerCase()) || (newVehicleKey.trim().toLowerCase() in homeVehicles)}
                  onclick={handleAddVehicle}
                >Add vehicle</button>
              </div>

              {#if vehicleErrors.length > 0}
                <ul class="field-error-list">
                  {#each vehicleErrors as err}
                    <li>{err}</li>
                  {/each}
                </ul>
              {/if}
            </div>
          </div>
        </div>

        <div class="subsection">
          <span class="subsection-label">Personal context</span>
          <p class="field-hint">Prose sections from <code>home.md</code>. These get fed to the LLM as context on every seed, research, and chat call. Headings are fixed; bodies are free-form markdown.</p>

          {#if homeSections.length === 0}
            <p class="field-warn">No prose sections in this <code>home.md</code> yet. Add some <code>##&nbsp;Heading</code> blocks below the frontmatter to see them here.</p>
          {/if}

          {#each homeSections as section, i (section.heading + '::' + i)}
            <div class="prose-section">
              <label class="prose-heading" for="prose-section-{i}">## {section.heading}</label>
              <textarea
                id="prose-section-{i}"
                class="field-input prose-textarea"
                rows="6"
                bind:value={homeSections[i].body}
                oninput={() => { homeSavedOk = false; }}
              ></textarea>
            </div>
          {/each}

          <details class="prose-advanced" bind:open={showPreambleEditor}>
            <summary>Advanced: file intro (text before the first <code>##</code> heading)</summary>
            <textarea
              class="field-input prose-textarea"
              rows="4"
              bind:value={homePreamble}
              oninput={() => { homeSavedOk = false; }}
            ></textarea>
            <p class="field-hint">Most users won't touch this. The default is a one-line "# Personal context for trip planning" title plus a sentence of context.</p>
          </details>
        </div>

        <div class="actions">
          <button
            class="btn btn-primary"
            onclick={saveHome}
            disabled={homeBusy || homeIsPristine}
          >
            {homeBusy ? 'Saving…' : 'Save home base'}
          </button>
          {#if homeSavedOk}
            <span class="feedback feedback-ok">Saved.</span>
          {/if}
          {#if homeSaveError}
            <span class="feedback feedback-err">{homeSaveError}</span>
          {/if}
        </div>
      {/if}
    </section>
  </main>
</div>

<style>
  /* ── Page chrome (duplicated from /configuration; see plan note) ── */
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

  /* Subsections inside a section. */
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

  .row-2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    align-items: end;
  }

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
    font-family: var(--font-sans);
  }
  .field-input-narrow { max-width: 180px; }
  .field-input-error { border-color: var(--state-danger); }
  .field-error {
    font-size: 12px;
    color: var(--state-danger);
    margin: 4px 0 0;
    line-height: 1.5;
  }
  .field-error-list {
    list-style: disc inside;
    padding: 0;
    margin: 12px 0 0;
    font-size: 12px;
    color: var(--state-danger);
  }
  .field-error-list li { line-height: 1.5; }

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

  /* ── Empty state ── */
  .empty-state {
    padding: 40px 24px;
    border: 1px dashed var(--border-default);
    border-radius: 6px;
    background: var(--surface-raised);
    text-align: center;
  }
  .empty-state-title {
    font-family: var(--font-serif);
    font-style: italic;
    font-size: 18px;
    margin: 0 0 8px;
    color: var(--text-primary);
  }
  .empty-state-body {
    font-size: 13px;
    color: var(--text-secondary);
    margin: 0 auto 20px;
    line-height: 1.5;
    max-width: 50ch;
  }

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
  .btn-remove-vehicle { margin-left: auto; }
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

  /* ── Radio chips ── */
  .radio-row {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    margin-top: 4px;
  }
  .radio-option {
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
  .radio-option:hover { border-color: var(--border-strong); }
  .radio-option-active {
    border-color: var(--accent);
    color: var(--text-primary);
    background: var(--surface-raised);
  }
  .radio-option input[type="radio"] {
    accent-color: var(--accent);
    margin: 0;
  }
  .radio-option:focus-within {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }

  /* ── Checkbox ── */
  .checkbox-row {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    cursor: pointer;
    margin-top: 2px;
  }
  .checkbox-row input[type="checkbox"] {
    accent-color: var(--accent);
    width: 16px;
    height: 16px;
    margin: 0;
    cursor: pointer;
  }
  .checkbox-label {
    font-size: 13px;
    color: var(--text-primary);
  }

  /* ── Vehicles ── */
  .vehicles-block { margin-top: 6px; }
  .vehicle-card {
    border: 1px solid var(--border-default);
    border-radius: 6px;
    padding: 14px 16px;
    margin-top: 12px;
    background: var(--surface-page);
  }
  .vehicle-header {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 12px;
    flex-wrap: wrap;
  }
  .vehicle-key-wrap {
    display: inline-flex;
    flex-direction: column;
    gap: 2px;
  }
  .vehicle-key-text {
    font-family: var(--font-mono);
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
    background: var(--surface-raised);
    padding: 2px 8px;
    border-radius: 3px;
    align-self: flex-start;
  }
  .vehicle-key-note {
    font-family: var(--font-sans);
    font-size: 10px;
    font-weight: 400;
    color: var(--text-tertiary);
    letter-spacing: 0.02em;
  }
  .default-radio {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 12px;
    border: 1px solid var(--border-default);
    border-radius: 4px;
    font-size: 12px;
    color: var(--text-secondary);
    cursor: pointer;
    min-height: 32px;
    transition: border-color 0.15s, color 0.15s, background-color 0.15s;
  }
  .default-radio:hover { border-color: var(--border-strong); }
  .default-radio-active {
    border-color: var(--accent);
    color: var(--text-primary);
    background: var(--surface-raised);
  }
  .default-radio input[type="radio"] {
    accent-color: var(--accent);
    margin: 0;
  }
  .vehicle-fields {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .vehicle-add {
    display: flex;
    align-items: flex-end;
    gap: 12px;
    margin-top: 16px;
    flex-wrap: wrap;
  }

  /* ── Prose editor ── */
  .prose-section { margin-top: 16px; }
  .prose-heading {
    display: block;
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-tertiary);
    margin-bottom: 4px;
  }
  .prose-textarea {
    font-family: var(--font-mono);
    font-size: 13px;
    line-height: 1.55;
    resize: vertical;
    min-height: 96px;
  }
  .prose-advanced {
    margin-top: 20px;
    padding: 12px 14px;
    border: 1px dashed var(--border-default);
    border-radius: 4px;
    background: var(--surface-page);
  }
  .prose-advanced summary {
    font-size: 12px;
    color: var(--text-secondary);
    cursor: pointer;
    user-select: none;
  }
  .prose-advanced[open] summary { margin-bottom: 10px; }

  /* ── Mobile ── */
  @media (max-width: 768px) {
    main {
      padding: 24px 16px 64px;
    }
    .row-2 {
      grid-template-columns: 1fr;
    }
    .vehicle-header { gap: 8px; }
    .btn-remove-vehicle { margin-left: 0; }
  }
</style>
```

Two things changed from the prior settings.svelte source:
- The vehicle key note copy: "slug can't be renamed" → "key is permanent; remove and re-add to rename" (less jargon)
- The prose textarea + radius/range/kw inputs use `.field-input-code` for mono (numeric/code values); other inputs (Home city, Travelers, vehicle Model, vehicle Notes) get sans default per the critique's [P2] split.

- [ ] **Step 3: Run check and tests**

Run: `npm run check && npm test`
Expected: 0 errors, 0 warnings, 1117/1117 tests pass.

- [ ] **Step 4: Smoke test in browser**

Run: `npm run dev -- --port 3456`, visit `http://localhost:3456/home-base`.

Expected:
- Header: "Traverse" + tab strip with Home base tab active.
- "Home base" h2 in italic serif.
- All four subsections render (Location, Travelers & vehicles, Personal context).
- Home city input uses SANS font; radius input uses MONO.
- "Save home base" button at bottom, disabled while pristine.
- If home.md is missing: empty-state CTA pointing to /onboarding.

Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add src/routes/home-base/+page.server.js src/routes/home-base/+page.svelte
git commit -m "feat(settings): add /home-base route (city, vehicles, prose context)"
```

---

## Task 4: Replace /settings with 308 redirect

**Files:**
- Modify: `src/routes/settings/+page.server.js`
- Delete: `src/routes/settings/+page.svelte`

- [ ] **Step 1: Replace the server loader with a redirect**

Overwrite `src/routes/settings/+page.server.js` with:

```js
import { redirect } from '@sveltejs/kit';

// /settings was split into /home-base and /configuration. This 308 keeps
// existing bookmarks and external links working; the more-frequently-edited
// page (home-base) is the redirect target. From there the SettingsSubnav
// gives one-click access to /configuration.
export function load() {
  redirect(308, '/home-base');
}
```

- [ ] **Step 2: Delete the old page component**

Run: `git rm src/routes/settings/+page.svelte`
Expected: file deleted.

- [ ] **Step 3: Run check and tests**

Run: `npm run check && npm test`
Expected: 0 errors, 0 warnings, 1117/1117 tests pass.

- [ ] **Step 4: Smoke test the redirect**

Run: `npm run dev -- --port 3456`, visit `http://localhost:3456/settings`.

Expected: browser address bar lands on `http://localhost:3456/home-base`. The Home base page renders.

Also: visit `http://localhost:3456/settings#server-config`. Browser ends up on `/home-base` (the hash gets dropped by the redirect; we'll fix the inbound links to point at `/configuration` directly in Task 5). 

Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add src/routes/settings/+page.server.js
git commit -m "feat(settings): replace /settings with 308 redirect to /home-base"
```

---

## Task 5: Update inbound links

**Files:**
- Modify: `src/routes/+page.svelte` (5 edits)
- Modify: `src/routes/onboarding/+page.svelte` (3 edits)
- Modify: `src/routes/onboarding/+page.server.js` (1 edit)
- Modify: `src/hooks.server.js` (1 edit)

- [ ] **Step 1: Update home page welcome banner**

In `src/routes/+page.svelte`, find the welcome banner around line 625 and update:

Before:
```svelte
Two ways: open the <a href="/settings#server-config" class="welcome-banner-link">Settings page</a> and paste a key, or edit
```

After:
```svelte
Two ways: open the <a href="/configuration" class="welcome-banner-link">configuration page</a> and paste a key, or edit
```

- [ ] **Step 2: Update home page pexels banner CTA**

In `src/routes/+page.svelte` around line 643:

Before:
```svelte
<a class="pexels-banner-cta" href="/settings#server-config">Open settings →</a>
```

After:
```svelte
<a class="pexels-banner-cta" href="/configuration">Open configuration →</a>
```

- [ ] **Step 3: Update home page AI-setup CTAs**

In `src/routes/+page.svelte` around line 702 and line 750:

Before (line 702):
```svelte
<a class="ai-setup-cta" href="/settings#server-config">
```

After:
```svelte
<a class="ai-setup-cta" href="/configuration">
```

Before (line 750):
```svelte
<a class="ai-partial-cta" href="/settings#server-config" title="Some AI features are unavailable until configured">
```

After:
```svelte
<a class="ai-partial-cta" href="/configuration" title="Some AI features are unavailable until configured">
```

- [ ] **Step 4: Update home page footer link**

In `src/routes/+page.svelte` around line 1060:

Before:
```svelte
<a href="/settings" class="footer-link">Settings</a>
```

After:
```svelte
<a href="/home-base" class="footer-link">Home base</a>
```

- [ ] **Step 5: Update onboarding muted text**

In `src/routes/onboarding/+page.svelte` make three edits:

Line ~312:
Before:
```svelte
<p class="muted">You can edit any of this later under <code>/settings</code> or by opening <code>home.md</code> directly.</p>
```

After:
```svelte
<p class="muted">You can edit any of this later under <code>/home-base</code> or by opening <code>home.md</code> directly.</p>
```

Line ~359:
Before:
```svelte
<p class="muted">Just one vehicle to start. You can add more later from <code>/settings</code>.</p>
```

After:
```svelte
<p class="muted">Just one vehicle to start. You can add more later from <code>/home-base</code>.</p>
```

Line ~448:
Before:
```svelte
<p class="muted">This is exactly what will land in <code>home.md</code>. You can edit any of this later under <code>/settings</code>.</p>
```

After:
```svelte
<p class="muted">This is exactly what will land in <code>home.md</code>. You can edit any of this later under <code>/home-base</code>.</p>
```

- [ ] **Step 6: Update onboarding server comment**

In `src/routes/onboarding/+page.server.js` around line 7:

Before:
```js
  // their configured home.md by accident. Editing lives at /settings.
```

After:
```js
  // their configured home.md by accident. Editing lives at /home-base.
```

- [ ] **Step 7: Update hooks.server.js startup banner**

In `src/hooks.server.js` around line 123:

Before:
```js
    const tail = info.ok ? '' : ' (unavailable — configure in .env or /settings)';
```

After:
```js
    const tail = info.ok ? '' : ' (unavailable — configure in .env or /configuration)';
```

- [ ] **Step 8: Confirm no other /settings references remain**

Run: `grep -rn "/settings" src/ --include="*.svelte" --include="*.js"`

Expected output: only matches in `src/routes/settings/+page.server.js` (the redirect itself), `src/lib/server/settings.js` (different module — not a route), `src/routes/api/settings/+server.js` (API endpoint, stays unchanged), `src/routes/api/stadia-map/+server.js` import, and other `$lib/server/settings.js` imports. No remaining route-style `/settings` href or `/settings#…` references in pages.

Quick check: grep for `href="/settings"` or `href='/settings'`:
```bash
grep -rn 'href="/settings\|href=.\/settings' src/ --include="*.svelte"
```
Expected: empty.

- [ ] **Step 9: Run check, tests, build**

Run: `npm run check && npm test && npm run build`
Expected: 0 errors, 0 warnings, 1117/1117 tests pass, build clean.

- [ ] **Step 10: Smoke test inbound paths in browser**

Run: `npm run dev -- --port 3456`.

Visit each in order:
1. `http://localhost:3456/` — confirm the footer link reads "Home base" and clicking it lands on `/home-base`.
2. If the welcome banner is visible (no AI keys configured), confirm its "configuration page" link goes to `/configuration` directly (no hash redirect).
3. If pexels isn't configured, confirm the "Open configuration →" link works.
4. `http://localhost:3456/onboarding` — confirm muted text references `/home-base` not `/settings`.

Stop the dev server.

- [ ] **Step 11: Commit**

```bash
git add src/routes/+page.svelte src/routes/onboarding/+page.svelte src/routes/onboarding/+page.server.js src/hooks.server.js
git commit -m "feat(settings): repoint all /settings inbound links to /home-base or /configuration"
```

---

## Task 6: Final verification

- [ ] **Step 1: Full verify suite**

Run: `npm run verify` (the project's canonical go/no-go: svelte-check + tests + build).

Expected: clean. All three phases pass.

- [ ] **Step 2: Manual smoke test of the unsaved-changes guard**

Run: `npm run dev -- --port 3456`.

1. Open `/home-base`. Type something into "Home city" (or any input). The "Save home base" button should become enabled.
2. Click the "Configuration" tab in the sub-nav (top of page).
3. Expected: browser confirm dialog asks "You have unsaved home base changes. Leave anyway?"
4. Click "Cancel" — stays on /home-base.
5. Click the tab again, confirm "OK" this time — navigates to /configuration. Original change is lost (expected).
6. On /configuration, type into "Assistant name" or change a slot. Click "Home base" sub-nav tab.
7. Expected: confirm dialog with "configuration" copy.

If any step fails, fix and re-test before proceeding.

- [ ] **Step 3: Verify the 308 redirect**

In the browser, navigate to `http://localhost:3456/settings`. Confirm the address bar updates to `/home-base` and the page renders.

In a fresh tab, navigate to `http://localhost:3456/settings#server-config`. Confirm the address bar updates to `/home-base` (the hash is stripped by redirect, but inbound code links now point at `/configuration` directly, so this only affects external/bookmarked URLs).

Stop the dev server.

- [ ] **Step 4: Push**

```bash
git push
```

Confirm the push succeeded.

---

## Self-Review Notes

Done as part of plan authoring:

**Spec coverage:** Each of the user's 8 settled decisions has a task:
1. Split into two routes → Tasks 2, 3
2. Home base + Configuration naming → Tasks 2, 3 (page titles + h2s + sub-nav labels)
3. Top-level URLs (`/home-base`, `/configuration`) → Tasks 2, 3
4. Tab strip sub-nav at top of each page → Task 1
5. Footer link points at `/home-base` → Task 5, Step 4
6. Empty-state flow unchanged (/onboarding) → Task 3, Step 2 (preserved verbatim)
7. `beforeNavigate` unsaved-changes guard on each page → Tasks 2 and 3 inline; verified Task 6 Step 2
8. Theme + Assistant name on /configuration in their own "Personal" subsection → Task 2, Step 2 (rendered first inside the section)

**[P2] mono/sans input split** from the prior critique is also addressed (Task 2 introduces `.field-input` defaulting to sans + `.field-input-code` for mono; both new pages use the split consistently).

**Placeholder scan:** every step has either exact code or exact commands. No "TBD" / "similar to" / "etc." remaining.

**Type consistency:** the `data` shape passed to each new page matches its loader return. `data.settingsView`, `data.envOnlyKnobs`, etc. flow through `/configuration` unchanged from the old `/settings`. `/home-base` only consumes `data.features` (and even that is optional — used only by a removed health-strip; if needed, can be threaded later).

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-21-split-settings-into-home-base-and-configuration.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?

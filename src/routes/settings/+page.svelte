<script>
  import { onMount, untrack } from 'svelte';
  import Logo from '$lib/components/Logo.svelte';
  import LocationPicker from '$lib/components/LocationPicker.svelte';
  import ConfirmModal from '$lib/components/ConfirmModal.svelte';
  import { getStoredTheme, setTheme } from '$lib/theme.js';
  import { travelersToString, stringToTravelers } from '$lib/utils/homeForm.js';
  import {
    setDefaultVehicle,
    addVehicle,
    removeVehicle,
    updateVehicleField,
    validateVehicles,
  } from '$lib/utils/vehicleHelpers.js';

  // Local reactive copy of the stored preference. Initialized from
  // localStorage on mount (SSR has no localStorage). Default 'system'
  // until we hydrate.
  let theme = $state('system');

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

  onMount(() => {
    theme = getStoredTheme();
  });

  function chooseTheme(next) {
    theme = next;
    setTheme(next);
  }

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

  // ── Home base panel ───────────────────────────────────────────────────────────

  // The full GET response is stashed so we can round-trip prose + vehicles
  // back unchanged when saving the structured fields.
  let homeSnapshot = $state(/** @type {null | {frontmatter: object, prose: object}} */ (null));
  let homeLoadError = $state('');

  // Editable fields — initialized to blanks; populated in onMount from GET.
  let homeCity = $state('');
  let homeLat  = $state('');
  let homeLon  = $state('');
  let homeRadius = $state('');
  let homeTravelersStr = $state('');   // comma-separated display value
  let homePetsNeedSitter = $state(false);
  let homeDistanceUnit = $state('mi'); // 'mi' | 'km'

  // Per-field validation messages returned by the server.
  let homeFieldErrors = $state(/** @type {Record<string, string>} */ ({}));

  let homeBusy     = $state(false);
  let homeSavedOk  = $state(false);
  let homeSaveError = $state('');

  // Editable vehicles map. Initialized in onMount from the GET snapshot.
  let homeVehicles = $state(/** @type {Record<string, object>} */ ({}));

  // New-vehicle UI state: separate row at the bottom of the list for entering
  // a new key. The key is locked once added (renaming would break per-trip
  // `vehicle: bolt` frontmatter overrides on existing planning files).
  let newVehicleKey = $state('');
  let newVehicleType = $state('gas');

  // Per-vehicle structural errors surfaced before save.
  let vehicleErrors = $state(/** @type {string[]} */ ([]));

  // Confirm-modal state for vehicle removal.
  let removeOpen = $state(false);
  let removeTargetKey = $state('');

  // Editable prose: the body of home.md, split on ## headings.
  // - homePreamble: everything before the first ## heading (typically the
  //   "# Personal context for trip planning" intro). Collapsed by default
  //   behind an "Advanced" toggle since most users won't touch it.
  // - homeSections: array of { heading, body }; headings are read-only,
  //   bodies are editable per textarea.
  let homePreamble = $state('');
  let homeSections = $state(/** @type {Array<{heading: string, body: string}>} */ ([]));
  let showPreambleEditor = $state(false);

  // Track the "pristine" snapshot as serialized JSON so we can disable Save
  // while nothing has changed.
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

  onMount(async () => {
    try {
      const res = await fetch('/api/home');
      if (!res.ok) {
        if (res.status === 404) {
          homeLoadError = 'home.md not found — create it to enable editing.';
        } else {
          const body = await res.json().catch(() => ({}));
          homeLoadError = body.error ?? `Server error ${res.status}`;
        }
        return;
      }
      const body = await res.json();
      homeSnapshot = body;

      const fm = body.frontmatter ?? {};
      homeCity = fm.home_city ?? '';
      // Store coords and radius as strings — input[type=number] bind:value produces strings.
      homeLat  = fm.home_coords?.[0] != null ? String(fm.home_coords[0]) : '';
      homeLon  = fm.home_coords?.[1] != null ? String(fm.home_coords[1]) : '';
      homeRadius = fm.default_radius_mi != null ? String(fm.default_radius_mi) : '';
      homeTravelersStr = travelersToString(fm.travelers ?? []);
      homePetsNeedSitter = fm.pets_need_sitter ?? false;
      homeDistanceUnit = fm.units?.distance ?? 'mi';
      // Deep-copy vehicles so reactive edits don't mutate the snapshot.
      homeVehicles = JSON.parse(JSON.stringify(fm.vehicles ?? {}));
      // Pull prose into editable state. Deep-copy sections so per-textarea
      // edits don't mutate the snapshot.
      homePreamble = body.prose?.preamble ?? '';
      homeSections = JSON.parse(JSON.stringify(body.prose?.sections ?? []));

      // Snapshot the initial state so Save is disabled until something changes.
      homePristine = JSON.stringify({
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
      });
    } catch (e) {
      homeLoadError = e.message;
    }
  });

  // ── Vehicle handlers ────────────────────────────────────────────────────────

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

  function openRemoveConfirm(key) {
    removeTargetKey = key;
    removeOpen = true;
  }

  function confirmRemoveVehicle() {
    if (removeTargetKey) {
      homeVehicles = removeVehicle(homeVehicles, removeTargetKey);
      homeSavedOk = false;
      vehicleErrors = [];
    }
    removeTargetKey = '';
  }

  async function saveHome() {
    if (homeBusy || !homeSnapshot) return;

    // Front-load vehicle validation so the server doesn't get garbage.
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

    // Build the updated frontmatter, preserving prose + all other fields
    // from the original GET so we don't drop them on write.
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

    // Remove undefined values so we don't serialize `undefined` to YAML
    if (updatedFrontmatter.default_radius_mi === undefined) {
      delete updatedFrontmatter.default_radius_mi;
    }

    const payload = {
      frontmatter: updatedFrontmatter,
      prose: {
        preamble: homePreamble,
        sections: homeSections,
      },
    };

    try {
      const res = await fetch('/api/home', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const respBody = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = respBody.error ?? `Server error ${res.status}`;
        // Map known field-level error messages to their inputs.
        if (msg.toLowerCase().includes('home_city')) {
          homeFieldErrors = { ...homeFieldErrors, home_city: msg };
        } else if (msg.toLowerCase().includes('home_coords')) {
          homeFieldErrors = { ...homeFieldErrors, home_coords: msg };
        } else {
          homeSaveError = msg;
        }
      } else {
        homeSavedOk = true;
        // Update the snapshot so subsequent saves see the new pristine state.
        homeSnapshot = {
          ...homeSnapshot,
          frontmatter: updatedFrontmatter,
          prose: { preamble: homePreamble, sections: homeSections },
        };
        // Re-derive pristine from the current form state.
        homePristine = homeCurrentJson;
      }
    } catch (e) {
      homeSaveError = e.message;
    } finally {
      homeBusy = false;
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
      <h2>Appearance</h2>
      <p class="section-desc">Theme preference is stored on this device. "Match system" follows your OS dark-mode setting. Brochures always render in light mode for printing.</p>

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
    </section>

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

    <section class="settings-section home-section">
      <h2>Home base</h2>
      <p class="section-desc">Everything in <code>home.md</code> — structured fields (location, vehicles, travelers, preferences) plus the prose sections that get fed to the LLM as context on every seed, research, and chat call. One Save button covers all of it.</p>

      {#if homeLoadError}
        <p class="field-warn">{homeLoadError}</p>
      {:else if !homeSnapshot}
        <p class="field-hint">Loading…</p>
      {:else}
        <div class="field-group">
          <div class="field">
            <label for="home-city" class="field-label">Home city</label>
            <input
              id="home-city"
              type="text"
              class="field-input"
              class:field-input-error={!!homeFieldErrors.home_city}
              placeholder="e.g. Overland Park, KS"
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

          <div class="field">
            <label for="home-radius" class="field-label">Default radius (mi)</label>
            <input
              id="home-radius"
              type="number"
              min="0"
              step="1"
              class="field-input field-input-narrow"
              placeholder="450"
              bind:value={homeRadius}
              oninput={() => { homeSavedOk = false; }}
            />
          </div>

          <div class="field">
            <label for="home-travelers" class="field-label">Travelers</label>
            <input
              id="home-travelers"
              type="text"
              class="field-input"
              placeholder="evan, erika"
              bind:value={homeTravelersStr}
              oninput={() => { homeSavedOk = false; }}
            />
            <p class="field-hint">Comma-separated names. Used when seeding ideas and checking logistics.</p>
          </div>

          <div class="field">
            <span class="field-label">Pets need a sitter?</span>
            <label class="checkbox-row">
              <input
                type="checkbox"
                bind:checked={homePetsNeedSitter}
                onchange={() => { homeSavedOk = false; }}
              />
              <span class="checkbox-label">Yes — pets need a sitter for overnight trips</span>
            </label>
          </div>

          <div class="field">
            <span class="field-label">Distance units</span>
            <div class="radio-row" role="radiogroup" aria-label="Distance units">
              {#each [['mi', 'Miles (mi)'], ['km', 'Kilometers (km)']] as [value, label]}
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

          <div class="field vehicles-block">
            <span class="field-label">Vehicles</span>
            <p class="field-hint">Each trip uses the default unless overridden with <code>vehicle: &lt;key&gt;</code> in its frontmatter. EV trips use <code>range_mi</code> and <code>dc_fast_charge_kw</code> to plan charging stops.</p>

            {#if Object.keys(homeVehicles).length === 0}
              <p class="field-warn">No vehicles configured — add at least one below.</p>
            {/if}

            {#each Object.entries(homeVehicles) as [key, v] (key)}
              <div class="vehicle-card">
                <div class="vehicle-header">
                  <span class="vehicle-key" title="Slug can't be renamed — it's referenced by per-trip vehicle: {key} overrides.">{key}</span>
                  <label class="default-radio" class:default-radio-active={v.default}>
                    <input
                      type="radio"
                      name="default-vehicle"
                      checked={v.default}
                      onchange={() => handleSetDefault(key)}
                    />
                    <span>Default</span>
                  </label>
                  <button
                    type="button"
                    class="btn-icon btn-remove"
                    aria-label="Remove vehicle {key}"
                    onclick={() => openRemoveConfirm(key)}
                  >×</button>
                </div>

                <div class="vehicle-fields">
                  <div class="field">
                    <label for="vehicle-model-{key}" class="field-label-sub">Model</label>
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
                    <span class="field-label-sub">Type</span>
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
                    <div class="ev-row">
                      <div class="field">
                        <label for="vehicle-range-{key}" class="field-label-sub">EPA range (mi)</label>
                        <input
                          id="vehicle-range-{key}"
                          type="number"
                          min="0"
                          step="1"
                          class="field-input field-input-narrow"
                          placeholder="247"
                          value={v.range_mi ?? ''}
                          oninput={(e) => handleVehicleField(key, 'range_mi', e.currentTarget.value === '' ? null : Number(e.currentTarget.value))}
                        />
                      </div>
                      <div class="field">
                        <label for="vehicle-kw-{key}" class="field-label-sub">DC fast-charge (kW)</label>
                        <input
                          id="vehicle-kw-{key}"
                          type="number"
                          min="0"
                          step="1"
                          class="field-input field-input-narrow"
                          placeholder="55"
                          value={v.dc_fast_charge_kw ?? ''}
                          oninput={(e) => handleVehicleField(key, 'dc_fast_charge_kw', e.currentTarget.value === '' ? null : Number(e.currentTarget.value))}
                        />
                      </div>
                    </div>
                  {/if}

                  <div class="field">
                    <label for="vehicle-notes-{key}" class="field-label-sub">Notes</label>
                    <textarea
                      id="vehicle-notes-{key}"
                      class="field-input"
                      rows="2"
                      placeholder="Anything trip-relevant — cargo, towing, charging quirks"
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
                class="field-input field-input-narrow"
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

          <div class="prose-block">
            <div class="prose-header">
              <span class="field-label">Personal context</span>
              <p class="field-hint">Prose sections from <code>home.md</code> — these get fed to the LLM as context on every seed, research, and chat call. Headings are fixed; bodies are free-form markdown.</p>
            </div>

            {#if homeSections.length === 0}
              <p class="field-warn">No prose sections in this <code>home.md</code> yet — add some <code>##&nbsp;Heading</code> blocks below the frontmatter to see them here.</p>
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
        </div>

        <div class="actions home-actions">
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

<ConfirmModal
  bind:open={removeOpen}
  title="Remove vehicle?"
  body={`The “${removeTargetKey}” entry will be deleted from home.md. Any planning trips that override with \`vehicle: ${removeTargetKey}\` will fall back to the default vehicle on the next read.`}
  confirmLabel="Remove"
  danger
  onconfirm={confirmRemoveVehicle}
/>

<style>
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
    color: var(--text-primary);
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
    color: var(--state-warning);
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
    border: 1px solid var(--border-subtle);
  }

  .health-ok  { border-color: var(--forest-200); }
  .health-bad { border-color: var(--sunset-200); }

  .health-mark {
    font-family: var(--font-mono);
    font-size: 14px;
    text-align: center;
    line-height: 1;
  }
  .health-ok  .health-mark { color: var(--state-success); }
  .health-bad .health-mark { color: var(--state-danger); }

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
    background: var(--state-success-surface);
    color: var(--state-success);
  }

  .badge-unset {
    background: var(--surface-sunken);
    color: var(--text-tertiary);
  }

  .field-input,
  .field-select {
    background: var(--surface-raised);
    border: 1px solid var(--border-default);
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
    border-bottom: 1px solid var(--border-subtle);
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
  .feedback-err { color: var(--state-danger); }

  .btn-remove {
    font-size: 10px;
    font-family: var(--font-mono);
    padding: 1px 6px;
    border-radius: 3px;
    border: 1px solid var(--border-default);
    background: transparent;
    color: var(--text-tertiary);
    cursor: pointer;
    line-height: 1.6;
    transition: border-color 0.15s, color 0.15s;
  }
  .btn-remove:hover {
    border-color: var(--state-danger);
    color: var(--state-danger);
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
    border-color: var(--border-default);
    color: var(--text-tertiary);
  }
  .btn-confirm-cancel:hover {
    border-color: var(--border-strong);
    color: var(--text-secondary);
  }

  .theme-options {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .theme-option {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border: 1px solid var(--border-default);
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    color: var(--text-secondary);
    transition: border-color 0.15s, color 0.15s, background-color 0.15s;
  }

  .theme-option:hover {
    border-color: var(--forest-400);
  }

  .theme-option-active {
    border-color: var(--forest-600);
    color: var(--text-primary);
    background: var(--surface-raised);
  }

  .theme-option input[type="radio"] {
    accent-color: var(--forest-600);
    margin: 0;
  }

  /* ── Home base panel ─────────────────────────────────────── */

  .home-section {
    border-top: 1px solid var(--border-subtle);
    padding-top: 48px;
  }

  .home-actions {
    margin-top: 24px;
  }

  .field-input-narrow {
    max-width: 160px;
  }

  .field-input-error {
    border-color: var(--state-danger);
  }

  .field-error {
    font-size: 11px;
    color: var(--state-danger);
    margin: 2px 0 0;
    line-height: 1.5;
  }

  .checkbox-row {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    margin-top: 2px;
  }

  .checkbox-row input[type="checkbox"] {
    accent-color: var(--forest-600);
    width: 14px;
    height: 14px;
    margin: 0;
    cursor: pointer;
  }

  .checkbox-label {
    font-size: 12px;
    color: var(--text-secondary);
  }

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
    padding: 6px 12px;
    border: 1px solid var(--border-default);
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    color: var(--text-secondary);
    transition: border-color 0.15s, color 0.15s, background-color 0.15s;
  }

  .radio-option:hover {
    border-color: var(--forest-400);
  }

  .radio-option-active {
    border-color: var(--forest-600);
    color: var(--text-primary);
    background: var(--surface-raised);
  }

  .radio-option input[type="radio"] {
    accent-color: var(--forest-600);
    margin: 0;
  }

  /* ── Vehicles editor ─────────────────────────────────────────── */

  .vehicles-block {
    margin-top: 6px;
  }

  .vehicle-card {
    border: 1px solid var(--border-default);
    border-radius: 6px;
    padding: 12px 14px;
    margin-top: 10px;
    background: var(--surface-page);
  }

  .vehicle-header {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 10px;
  }

  .vehicle-key {
    font-family: var(--font-mono, monospace);
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
    background: var(--surface-raised);
    padding: 2px 8px;
    border-radius: 3px;
    cursor: help;
  }

  .default-radio {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border: 1px solid var(--border-default);
    border-radius: 4px;
    font-size: 11px;
    color: var(--text-secondary);
    cursor: pointer;
    transition: border-color 0.15s, color 0.15s, background-color 0.15s;
  }

  .default-radio:hover {
    border-color: var(--forest-400);
  }

  .default-radio-active {
    border-color: var(--forest-600);
    color: var(--text-primary);
    background: var(--surface-raised);
  }

  .default-radio input[type="radio"] {
    accent-color: var(--forest-600);
    margin: 0;
  }

  .btn-icon {
    margin-left: auto;
    background: none;
    border: 1px solid transparent;
    color: var(--text-tertiary);
    font-size: 18px;
    line-height: 1;
    padding: 2px 8px;
    border-radius: 3px;
    cursor: pointer;
    transition: color 0.15s, border-color 0.15s;
  }

  .btn-remove:hover {
    color: var(--state-danger);
    border-color: var(--state-danger);
  }

  .vehicle-fields {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .ev-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }

  .vehicle-add {
    display: flex;
    align-items: flex-end;
    gap: 12px;
    margin-top: 14px;
    flex-wrap: wrap;
  }

  .field-warn {
    font-size: 12px;
    color: var(--state-warning, var(--text-tertiary));
    margin: 4px 0 0;
  }

  .field-error-list {
    list-style: disc inside;
    padding: 0;
    margin: 10px 0 0;
    font-size: 11px;
    color: var(--state-danger);
  }

  .field-error-list li {
    line-height: 1.5;
  }

  /* ── Prose editor ─────────────────────────────────────────── */

  .prose-block {
    margin-top: 24px;
    padding-top: 24px;
    border-top: 1px solid var(--border-subtle);
  }

  .prose-header .field-label {
    margin-bottom: 4px;
  }

  .prose-section {
    margin-top: 14px;
  }

  .prose-heading {
    display: block;
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    color: var(--text-tertiary);
    margin-bottom: 4px;
  }

  .prose-textarea {
    font-family: var(--font-mono, monospace);
    font-size: 13px;
    line-height: 1.55;
    resize: vertical;
    min-height: 90px;
  }

  .prose-advanced {
    margin-top: 18px;
    padding: 10px 12px;
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

  .prose-advanced[open] summary {
    margin-bottom: 10px;
  }
</style>

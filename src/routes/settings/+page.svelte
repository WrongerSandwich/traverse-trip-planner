<script>
  import { onMount, untrack } from 'svelte';
  import Logo from '$lib/components/Logo.svelte';
  import LocationPicker from '$lib/components/LocationPicker.svelte';
  import { getStoredTheme, setTheme } from '$lib/theme.js';
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
    share:  'Share links',
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

  // Save state for the preferences zone.
  let busy = $state(false);
  let savedOk = $state(false);
  let saveError = $state('');

  // Server config disclosure: persisted to localStorage so a self-hoster
  // iterating on .env doesn't have to re-expand on every page load. State
  // initializer reads localStorage post-hydration via onMount; default closed
  // accepts a tiny first-paint flash on already-open state in exchange for
  // SSR-safe rendering.
  const SERVER_CONFIG_KEY = 'traverse:settings:serverConfigOpen';
  let showServerConfig = $state(false);
  onMount(() => {
    try {
      showServerConfig = localStorage.getItem(SERVER_CONFIG_KEY) === '1';
    } catch {/* private mode etc — ignore */}
  });
  function persistServerConfigOpen(open) {
    showServerConfig = open;
    try {
      localStorage.setItem(SERVER_CONFIG_KEY, open ? '1' : '0');
    } catch {/* ignore */}
  }

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

  // Pristine tracking for the preferences zone. The initial snapshot derives
  // from data.settingsView (kept in sync when /api/settings POST returns a
  // fresh view), so it updates after a successful save and the button
  // re-disables when nothing is dirty.
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
      }
    } catch {
      saveError = failureSentence('network_error');
    } finally {
      busy = false;
    }
  }

  // ── Preferences save ───────────────────────────────────────────────────────
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
      }
    } catch {
      saveError = failureSentence('network_error');
    } finally {
      busy = false;
    }
  }

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

  // Inline vehicle remove confirmation — replaces ConfirmModal so the
  // destructive-confirm pattern is consistent with API-key removal.
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

  // ── Home base save ────────────────────────────────────────────────────────
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
        // Validation errors map to per-field inline display; other failures
        // route through the registry.
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

  // Cross-section unsaved-changes advisory.
  let homeDirty = $derived(!homeIsPristine && homeStatus === 'ready');
  let prefsDirty = $derived(!prefsIsPristine);

  function scrollToHome(e) {
    e.preventDefault();
    document.getElementById('home-base')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
</script>

<svelte:head>
  <title>Settings · Traverse</title>
</svelte:head>

<div class="page">
  <header>
    <div class="wordmark">
      <Logo variant="inverse" size={28} aria-hidden="true" />
      <h1><a href="/" class="back-link">Traverse</a> <span class="slash">/</span> Settings</h1>
    </div>
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
          Configure them in <a href="#server-config" class="health-strip-link">Server config</a>.
        </span>
      </div>
    {/if}

    <!-- ── Section 1: Home base ─────────────────────────────────────────── -->
    <section class="settings-section" id="home-base">
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

            <div class="row-2">
              <div class="field">
                <label for="home-radius" class="field-label">{radiusLabel}</label>
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
                placeholder="evan, erika"
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
                      <span class="vehicle-key-note">slug can't be renamed</span>
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
                      <div class="row-2">
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
          {#if prefsDirty}
            <span class="feedback feedback-advisory">Also unsaved: <a href="#preferences" class="advisory-link">Preferences</a>.</span>
          {/if}
        </div>
      {/if}
    </section>

    <!-- ── Section 2: Preferences ──────────────────────────────────────── -->
    <section class="settings-section" id="preferences">
      <h2>Preferences</h2>
      <p class="section-desc">Theme is stored on this device. Assistant name and the advanced server config below are saved together to <code>settings.json</code>.</p>

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

        <details
          class="server-config"
          id="server-config"
          open={showServerConfig}
          ontoggle={(e) => persistServerConfigOpen(e.currentTarget.open)}
        >
          <summary>
            <span class="summary-label">Server config</span>
            <span class="summary-sub">keys, models, search backend</span>
          </summary>

          <div class="server-config-inner">
            <p class="section-desc">This server's API keys and model assignments. Most users set these once via <code>.env</code>. UI overrides take effect on the next AI call; no restart needed.</p>

            <div class="subsection">
              <span class="subsection-label">Model provider keys</span>
              <p class="field-hint">Stored in <code>settings.json</code>, overlay your <code>.env</code> values. The full key is never sent back to the browser after saving.</p>

              <div class="field-group">
                {#each PROVIDERS as provider}
                  {@const current = data.settingsView.keys[provider]}
                  <div class="field">
                    <div class="field-label-row">
                      <label for="key-{provider}" class="field-label">{PROVIDER_LABELS[provider]}</label>
                      {#if current?.isSet}
                        <span class="badge badge-set">set: {current.preview}</span>
                        {#if removingKey[provider]}
                          <span class="remove-confirm">
                            Remove key?
                            <button class="btn-confirm-yes" onclick={() => removeKey(provider)} disabled={busy}>Yes, remove</button>
                            <button class="btn-confirm-cancel" onclick={() => removingKey[provider] = false}>Cancel</button>
                          </span>
                        {:else}
                          <button class="btn-remove" onclick={() => removingKey[provider] = true}>Remove</button>
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
                      {#if current?.isSet}
                        <span class="badge badge-set">set: {current.preview}</span>
                        {#if removingService[service]}
                          <span class="remove-confirm">
                            Remove key?
                            <button class="btn-confirm-yes" onclick={() => removeService(service)} disabled={busy}>Yes, remove</button>
                            <button class="btn-confirm-cancel" onclick={() => removingService[service] = false}>Cancel</button>
                          </span>
                        {:else}
                          <button class="btn-remove" onclick={() => removingService[service] = true}>Remove</button>
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
                        class="field-input"
                        placeholder="e.g. claude-sonnet-4-6"
                        bind:value={slots[slotKey].model}
                      />
                    </div>
                  </div>
                </div>
              {/each}
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
          </div>
        </details>
      </div>

      <div class="actions">
        <button class="btn btn-primary" onclick={save} disabled={busy || prefsIsPristine}>
          {busy ? 'Saving…' : 'Save preferences'}
        </button>
        {#if savedOk}
          <span class="feedback feedback-ok">Saved. Changes take effect on the next request.</span>
        {/if}
        {#if saveError}
          <span class="feedback feedback-err">{saveError}</span>
        {/if}
        {#if homeDirty}
          <span class="feedback feedback-advisory">Also unsaved: <a href="#home-base" class="advisory-link" onclick={scrollToHome}>Home base</a>.</span>
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
  .slash { opacity: 0.4; margin: 0 2px; }

  /* ── Main column ── */
  main {
    max-width: 720px;
    margin: 0 auto;
    padding: 32px 24px 96px;
  }

  /* ── Feature health strip (only when something is failing) ── */
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
  .health-strip-link {
    color: var(--accent-text);
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  /* ── Sections (clear vertical rhythm; rule + air between) ── */
  .settings-section + .settings-section {
    margin-top: 80px;
    padding-top: 56px;
    border-top: 1px solid var(--border-subtle);
  }

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
  .field-label-sub {
    font-size: 12px;
    font-weight: 500;
    color: var(--text-secondary);
  }

  .field-hint {
    font-size: 12px;
    color: var(--text-tertiary);
    margin: 0;
    line-height: 1.5;
    max-width: 65ch;
  }

  /* Single definition (was duplicated in the previous file). */
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
    font-family: var(--font-mono);
    font-size: 13px;
    color: var(--text-primary);
    width: 100%;
    box-sizing: border-box;
    transition: border-color 0.15s;
  }
  .field-input:focus-visible,
  .field-select:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
    border-color: var(--forest-400);
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
  .feedback-ok       { color: var(--state-success); }
  .feedback-err      { color: var(--state-danger); }
  .feedback-advisory { color: var(--text-tertiary); font-family: var(--font-sans); }
  .advisory-link {
    color: var(--accent-text);
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  /* ── Empty state (missing home.md) ── */
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

  /* ── Buttons (project-shared .btn / .btn-primary live in app.css) ── */

  /* Inline remove + confirm — touch-target safe (≥28px tall). */
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
    background: var(--embers-50);
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
  .theme-options,
  .radio-row {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    margin-top: 4px;
  }
  .theme-option,
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
  .theme-option:hover,
  .radio-option:hover { border-color: var(--forest-400); }
  .theme-option-active,
  .radio-option-active {
    border-color: var(--forest-600);
    color: var(--text-primary);
    background: var(--surface-raised);
  }
  .theme-option input[type="radio"],
  .radio-option input[type="radio"] {
    accent-color: var(--forest-600);
    margin: 0;
  }
  .theme-option:focus-within,
  .radio-option:focus-within {
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
  .badge-unset {
    background: var(--surface-sunken);
    color: var(--text-tertiary);
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
    accent-color: var(--forest-600);
    width: 16px;
    height: 16px;
    margin: 0;
    cursor: pointer;
  }
  .checkbox-label {
    font-size: 13px;
    color: var(--text-primary);
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
  .default-radio:hover { border-color: var(--forest-400); }
  .default-radio-active {
    border-color: var(--forest-600);
    color: var(--text-primary);
    background: var(--surface-raised);
  }
  .default-radio input[type="radio"] {
    accent-color: var(--forest-600);
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

  /* ── Server config disclosure ── */
  .server-config {
    border: 1px solid var(--border-subtle);
    border-radius: 6px;
    margin-top: 6px;
    background: var(--surface-page);
  }
  .server-config summary {
    list-style: none;
    cursor: pointer;
    padding: 14px 16px;
    user-select: none;
  }
  .server-config summary::-webkit-details-marker { display: none; }
  .server-config summary::before {
    content: '▸';
    display: inline-block;
    margin-right: 10px;
    color: var(--text-tertiary);
    transition: transform 0.15s ease;
  }
  .server-config[open] summary::before { transform: rotate(90deg); }
  .summary-label {
    font-size: 14px;
    font-weight: 500;
    color: var(--text-primary);
  }
  .summary-sub {
    font-size: 12px;
    color: var(--text-tertiary);
    margin-left: 8px;
  }
  .server-config[open] summary {
    border-bottom: 1px solid var(--border-subtle);
  }
  .server-config-inner {
    padding: 20px;
    background: var(--surface-raised);
  }
  .server-config-inner .subsection + .subsection {
    margin-top: 28px;
    padding-top: 28px;
    border-top: 1px solid var(--border-subtle);
  }
  .server-config summary:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }

  /* ── Mobile ── */
  @media (max-width: 768px) {
    main {
      padding: 24px 16px 64px;
    }
    .settings-section + .settings-section {
      margin-top: 56px;
      padding-top: 40px;
    }
    .slot-fields,
    .row-2 {
      grid-template-columns: 1fr;
    }
    .health-strip { font-size: 12px; }
    .vehicle-header { gap: 8px; }
    .btn-remove-vehicle { margin-left: 0; }
    .server-config-inner { padding: 16px; }
  }
</style>

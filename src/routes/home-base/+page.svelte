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
        <p class="field-hint">Loading home.md…</p>
      {:else if homeStatus === 'missing'}
        <div class="empty-state">
          <p class="empty-state-title">home.md isn't set up yet.</p>
          <p class="empty-state-body">The planner needs a home base before it can suggest trips. Set one up to enable seed, research, and chat.</p>
          <a href="/onboarding" class="btn btn-primary">Create from template</a>
          <p class="empty-state-hint">A short walkthrough: home city, a vehicle, travelers. About five steps, no AI calls.</p>
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
              <p class="field-hint">Comma-separated. Names of who's traveling, plus context like ages or visiting dates if it helps the planner ("alex, sam, alex's brother Aug 4-12").</p>
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

  .field-input {
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
  .field-input:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
    border-color: var(--border-strong);
  }
  .field-input::placeholder {
    color: var(--text-tertiary);
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
  .empty-state-hint {
    font-size: 12px;
    color: var(--text-tertiary);
    margin: 16px auto 0;
    line-height: 1.5;
    max-width: 45ch;
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
  .btn-confirm-yes:focus-visible,
  .btn-confirm-cancel:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
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

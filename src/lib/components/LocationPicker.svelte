<script>
  /**
   * LocationPicker — geocoder-backed address typeahead.
   *
   * Props (all bindable):
   *   city   {string}        — filled with the selected result's label
   *   lat    {string|number} — filled with the selected result's latitude
   *   lon    {string|number} — filled with the selected result's longitude
   *   label  {string}        — field group label (default: "Home location")
   */

  let {
    city = $bindable(''),
    lat  = $bindable(''),
    lon  = $bindable(''),
    label = 'Home location',
  } = $props();

  // Free-form address query — initialized from the city prop so the field
  // shows the current value on first render.
  let query = $state(city ?? '');
  let results = $state(/** @type {Array<{label: string, lat: number, lon: number}>} */ ([]));
  let loading = $state(false);
  let networkError = $state('');
  let showDropdown = $state(false);
  let searched = $state(false); // true after at least one debounced search

  // "Enter coords manually" escape hatch.
  let showManual = $state(false);

  let debounceTimer = /** @type {ReturnType<typeof setTimeout> | null} */ (null);

  // Monotonically-increasing counter; each debounced fetch captures its own
  // copy. Results are applied only if the copy still matches the latest value,
  // preventing a slow earlier response from overwriting a faster later one.
  let latestRequestId = 0;

  /**
   * Called on every keystroke in the address input.
   * Debounces 400ms before hitting the geocode endpoint.
   */
  function onQueryInput() {
    networkError = '';
    showDropdown = false;
    searched = false;

    if (debounceTimer !== null) clearTimeout(debounceTimer);

    const q = query.trim();
    if (!q) {
      results = [];
      loading = false;
      return;
    }

    loading = true;
    debounceTimer = setTimeout(async () => {
      const requestId = ++latestRequestId;
      try {
        const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
        // Discard if a newer request has already been dispatched.
        if (requestId !== latestRequestId) return;
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          networkError = body.error ?? `Geocoder error ${res.status}`;
          results = [];
        } else {
          const data = await res.json();
          results = (data.results ?? []).slice(0, 5);
        }
      } catch (e) {
        if (requestId !== latestRequestId) return;
        networkError = e.message ?? 'Network error — could not reach geocoder.';
        results = [];
      } finally {
        if (requestId === latestRequestId) {
          loading = false;
          searched = true;
          showDropdown = true;
        }
      }
    }, 400);
  }

  /**
   * Select a result from the dropdown — fills parent bindings.
   */
  function selectResult(result) {
    query = result.label;
    city  = result.label;
    lat   = String(result.lat);
    lon   = String(result.lon);
    showDropdown = false;
    results = [];
    searched = false;
    networkError = '';
  }

  function closeDropdown() {
    showDropdown = false;
  }

  function toggleManual() {
    showManual = !showManual;
    if (showManual) showDropdown = false;
  }
</script>

<div class="location-picker">
  <span class="field-label">{label}</span>

  <!-- Address search input -->
  <div class="search-wrap">
    <input
      type="text"
      class="field-input"
      placeholder="e.g. Cleveland, OH"
      bind:value={query}
      oninput={onQueryInput}
      onblur={() => setTimeout(closeDropdown, 150)}
      autocomplete="off"
      spellcheck="false"
      aria-label="Address search"
      aria-autocomplete="list"
    />
    {#if loading}
      <span class="search-spinner" aria-hidden="true"></span>
    {/if}
  </div>

  <!-- Dropdown results -->
  {#if showDropdown}
    <div class="dropdown" role="listbox" aria-label="Address suggestions">
      {#if networkError}
        <p class="dropdown-error">{networkError}</p>
      {:else if results.length === 0 && searched}
        <p class="dropdown-empty">No matches — try a more specific address, or enter coords manually.</p>
      {:else}
        {#each results as result}
          <button
            type="button"
            class="dropdown-item"
            role="option"
            aria-selected="false"
            onmousedown={() => selectResult(result)}
          >
            {result.label}
            <span class="dropdown-coords">{result.lat.toFixed(4)}, {result.lon.toFixed(4)}</span>
          </button>
        {/each}
      {/if}
    </div>
  {/if}

  <!-- Inline network error (shown outside dropdown when dropdown is closed) -->
  {#if !showDropdown && networkError}
    <p class="inline-error">{networkError}</p>
  {/if}

  <!-- Coords display when a result is selected -->
  {#if lat && lon && !showManual}
    <p class="coords-preview">
      Coordinates: {lat}, {lon}
    </p>
  {/if}

  <!-- Manual escape hatch toggle -->
  <button type="button" class="manual-toggle" onclick={toggleManual}>
    {showManual ? 'Hide manual entry' : 'Or enter coords manually'}
  </button>

  <!-- Manual lat/lon fields -->
  {#if showManual}
    <div class="manual-coords">
      <div class="coords-row">
        <div class="coords-field">
          <label for="loc-lat" class="field-label-sub">Latitude</label>
          <input
            id="loc-lat"
            type="number"
            step="any"
            min="-90"
            max="90"
            class="field-input"
            placeholder="38.98"
            bind:value={lat}
          />
        </div>
        <div class="coords-field">
          <label for="loc-lon" class="field-label-sub">Longitude</label>
          <input
            id="loc-lon"
            type="number"
            step="any"
            min="-180"
            max="180"
            class="field-input"
            placeholder="-94.67"
            bind:value={lon}
          />
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .location-picker {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .field-label {
    font-size: 12px;
    font-weight: 500;
    color: var(--text-secondary);
  }

  .search-wrap {
    position: relative;
  }

  .field-input {
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

  .field-input:focus {
    outline: none;
    border-color: var(--forest-400);
  }

  .field-input::placeholder {
    color: var(--text-tertiary);
    font-family: var(--font-sans);
  }

  /* Spinner — pure CSS, no image/emoji */
  .search-spinner {
    position: absolute;
    right: 10px;
    top: 50%;
    transform: translateY(-50%);
    width: 12px;
    height: 12px;
    border: 2px solid var(--border-default);
    border-top-color: var(--forest-400);
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
    pointer-events: none;
  }

  @keyframes spin {
    to { transform: translateY(-50%) rotate(360deg); }
  }

  .dropdown {
    background: var(--surface-raised);
    border: 1px solid var(--border-default);
    border-radius: 4px;
    box-shadow: 0 4px 12px color-mix(in srgb, var(--text-primary) 8%, transparent);
    overflow: hidden;
    z-index: 10;
  }

  .dropdown-item {
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 100%;
    text-align: left;
    padding: 8px 12px;
    background: transparent;
    border: none;
    border-bottom: 1px solid var(--border-subtle);
    cursor: pointer;
    font-size: 12px;
    color: var(--text-primary);
    font-family: var(--font-sans);
    transition: background 0.1s;
  }

  .dropdown-item:last-child {
    border-bottom: none;
  }

  .dropdown-item:hover,
  .dropdown-item:focus {
    background: var(--surface-sunken);
    outline: none;
  }

  .dropdown-coords {
    font-size: 10px;
    font-family: var(--font-mono);
    color: var(--text-tertiary);
  }

  .dropdown-empty,
  .dropdown-error {
    padding: 10px 12px;
    font-size: 12px;
    margin: 0;
    line-height: 1.5;
  }

  .dropdown-empty {
    color: var(--text-tertiary);
    font-style: italic;
  }

  .dropdown-error {
    color: var(--state-danger);
  }

  .inline-error {
    font-size: 11px;
    color: var(--state-danger);
    margin: 0;
    line-height: 1.5;
  }

  .coords-preview {
    font-size: 11px;
    font-family: var(--font-mono);
    color: var(--text-tertiary);
    margin: 0;
  }

  .manual-toggle {
    align-self: flex-start;
    background: none;
    border: none;
    padding: 0;
    font-size: 11px;
    color: var(--text-tertiary);
    cursor: pointer;
    text-decoration: underline;
    font-family: var(--font-sans);
    transition: color 0.15s;
  }

  .manual-toggle:hover {
    color: var(--text-secondary);
  }

  .manual-coords {
    margin-top: 4px;
  }

  .coords-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }

  .coords-field {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .field-label-sub {
    font-size: 11px;
    font-weight: 400;
    color: var(--text-tertiary);
    display: block;
  }
</style>

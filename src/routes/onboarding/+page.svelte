<script>
  import { goto, beforeNavigate, invalidateAll } from '$app/navigation';
  import Logo from '$lib/components/Logo.svelte';
  import LocationPicker from '$lib/components/LocationPicker.svelte';
  import ConfirmModal from '$lib/components/ConfirmModal.svelte';
  import { stringToTravelers } from '$lib/utils/homeForm.js';
  import { failureSentence } from '$lib/errors-registry.js';

  // Six-step wizard. Step state is an integer 1–6.
  let step = $state(1);

  // ── Step 2: Home location ────────────────────────────────────────────────
  let homeCity = $state('');
  let homeLat  = $state('');
  let homeLon  = $state('');

  // ── Step 3: Travelers, pets, radius ─────────────────────────────────────
  let travelersStr     = $state('');
  let petsNeedSitter   = $state(false);
  let defaultRadius    = $state('400');

  // ── Step 4: Vehicle ─────────────────────────────────────────────────────
  // One vehicle is required to advance from step 4. Multiple are possible
  // via the settings panel post-onboarding; the wizard keeps it to one.
  let vehicleKey     = $state('car');
  let vehicleModel   = $state('');
  let vehicleType    = $state('gas');
  let vehicleRange   = $state('');
  let vehicleKw      = $state('');
  let vehicleNotes   = $state('');

  // ── Step 5: Taste seed (optional) ───────────────────────────────────────
  let tasteLikes     = $state('');
  let tasteAvoids    = $state('');
  let tasteSeasonal  = $state('');

  // ── Step 6: write state ─────────────────────────────────────────────────
  let writing      = $state(false);
  let writeError   = $state('');

  // Discard-confirmation modal for premature navigation.
  let discardOpen     = $state(false);
  let pendingNav      = $state(/** @type {null | (() => void)} */ (null));
  // Skip the discard prompt on the final "go to home page" redirect.
  let skipDiscardOnce = $state(false);

  // ── Validation per step ─────────────────────────────────────────────────
  // Returning a non-empty string means the step is incomplete; the Next
  // button uses this to disable and the label can surface the reason.
  let stepError = $derived(() => {
    if (step === 1) return '';
    if (step === 2) {
      if (!homeCity.trim()) return 'Enter a home city.';
      const lat = Number(homeLat), lon = Number(homeLon);
      if (!isFinite(lat) || !isFinite(lon)) return 'Coordinates are required.';
      if (lat < -90 || lat > 90)   return 'Latitude must be between -90 and 90.';
      if (lon < -180 || lon > 180) return 'Longitude must be between -180 and 180.';
      return '';
    }
    if (step === 3) {
      if (!travelersStr.trim()) return 'List at least one traveler.';
      const r = Number(defaultRadius);
      if (!isFinite(r) || r <= 0) return 'Radius must be a positive number.';
      return '';
    }
    if (step === 4) {
      if (!vehicleKey.trim() || !/^[a-z0-9][a-z0-9-]*$/.test(vehicleKey.trim().toLowerCase())) {
        return 'Vehicle key must be lowercase letters / digits / dashes.';
      }
      if (vehicleType === 'ev') {
        const r = Number(vehicleRange);
        if (!isFinite(r) || r <= 0) return 'EV range (mi) is required for electric vehicles.';
      }
      return '';
    }
    if (step === 5) return '';   // skippable
    return '';
  });

  let hasAnswered = $derived(
    homeCity.trim() !== '' ||
    homeLat !== '' ||
    homeLon !== '' ||
    travelersStr.trim() !== '' ||
    petsNeedSitter !== false ||
    defaultRadius !== '400' ||
    vehicleModel.trim() !== '' ||
    vehicleNotes.trim() !== '' ||
    tasteLikes.trim() !== '' ||
    tasteAvoids.trim() !== '' ||
    tasteSeasonal.trim() !== ''
  );

  // Catch in-app navigation while the user has unsaved answers.
  beforeNavigate((nav) => {
    if (skipDiscardOnce) {
      skipDiscardOnce = false;
      return;
    }
    if (writing) {
      // Block reload while POST is in flight.
      nav.cancel();
      return;
    }
    if (!hasAnswered) return;
    if (step === 6 && !writeError) return;   // already wrote, nothing to lose
    nav.cancel();
    pendingNav = () => {
      skipDiscardOnce = true;
      nav.to?.url ? goto(nav.to.url) : history.back();
    };
    discardOpen = true;
  });

  function confirmDiscard() {
    const fn = pendingNav;
    pendingNav = null;
    fn?.();
  }
  function cancelDiscard() {
    pendingNav = null;
  }

  // ── Step navigation ────────────────────────────────────────────────────
  function next() {
    if (stepError()) return;
    if (step < 6) step += 1;
  }
  function back() {
    if (step > 1) step -= 1;
  }

  // ── Final write ────────────────────────────────────────────────────────

  function buildPayload() {
    const frontmatter = {
      home_city: homeCity.trim(),
      home_coords: [Number(homeLat), Number(homeLon)],
      travelers: stringToTravelers(travelersStr),
      vehicles: {
        [vehicleKey.trim().toLowerCase()]: {
          model: vehicleModel.trim(),
          type: vehicleType,
          default: true,
          notes: vehicleNotes.trim(),
          ...(vehicleType === 'ev'
            ? {
                range_mi: vehicleRange === '' ? null : Number(vehicleRange),
                dc_fast_charge_kw: vehicleKw === '' ? null : Number(vehicleKw),
              }
            : {}),
        },
      },
      pets_need_sitter: petsNeedSitter,
      default_radius_mi: Number(defaultRadius),
      units: { distance: 'mi' },
    };

    const sections = [];

    sections.push({
      heading: 'Travelers and logistics',
      body: `- Primary travelers: ${stringToTravelers(travelersStr).join(', ') || '(none)'}.${
        petsNeedSitter ? '\n- Pets need a sitter for overnight trips.' : ''
      }`,
    });

    sections.push({
      heading: 'Vehicle notes',
      body: vehicleNotes.trim() || '_(Add notes about cargo, range, towing, or trip-relevant quirks as they come up.)_',
    });

    sections.push({
      heading: 'Distance and duration heuristics',
      body: [
        '| Format                 | Drive each way | Approx radius |',
        '| ---------------------- | -------------- | ------------- |',
        '| One-night (Sat–Sun)    | 2–3 hrs        | ~150 mi       |',
        '| Two-night (Fri–Sun)    | 3–5 hrs        | ~300 mi       |',
        '| Long weekend (Thu–Sun) | 5–7 hrs        | ~450 mi       |',
        '| Week+                  | Vacation mode  | —             |',
        '',
        'Adjust as real trips validate or break these.',
      ].join('\n'),
    });

    if (tasteSeasonal.trim()) {
      sections.push({
        heading: 'Seasonal notes',
        body: tasteSeasonal.trim(),
      });
    }

    sections.push({
      heading: 'Trip profile — what makes a good one',
      body: [
        '**Tends to like:**',
        tasteLikes.trim() || '_(Update as you start completing trips and noticing what you actually enjoy.)_',
        '',
        '**Tends to avoid:**',
        tasteAvoids.trim() || '_(Update as you start filtering out trip ideas that don\'t land.)_',
      ].join('\n'),
    });

    sections.push({
      heading: 'Notes on completed trips',
      body: '_(Fill in as trips move to `completed/`. Cross-trip patterns go here.)_',
    });

    const preamble = '# Personal context for trip planning\n\nThis file holds user-specific preferences and constraints. The frontmatter is the source of truth for structured values; the prose below is the source for taste and nuance.';

    return { frontmatter, prose: { preamble, sections } };
  }

  async function writeHomeAndContinue() {
    writeError = '';
    writing = true;
    try {
      const payload = buildPayload();
      const res = await fetch('/api/home', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        // Server returns a specific `error` string for validation failures
        // (e.g. "frontmatter.home_city must be a non-empty string"). Prefer
        // that since it points at the offending field. Fall back to the
        // generic action_failed sentence for unexpected statuses.
        writeError = body.error ?? failureSentence('action_failed');
        return;
      }
      // Successful write — bypass the discard guard, refresh layout data
      // (so data.features.homeMdReady flips and the "Set up home base" CTA
      // is replaced by the seed/add buttons without a hard reload), then go.
      skipDiscardOnce = true;
      await invalidateAll();
      goto('/');
    } catch {
      writeError = failureSentence('network_error');
    } finally {
      writing = false;
    }
  }

  // ── Live preview of the home.md that will be written ─────────────────
  let previewYaml = $derived(stepPreview());
  function stepPreview() {
    if (step !== 6) return '';
    const { frontmatter, prose } = buildPayload();
    const fmYaml = renderYamlPreview(frontmatter);
    const body = [prose.preamble, ...prose.sections.map((s) => `## ${s.heading}\n\n${s.body}`)].filter(Boolean).join('\n\n');
    return `---\n${fmYaml}\n---\n\n${body}\n`;
  }

  // Lightweight YAML renderer — display-only. Server uses the real `yaml`
  // package for the actual write. This is just for the review screen.
  function renderYamlPreview(obj, indent = 0) {
    const pad = '  '.repeat(indent);
    const lines = [];
    for (const [k, v] of Object.entries(obj)) {
      if (v === null || v === undefined) continue;
      if (Array.isArray(v)) {
        const allScalar = v.every((x) => typeof x !== 'object' || x === null);
        if (allScalar) lines.push(`${pad}${k}: [${v.join(', ')}]`);
        else {
          lines.push(`${pad}${k}:`);
          for (const item of v) {
            lines.push(`${pad}  - ${typeof item === 'object' ? '\n' + renderYamlPreview(item, indent + 2) : item}`);
          }
        }
      } else if (typeof v === 'object') {
        lines.push(`${pad}${k}:`);
        lines.push(renderYamlPreview(v, indent + 1));
      } else {
        lines.push(`${pad}${k}: ${v}`);
      }
    }
    return lines.join('\n');
  }
</script>

<svelte:head>
  <title>Set up your home base — Traverse</title>
</svelte:head>

<div class="page">
  <header>
    <div class="wordmark">
      <Logo variant="inverse" size={28} />
      <h1>Traverse <span class="slash">/</span> Welcome</h1>
    </div>
  </header>

  <main>
    <div class="wizard">
      <ol class="step-rail">
        {#each ['Welcome', 'Home', 'Travelers', 'Vehicle', 'Taste', 'Review'] as label, i}
          <li class="step-pill" class:step-pill-active={step === i + 1} class:step-pill-done={step > i + 1}>
            <span class="step-num">{i + 1}</span>
            <span class="step-label">{label}</span>
          </li>
        {/each}
      </ol>

      <section class="step">
        {#if step === 1}
          <h2>Welcome to Traverse.</h2>
          <p>This is a self-hosted road-trip filing cabinet — trips live as plain markdown, and an LLM helps you generate, research, and reflect on them.</p>
          <p>Before any of the AI features can help, you need a <code>home.md</code> file that says where you live, who's coming along, what you drive, and what makes a trip a good one for you. The next four screens build that file. The whole thing takes ~2 minutes.</p>
          <p class="muted">You can edit any of this later under <code>/home-base</code> or by opening <code>home.md</code> directly.</p>
        {:else if step === 2}
          <h2>Where's home?</h2>
          <p class="muted">Used to compute drive times and filter trip ideas by distance.</p>
          <div class="field">
            <LocationPicker
              bind:city={homeCity}
              bind:lat={homeLat}
              bind:lon={homeLon}
              label="Home location"
            />
          </div>
        {:else if step === 3}
          <h2>Who's traveling?</h2>
          <p class="muted">Names show up in trip generation; pets-need-a-sitter affects multi-night logistics.</p>
          <div class="field">
            <label for="ob-travelers" class="field-label">Travelers</label>
            <input
              id="ob-travelers"
              type="text"
              class="field-input"
              placeholder="e.g. alex, sam"
              bind:value={travelersStr}
            />
            <p class="field-hint">Comma-separated names or handles.</p>
          </div>
          <div class="field">
            <span class="field-label">Pets need a sitter?</span>
            <label class="checkbox-row">
              <input type="checkbox" bind:checked={petsNeedSitter} />
              <span>Yes — pets need a sitter for overnight trips</span>
            </label>
          </div>
          <div class="field">
            <label for="ob-radius" class="field-label">Default drive radius (mi)</label>
            <input
              id="ob-radius"
              type="number"
              min="1"
              step="1"
              class="field-input field-input-narrow"
              bind:value={defaultRadius}
            />
            <p class="field-hint">A starting ceiling for trip-idea distance; you can adjust per-trip later.</p>
          </div>
        {:else if step === 4}
          <h2>What do you drive?</h2>
          <p class="muted">Just one vehicle to start. You can add more later from <code>/home-base</code>.</p>
          <div class="field">
            <label for="ob-vkey" class="field-label">Slug</label>
            <input
              id="ob-vkey"
              type="text"
              class="field-input field-input-narrow"
              bind:value={vehicleKey}
            />
            <p class="field-hint">A short key (e.g. <code>rav4</code>, <code>bolt</code>) used to override the default on specific trips.</p>
          </div>
          <div class="field">
            <label for="ob-vmodel" class="field-label">Model</label>
            <input
              id="ob-vmodel"
              type="text"
              class="field-input"
              placeholder="e.g. 2019 Toyota RAV4"
              bind:value={vehicleModel}
            />
          </div>
          <div class="field">
            <span class="field-label">Type</span>
            <div class="radio-row" role="radiogroup" aria-label="Vehicle type">
              {#each [['gas', 'Gas'], ['ev', 'Electric']] as [value, label]}
                <label class="radio-option" class:radio-option-active={vehicleType === value}>
                  <input type="radio" name="ob-vtype" {value} checked={vehicleType === value} onchange={() => { vehicleType = value; }} />
                  <span>{label}</span>
                </label>
              {/each}
            </div>
          </div>
          {#if vehicleType === 'ev'}
            <div class="ev-row">
              <div class="field">
                <label for="ob-vrange" class="field-label">EPA range (mi)</label>
                <input id="ob-vrange" type="number" min="0" step="1" class="field-input" placeholder="247" bind:value={vehicleRange} />
              </div>
              <div class="field">
                <label for="ob-vkw" class="field-label">DC fast-charge (kW)</label>
                <input id="ob-vkw" type="number" min="0" step="1" class="field-input" placeholder="55" bind:value={vehicleKw} />
              </div>
            </div>
          {/if}
          <div class="field">
            <label for="ob-vnotes" class="field-label">Notes (optional)</label>
            <textarea
              id="ob-vnotes"
              class="field-input"
              rows="3"
              placeholder="Cargo, towing, charging quirks…"
              bind:value={vehicleNotes}
            ></textarea>
          </div>
        {:else if step === 5}
          <h2>What makes a good trip for you?</h2>
          <p class="muted">Optional — but a few sentences here dramatically improves the LLM's idea generation. You can skip and come back to this later.</p>
          <div class="field">
            <label for="ob-likes" class="field-label">Tends to like</label>
            <textarea
              id="ob-likes"
              class="field-input"
              rows="3"
              placeholder="Scenic drives, quirky small towns, historic preservation, independent food + bookstores…"
              bind:value={tasteLikes}
            ></textarea>
          </div>
          <div class="field">
            <label for="ob-avoids" class="field-label">Tends to avoid</label>
            <textarea
              id="ob-avoids"
              class="field-input"
              rows="3"
              placeholder="Pure tourist traps, shopping-strip destinations, high-season crowds…"
              bind:value={tasteAvoids}
            ></textarea>
          </div>
          <div class="field">
            <label for="ob-seasons" class="field-label">Seasonal preferences (optional)</label>
            <textarea
              id="ob-seasons"
              class="field-input"
              rows="3"
              placeholder="How seasons affect your travel — heat tolerance, regions to avoid at certain times…"
              bind:value={tasteSeasonal}
            ></textarea>
          </div>
        {:else if step === 6}
          <h2>Review and write</h2>
          <p class="muted">This is exactly what will land in <code>home.md</code>. You can edit any of this later under <code>/home-base</code>.</p>
          <pre class="preview"><code>{previewYaml}</code></pre>
          {#if writeError}
            <p class="field-error">{writeError}</p>
          {/if}
        {/if}

        {#if step !== 1 && stepError() && step < 6}
          <p class="field-error">{stepError()}</p>
        {/if}
      </section>

      <div class="actions">
        {#if step > 1 && step < 6}
          <button type="button" class="btn btn-secondary" onclick={back} disabled={writing}>Back</button>
        {/if}
        {#if step === 5}
          <button type="button" class="btn btn-secondary" onclick={() => { tasteLikes = ''; tasteAvoids = ''; tasteSeasonal = ''; next(); }}>Skip</button>
        {/if}
        {#if step < 6}
          <button type="button" class="btn btn-primary" onclick={next} disabled={!!stepError()}>
            {step === 1 ? "Let's go" : 'Next'}
          </button>
        {:else}
          <button type="button" class="btn btn-secondary" onclick={back} disabled={writing}>Back</button>
          <button type="button" class="btn btn-primary" onclick={writeHomeAndContinue} disabled={writing}>
            {writing ? 'Writing…' : 'Save home.md and continue'}
          </button>
        {/if}
      </div>
    </div>
  </main>
</div>

<ConfirmModal
  bind:open={discardOpen}
  title="Discard your answers?"
  body="You'll lose what you've entered so far. You can always restart the wizard from the home page."
  confirmLabel="Discard"
  danger
  onconfirm={confirmDiscard}
  oncancel={cancelDiscard}
/>

<style>
  .page {
    min-height: 100vh;
    background: var(--surface-page);
    color: var(--text-primary);
    font-family: var(--font-sans);
  }

  header {
    padding: 18px 24px;
    border-bottom: 1px solid var(--border-subtle);
  }

  .wordmark {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  h1 {
    font-size: 17px;
    font-weight: 500;
    margin: 0;
  }

  .slash {
    color: var(--text-tertiary);
    margin: 0 4px;
  }

  main {
    max-width: 720px;
    margin: 0 auto;
    padding: 32px 24px 96px;
  }

  .step-rail {
    display: flex;
    list-style: none;
    padding: 0;
    margin: 0 0 32px;
    gap: 6px;
    flex-wrap: wrap;
  }

  .step-pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 12px 4px 10px;
    border: 1px solid var(--border-default);
    border-radius: 999px;
    font-size: 11px;
    color: var(--text-tertiary);
  }

  .step-pill-active {
    border-color: var(--accent);
    color: var(--text-primary);
    background: var(--surface-raised);
  }

  .step-pill-done {
    color: var(--text-secondary);
  }

  .step-num {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--surface-raised);
    color: var(--text-secondary);
    font-size: 10px;
    font-weight: 600;
  }

  .step-pill-active .step-num {
    background: var(--accent);
    color: var(--text-inverse);
  }

  .step {
    background: var(--surface-card, var(--surface-raised));
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    padding: 28px 28px 24px;
    margin-bottom: 20px;
  }

  .step h2 {
    margin: 0 0 8px;
    font-size: 22px;
    font-weight: 600;
  }

  .step p {
    margin: 0 0 14px;
    line-height: 1.55;
    color: var(--text-secondary);
  }

  .muted {
    color: var(--text-tertiary);
    font-size: 13px;
  }

  .field {
    display: flex;
    flex-direction: column;
    margin-top: 14px;
  }

  .field-label {
    font-size: 12px;
    color: var(--text-secondary);
    margin-bottom: 4px;
  }

  .field-input {
    font: inherit;
    padding: 8px 10px;
    border: 1px solid var(--border-default);
    border-radius: 4px;
    background: var(--surface-page);
    color: var(--text-primary);
  }

  .field-input-narrow { max-width: 200px; }

  .field-hint {
    font-size: 11px;
    color: var(--text-tertiary);
    margin: 4px 0 0;
  }

  .field-error {
    font-size: 12px;
    color: var(--state-danger);
    margin: 10px 0 0;
  }

  .checkbox-row {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
  }

  .radio-row {
    display: flex;
    gap: 8px;
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
  }

  .radio-option-active {
    border-color: var(--accent);
    background: var(--surface-raised);
  }

  .ev-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }

  .preview {
    background: var(--surface-page);
    border: 1px solid var(--border-subtle);
    border-radius: 4px;
    padding: 14px 16px;
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    line-height: 1.6;
    color: var(--text-secondary);
    white-space: pre-wrap;
    max-height: 420px;
    overflow-y: auto;
  }

  .actions {
    display: flex;
    gap: 10px;
    justify-content: flex-end;
  }

  .btn {
    padding: 8px 18px;
    border-radius: 4px;
    font: inherit;
    font-size: 13px;
    cursor: pointer;
    border: 1px solid transparent;
  }

  .btn-primary {
    background: var(--surface-invert);
    color: var(--text-inverse);
    border-color: var(--surface-invert);
  }

  .btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-secondary {
    background: transparent;
    color: var(--text-primary);
    border-color: var(--border-default);
  }

  .btn-secondary:hover {
    border-color: var(--border-strong);
  }
</style>

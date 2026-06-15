# Candidates Card Progressive Disclosure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make candidate cards show the full decision-driving content (description + `why_recommended` + website) at rest and tuck address/hours/phone behind a `Details` disclosure, so mobile cards stop truncating the description and stop wasting space on metadata that only matters after a stop is selected.

**Architecture:** Pure presentational edits to two Svelte 5 components — `StopCard.svelte` (non-compact rendering only) and `LodgingCard.svelte`. StopCard splits the old folded `summary` into two independent fields, lifts the website link to rest, and moves address/hours/phone into a native `<details>` disclosure reusing the existing compact-drawer vocabulary. LodgingCard just drops its description clamp. No schema, data, endpoint, generator, or `app.css` changes.

**Tech Stack:** SvelteKit 2 / Svelte 5 (runes: `$props`, `$derived`), CSS custom-property tokens, native `<details>/<summary>`. Verification via `svelte-check --fail-on-warnings`, `vite build`, and a manual Playwright-MCP pass.

**Spec:** `docs/superpowers/specs/2026-06-15-candidates-card-progressive-disclosure-design.md`

---

## Testing approach (read first)

This project has **no component-unit test harness** (no `@testing-library/svelte`, no jsdom/happy-dom). Adding one for two presentational components is out of scope and against the "follow existing patterns" rule. Per `CLAUDE.md`, UI changes are verified by:

1. `npm run check` — `svelte-check --fail-on-warnings`. This is a real gate here: Svelte emits an **"Unused CSS selector"** warning when a styled class is removed from markup, and `--fail-on-warnings` turns that into a failure. So each task must remove now-orphaned selectors (notably `.meta-block`) in the same commit that removes their markup.
2. `npm run build` — production build must succeed.
3. A manual Playwright-MCP pass against the dev server (Task 4), driven from the spec's Manual QA checklist.

There are no `vitest` steps in this plan because there is nothing pure-JS to unit-test — the changes are markup + CSS. Keep every commit green by editing script + template + CSS of a component together, then running `npm run check` before committing.

---

## File structure

- **Modify:** `src/lib/components/StopCard.svelte` — split `summary` → `description` + `why`; drop `hasMeta`; add `hasCandidateDrawer`; restructure non-compact body markup; unclamp `.summary`; add `.why`, `.rest-meta`, `.rest-disclosure`/`.rest-summary`/`.rest-chev`/`.rest-drawer` styles + touch floor; remove `.meta-block` rule.
- **Modify:** `src/lib/components/LodgingCard.svelte` — remove the `-webkit-line-clamp` block from `.summary`.

Both files' `compact` rendering and all other surfaces (PlanSection day cards, Today view, brochure) are untouched.

---

## Task 1: StopCard — split content fields + drawer gate (script)

**Files:**
- Modify: `src/lib/components/StopCard.svelte` (script block, ~lines 59–76)

- [ ] **Step 1: Replace the `hasMeta`/`summary` derivations**

Find this block (currently lines 59–76):

```js
  const hasMeta = $derived(!!(stop.address || stop.hours || stop.website || stop.phone));
  const mapsUrl = $derived(mapsHref(stop.address));
  const telUrl = $derived(telHref(stop.phone));
  const webUrl = $derived(websiteHref(stop.website));
  const webLabel = $derived(stop.website ? hostLabel(stop.website) : '');

  // The visible text below the title. Fold `why_recommended` into the
  // description if both exist and the description is short — keeps the
  // card to one paragraph at rest. If both are long, the full `why` is
  // surfaced on the title attr / hover state.
  const summary = $derived.by(() => {
    const desc = (stop.description || '').trim();
    const why = (stop.why_recommended || '').trim();
    if (!desc) return why;
    if (!why) return desc;
    if (desc.length + why.length < 140) return `${desc} ${why}`;
    return desc;
  });
```

Replace it with:

```js
  const mapsUrl = $derived(mapsHref(stop.address));
  const telUrl = $derived(telHref(stop.phone));
  const webUrl = $derived(websiteHref(stop.website));
  const webLabel = $derived(stop.website ? hostLabel(stop.website) : '');

  // description and why_recommended are two distinct human-facing fields,
  // rendered as separate lines at rest and never folded: description = what
  // the place is (factual); why_recommended = why it fits this traveler
  // (personalized to home.md + the trip vibe). The old fold heuristic dropped
  // `why` whenever the two together ran long — i.e. on exactly the
  // substantive cards — so the best decision signal was silently lost.
  const description = $derived((stop.description || '').trim());
  const why = $derived((stop.why_recommended || '').trim());

  // Non-compact "Details" disclosure holds address/hours/phone — the fields
  // that only matter once a stop is selected. Website is lifted to rest (the
  // one link used to research a place pre-selection), so it's excluded here.
  const hasCandidateDrawer = $derived(!!(stop.address || stop.hours || telUrl));
```

> Note: the compact-mode derivations below (`hasContactDetail`, `hasDrawer`, `drawerLabel`, etc.) are unchanged — do not touch them. This task only replaces the two non-compact derivations above.

- [ ] **Step 2: Do not commit yet** — the template still references the removed `summary`/`hasMeta` and `.meta-block`. Proceed to Task 2 so `npm run check` passes before the first commit.

---

## Task 2: StopCard — restructure non-compact body (template) + CSS, then verify + commit

**Files:**
- Modify: `src/lib/components/StopCard.svelte` (template ~lines 143–178; styles in the `<style>` block)

- [ ] **Step 1: Replace the non-compact summary + meta-block markup**

Find this block (currently lines 143–178 — the `{#if summary && !compact}` paragraph and the `{#if hasMeta && !compact}` meta-block):

```svelte
  {#if summary && !compact}
    <p class="summary">{summary}</p>
  {/if}

  {#if hasMeta && !compact}
    <div class="meta-block" aria-label="Stop details">
      {#if stop.address}
        {#if mapsUrl}
          <a class="addr-line" href={mapsUrl} target="_blank" rel="noopener" aria-label="Open in maps: {stop.address}" onclick={(e) => e.stopPropagation()}>
            <svg class="meta-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-6-5.3-6-10a6 6 0 0 1 12 0c0 4.7-6 10-6 10z" /><circle cx="12" cy="11" r="2" /></svg><span class="meta-text">{stop.address}</span>
          </a>
        {:else}
          <span class="addr-line addr-line--static"><svg class="meta-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-6-5.3-6-10a6 6 0 0 1 12 0c0 4.7-6 10-6 10z" /><circle cx="12" cy="11" r="2" /></svg><span class="meta-text">{stop.address}</span></span>
        {/if}
      {/if}
      {#if stop.hours || webUrl || telUrl}
        <div class="meta-actions">
          {#if stop.hours}
            <span class="meta-act meta-act--info" title={stop.hours}>
              <svg class="meta-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 1.8" /></svg><span class="meta-text">{stop.hours}</span>
            </span>
          {/if}
          {#if webUrl}
            <a class="meta-act" href={webUrl} target="_blank" rel="noopener" aria-label="Website: {webLabel}" onclick={(e) => e.stopPropagation()}>
              <svg class="meta-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6" /><path d="M20 4 11 13" /><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" /></svg><span class="meta-text">{webLabel}</span>
            </a>
          {/if}
          {#if telUrl}
            <a class="meta-act" href={telUrl} aria-label="Call {stop.phone}" onclick={(e) => e.stopPropagation()}>
              <svg class="meta-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6.5 4h-2A1.5 1.5 0 0 0 3 5.5 15.5 15.5 0 0 0 18.5 21 1.5 1.5 0 0 0 20 19.5v-2a1.5 1.5 0 0 0-1.2-1.47l-2.4-.48a1.5 1.5 0 0 0-1.43.53l-.7.86a12 12 0 0 1-5.2-5.2l.86-.7a1.5 1.5 0 0 0 .53-1.43l-.48-2.4A1.5 1.5 0 0 0 6.5 4z" /></svg><span class="meta-text">call</span>
            </a>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
```

Replace the entire block above with:

```svelte
  {#if !compact}
    {#if description}
      <p class="summary">{description}</p>
    {/if}
    {#if why}
      <p class="why"><span class="why-mark" aria-hidden="true">↳</span>{why}</p>
    {/if}
    {#if webUrl}
      <div class="rest-meta">
        <a class="meta-act" href={webUrl} target="_blank" rel="noopener" aria-label="Website: {webLabel}" onclick={(e) => e.stopPropagation()}>
          <svg class="meta-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6" /><path d="M20 4 11 13" /><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" /></svg><span class="meta-text">{webLabel}</span>
        </a>
      </div>
    {/if}
    {#if hasCandidateDrawer}
      <details class="rest-disclosure">
        <summary class="rest-summary">
          <span class="rest-chev" aria-hidden="true">›</span>
          Details
        </summary>
        <div class="rest-drawer" aria-label="Stop details">
          {#if stop.address}
            {#if mapsUrl}
              <a class="addr-line" href={mapsUrl} target="_blank" rel="noopener" aria-label="Open in maps: {stop.address}" onclick={(e) => e.stopPropagation()}>
                <svg class="meta-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-6-5.3-6-10a6 6 0 0 1 12 0c0 4.7-6 10-6 10z" /><circle cx="12" cy="11" r="2" /></svg><span class="meta-text">{stop.address}</span>
              </a>
            {:else}
              <span class="addr-line addr-line--static"><svg class="meta-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-6-5.3-6-10a6 6 0 0 1 12 0c0 4.7-6 10-6 10z" /><circle cx="12" cy="11" r="2" /></svg><span class="meta-text">{stop.address}</span></span>
            {/if}
          {/if}
          {#if stop.hours || telUrl}
            <div class="meta-actions">
              {#if stop.hours}
                <span class="meta-act meta-act--info" title={stop.hours}>
                  <svg class="meta-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 1.8" /></svg><span class="meta-text">{stop.hours}</span>
                </span>
              {/if}
              {#if telUrl}
                <a class="meta-act" href={telUrl} aria-label="Call {stop.phone}" onclick={(e) => e.stopPropagation()}>
                  <svg class="meta-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6.5 4h-2A1.5 1.5 0 0 0 3 5.5 15.5 15.5 0 0 0 18.5 21 1.5 1.5 0 0 0 20 19.5v-2a1.5 1.5 0 0 0-1.2-1.47l-2.4-.48a1.5 1.5 0 0 0-1.43.53l-.7.86a12 12 0 0 1-5.2-5.2l.86-.7a1.5 1.5 0 0 0 .53-1.43l-.48-2.4A1.5 1.5 0 0 0 6.5 4z" /></svg><span class="meta-text">call</span>
                </a>
              {/if}
            </div>
          {/if}
        </div>
      </details>
    {/if}
  {/if}
```

> The compact-mode blocks immediately below (`{#if compact && (stop.address ...)}` and `{#if compact && hasDrawer}`) are unchanged — leave them as-is.

- [ ] **Step 2: Unclamp `.summary` and add the new style rules**

Find the `.summary` rule (currently lines 521–533):

```css
  .summary {
    margin: 0;
    font-size: 0.84rem;
    line-height: 1.45;
    color: var(--text-secondary);
    /* Multi-line clamp at 2 — long descriptions never expand the card
       beyond a tight resting height. */
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
```

Replace it with (drops the clamp, adds `.why` / `.why-mark` / `.rest-meta`):

```css
  .summary {
    margin: 0;
    font-size: 0.84rem;
    line-height: 1.45;
    color: var(--text-secondary);
  }
  /* why_recommended — the personalized "why this fits you" line, distinct
     from the factual description above it. Muted, with a leading ↳ glyph
     (a text marker, not an absolutely-positioned side-stripe) so it reads
     as the rationale rather than another fact. */
  .why {
    margin: 0;
    display: flex;
    gap: 0.35rem;
    font-size: 0.82rem;
    line-height: 1.4;
    color: var(--text-tertiary);
  }
  .why-mark {
    color: var(--accent-text);
    flex-shrink: 0;
  }
  /* Website lifted to rest out of the old meta-block; reuses .meta-act. */
  .rest-meta {
    margin-top: 0.05rem;
  }
```

- [ ] **Step 3: Remove the now-orphaned `.meta-block` rule**

Find and delete this rule (currently lines 540–545). Leaving it triggers an "Unused CSS selector" warning that fails `--fail-on-warnings`:

```css
  .meta-block {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    margin-top: 0.1rem;
  }
```

> Keep `.meta-svg`, `.addr-line`, `.meta-actions`, `.meta-act`, `.meta-text`, `.addr-line--static`, `.meta-act--info` and the existing `@media (pointer: coarse) { a.addr-line, a.meta-act { ... } }` rule — they're all still used inside the new drawer.

- [ ] **Step 4: Add the disclosure styles**

Insert the following immediately after the `@media (pointer: coarse) { a.addr-line, a.meta-act { min-height: var(--tap-min); } }` rule (currently ~lines 596–599), before the `.drawer-contact` comment block:

```css
  /* ── Details disclosure (non-compact candidate card) ──────────────────
     Address/hours/phone tuck behind a native <details> pill, mirroring the
     compact StopCard / TodayStopCard drawer vocabulary (rotating chevron,
     tap-floored summary, reduced-motion guard) but styled for the candidate
     card's --surface-raised chassis (transparent pill + subtle border, so it
     doesn't vanish against the card's own raised fill). */
  .rest-disclosure { margin-top: 0.05rem; }
  .rest-summary {
    list-style: none;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.76rem;
    font-weight: 500;
    color: var(--text-secondary);
    user-select: none;
    background: transparent;
    border: 0.5px solid var(--border-subtle);
    border-radius: 999px;
    padding: 0.25rem 0.65rem 0.25rem 0.5rem;
    transition: background-color 0.12s, border-color 0.12s, color 0.12s;
  }
  .rest-summary:hover {
    background: var(--surface-sunken);
    border-color: var(--border-default);
    color: var(--text-primary);
  }
  .rest-summary::-webkit-details-marker { display: none; }
  .rest-chev {
    font-size: 0.8rem;
    line-height: 1;
    color: var(--accent-text);
    transition: transform 0.15s ease;
  }
  .rest-disclosure[open] .rest-chev { transform: rotate(90deg); }
  @media (prefers-reduced-motion: reduce) {
    .rest-chev { transition: none; }
  }
  .rest-drawer {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    margin-top: 0.4rem;
  }
  @media (pointer: coarse) {
    .rest-summary { min-height: var(--tap-min); }
  }
```

- [ ] **Step 5: Run the type/lint gate**

Run: `npm run check`
Expected: PASS — `svelte-check found 0 errors and 0 warnings`. In particular, no "Unused CSS selector" warning for `.meta-block`, `summary`, or `hasMeta`. If one appears, you missed deleting an orphaned selector or an unused `$derived` — fix before committing.

- [ ] **Step 6: Commit**

```bash
git add src/lib/components/StopCard.svelte
git commit -m "refactor(candidates): progressive disclosure on stop cards

Split summary into full description + why_recommended lines (why was
dropped by the 140-char fold). Lift website to rest; tuck
address/hours/phone behind a Details <details> disclosure. Unclamp the
description. Non-compact rendering only.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: LodgingCard — unclamp description

**Files:**
- Modify: `src/lib/components/LodgingCard.svelte` (`.summary` rule, ~lines 383–393)

- [ ] **Step 1: Remove the clamp**

Find the `.summary` rule (currently lines 383–393):

```css
  .summary {
    margin: 0;
    font-size: 0.84rem;
    line-height: 1.45;
    color: var(--text-secondary);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
```

Replace it with:

```css
  .summary {
    margin: 0;
    font-size: 0.84rem;
    line-height: 1.45;
    color: var(--text-secondary);
  }
```

- [ ] **Step 2: Run the type/lint gate**

Run: `npm run check`
Expected: PASS — `0 errors and 0 warnings`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/components/LodgingCard.svelte
git commit -m "refactor(candidates): unclamp lodging card description

Show the full lodging description at rest. No disclosure added — lodging
carries no address/hours/phone; its meta is all decision-relevant.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Full verify + manual QA

**Files:** none (verification only)

- [ ] **Step 1: Run the full go/no-go**

Run: `npm run verify`
Expected: `svelte-check` PASS (0/0), `vitest run` all green (no tests changed, so this confirms no regression in shared utils), `vite build` succeeds.

- [ ] **Step 2: Seed sample data and start the dev server**

The Galena sample (`sample-data/planning/galena-illinois/candidates.yaml`) has stops with `description`, `why_recommended`, `address`, `hours`, and `phone` — ideal coverage for QA.

Run:
```bash
npm run seed-sample
npm run dev -- --port 3456
```

- [ ] **Step 3: Manual Playwright-MCP pass (mobile / coarse pointer)**

Drive `http://localhost:3456/trips/galena-illinois` → Candidates section. Emulate a touch device (`hasTouch: true`, narrow viewport) per `docs/manual-qa.md` and the coarse-pointer QA note. Walk the spec's checklist:

- [ ] Stop with a long description shows it **in full** at rest (no ellipsis).
- [ ] Stop with `why_recommended` shows the `↳` muted line — including on a card where description + why together exceed 140 chars (previously dropped). The Main Street / Grant Home stops are good cases.
- [ ] Website link appears at rest when present; opens in a new tab; clicking it does **not** toggle anything.
- [ ] `Details` pill appears only when address/hours/phone exist; expands to reveal them; chevron rotates; address opens maps, phone dials (`tel:`).
- [ ] A stop with only a website (no address/hours/phone): website at rest, **no** `Details` pill.
- [ ] A bare stop (name + description only): no website line, no pill.
- [ ] Lodging tab: description shows in full at rest; no disclosure added.
- [ ] Plan section day cards (compact StopCard/LodgingCard) and the Today view (`/trips/galena-illinois/today`) are visually unchanged.
- [ ] `Details` summary clears the 44px tap floor on touch; chevron honors reduced-motion (toggle OS reduce-motion or emulate).

- [ ] **Step 4: Record the QA result**

Note pass/fail (with screenshots for anything surprising) in the PR description. This pass is exploratory, not a regression net — file follow-ups for anything out of scope rather than expanding this change.

---

## Self-review

**Spec coverage:**
- StopCard resting order (badge/name/distance unchanged → full description → why line → website → Details → footer) → Task 2 Step 1. ✓
- Description unclamped, unbounded → Task 2 Step 2. ✓
- `why_recommended` as its own muted `↳` line, never dropped → Task 1 Step 1 (split) + Task 2 Steps 1–2. ✓
- Website lifted to rest → Task 2 Step 1. ✓
- `Details` disclosure (chevron pill, native details, reduced-motion, tap floor) for address/hours/phone → Task 2 Steps 1 + 4. ✓
- Disclosure gating (only when address/hours/phone present; website excluded; bare stop shows nothing extra) → Task 1 Step 1 (`hasCandidateDrawer`) + Task 2 Step 1. ✓
- LodgingCard description unclamped, no disclosure → Task 3. ✓
- Compact / Today untouched; presentational only; no new tokens → all edits gated on `!compact`, no `app.css` change, no data edits. ✓
- Manual QA checklist → Task 4. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete old→new code. ✓

**Type/name consistency:** `description`, `why`, `hasCandidateDrawer`, `webUrl`, `webLabel`, `telUrl`, `mapsUrl` referenced in Task 2 are all defined in Task 1 / pre-existing. New CSS classes (`.why`, `.why-mark`, `.rest-meta`, `.rest-disclosure`, `.rest-summary`, `.rest-chev`, `.rest-drawer`) are all both styled (Task 2 Steps 2/4) and used in markup (Task 2 Step 1). Removed identifiers (`summary`, `hasMeta`, `.meta-block`) are deleted from both script/template and CSS in the same task, keeping `--fail-on-warnings` green. ✓

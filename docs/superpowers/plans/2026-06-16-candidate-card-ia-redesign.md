# Candidate stop card IA redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-rank the non-compact candidate `StopCard` around the promote decision — `why_recommended` as the hero line, a 2-line-clamped description with `…more`, and a single `expanded` state that reveals the full description plus a full-width logistics panel (hours/address/phone), retiring the lopsided half-width Details drawer.

**Architecture:** Pure presentation change to one Svelte component (`src/lib/components/StopCard.svelte`), non-compact branch only. A component-local `expanded` `$state` drives both the description un-clamp and the logistics panel. The `compact`/`inRail` branches are untouched. A ResizeObserver probe sets whether the clamped description overflows (so `…more` only shows when needed). Reuses the file's existing inline stroke-SVG icons (no emoji). Plus removal of dead `onClick`/`scrollToCard` wiring.

**Tech Stack:** Svelte 5 (runes: `$state`/`$derived`/`$props`, `use:` actions), scoped `<style>` with `src/app.css` custom-property tokens, `npm run verify` (svelte-check `--fail-on-warnings` + tests + build), Playwright-MCP for layout QA.

**Spec:** `docs/superpowers/specs/2026-06-16-candidate-card-ia-redesign-design.md`

---

## Testing note (read first)

This repo has **no component/DOM test harness** — vitest runs logic-only (no jsdom/happy-dom, no `@testing-library/svelte`). Do **not** add one (out of scope). A CSS/markup redesign is verified by:
- `npm run check` (svelte-check `--fail-on-warnings`) — catches Svelte errors, a11y warnings, **and unused CSS selectors** (we use this to find dead CSS precisely),
- `npm run build`,
- a **Playwright-MCP** pass measuring `scrollWidth ≤ clientWidth` at 390px with panels open (the exact check that caught #527) + visual confirm.

There are no red-green unit steps here; the per-task gate is svelte-check + build, and Task 3 is the browser verification.

## File Structure

- **Modify** `src/lib/components/StopCard.svelte` — script (new state/derived/action), the `<head>` distance, the non-compact markup block (lines ~160–212), and `<style>` (new rules; remove now-dead non-compact `.rest-*`/`.meta-*` selectors incl. the #527 `min-width:0` patch).
- **Modify** `src/lib/components/CandidatesSection.svelte` — drop the dead `onClick={scrollToCard}` pass-throughs.

No new files.

---

## Task 1: Redesign the non-compact StopCard

**Files:**
- Modify: `src/lib/components/StopCard.svelte`

### Step 1: Add state, derived, and the clamp probe to `<script>`

- [ ] Insert the following just before the closing `</script>` (after the `handleDragStart` function, ~line 124):

```svelte
  // ── Candidate (non-compact) expand model ──────────────────────────────
  // One boolean drives both the description un-clamp and the logistics panel
  // (the unified "one tap reveals the rest" behavior). Native <details> can't
  // span both, so this is plain state.
  let expanded = $state(false);
  function toggleExpanded() { expanded = !expanded; }

  // Address / hours / phone populate the expanded logistics panel.
  const hasLogistics = $derived(!!(stop.address || stop.hours || telUrl));

  // `…more` shows only when the 2-line-clamped description actually overflows.
  // A ResizeObserver probe re-measures on width/clamp changes. When expanded
  // the clamp is off so the node doesn't overflow → descOverflows is false,
  // which is fine (we hide `…more` while expanded anyway).
  let descOverflows = $state(false);
  function clampProbe(node) {
    const measure = () => { descOverflows = node.scrollHeight - node.clientHeight > 1; };
    const ro = new ResizeObserver(measure);
    ro.observe(node);
    measure();
    return { destroy() { ro.disconnect(); } };
  }

  // Anything to expand into? (full description tail OR logistics)
  const expandable = $derived(hasLogistics || descOverflows);
```

Note: `mapsUrl`, `telUrl`, `primaryUrl`, `primaryLabel`, `description`, `why` already exist above — reuse them.

### Step 2: Remove the distance from `<head>` (it moves to the meta row)

- [ ] Delete these lines from the `.head` block (~lines 152–154):

```svelte
    {#if distance != null && !compact}
      <span class="distance" title="Distance from destination">{distance} mi</span>
    {/if}
```

(The `compact` distance render in `.compact-addr` at ~line 225 is unaffected — leave it.)

### Step 3: Replace the non-compact body block

- [ ] Replace the entire non-compact block — from `{#if !compact}` (~line 160) through its matching close just before `{#if compact && (stop.address || distance != null)}` (~line 213). The block to replace currently contains `cat-label`, `summary`, `why`, and the `rest-row` (lines ~160–212). New block:

```svelte
  {#if !compact}
    {#if stop.category}
      <span class="cat-label">{stop.category}</span>
    {/if}
    {#if why}
      <p class="why"><span class="why-mark" aria-hidden="true">↳</span>{why}</p>
    {/if}
    {#if description}
      <p class="summary" class:clamped={!expanded} use:clampProbe>{description}</p>
      {#if !expanded && descOverflows}
        <button type="button" class="more" onclick={toggleExpanded}>…more</button>
      {/if}
    {/if}

    {#if expandable || distance != null || primaryUrl}
      <div class="rest-meta">
        {#if expandable}
          <button
            type="button"
            class="toggle"
            aria-expanded={expanded}
            aria-label={expanded ? 'Hide details' : 'Show details'}
            onclick={toggleExpanded}
          >
            {#if distance != null}<span class="meta-distance">
              <svg class="meta-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-6-5.3-6-10a6 6 0 0 1 12 0c0 4.7-6 10-6 10z" /><circle cx="12" cy="11" r="2" /></svg>{distance} mi
            </span>{/if}
            <span class="chev" class:open={expanded} aria-hidden="true">▾</span>
          </button>
        {:else if distance != null}
          <span class="meta-distance">
            <svg class="meta-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-6-5.3-6-10a6 6 0 0 1 12 0c0 4.7-6 10-6 10z" /><circle cx="12" cy="11" r="2" /></svg>{distance} mi
          </span>
        {/if}
        {#if primaryUrl}
          <a class="rest-link" href={primaryUrl} target="_blank" rel="noopener" aria-label="{primaryLabel} (opens in a new tab)" onclick={(e) => e.stopPropagation()}>
            <svg class="meta-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6" /><path d="M20 4 11 13" /><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" /></svg><span class="rest-link-text">{primaryLabel}</span>
          </a>
        {/if}
      </div>

      {#if expanded && hasLogistics}
        <div class="logistics" aria-label="Stop details">
          {#if stop.hours}
            <div class="li">
              <svg class="meta-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 1.8" /></svg><span class="li-tx">{stop.hours}</span>
            </div>
          {/if}
          {#if stop.address}
            {#if mapsUrl}
              <a class="li li--act" href={mapsUrl} target="_blank" rel="noopener" aria-label="Open in maps: {stop.address}" onclick={(e) => e.stopPropagation()}>
                <svg class="meta-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-6-5.3-6-10a6 6 0 0 1 12 0c0 4.7-6 10-6 10z" /><circle cx="12" cy="11" r="2" /></svg><span class="li-tx">{stop.address}</span>
              </a>
            {:else}
              <div class="li">
                <svg class="meta-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-6-5.3-6-10a6 6 0 0 1 12 0c0 4.7-6 10-6 10z" /><circle cx="12" cy="11" r="2" /></svg><span class="li-tx">{stop.address}</span>
              </div>
            {/if}
          {/if}
          {#if telUrl}
            <a class="li li--act" href={telUrl} aria-label="Call {stop.phone}" onclick={(e) => e.stopPropagation()}>
              <svg class="meta-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6.5 4h-2A1.5 1.5 0 0 0 3 5.5 15.5 15.5 0 0 0 18.5 21 1.5 1.5 0 0 0 20 19.5v-2a1.5 1.5 0 0 0-1.2-1.47l-2.4-.48a1.5 1.5 0 0 0-1.43.53l-.7.86a12 12 0 0 1-5.2-5.2l.86-.7a1.5 1.5 0 0 0 .53-1.43l-.48-2.4A1.5 1.5 0 0 0 6.5 4z" /></svg><span class="li-tx">{stop.phone}</span>
            </a>
          {/if}
        </div>
      {/if}
    {/if}
  {/if}
```

Key changes vs. the old block: `why` now renders **above** `description`; `description` is clamped via `.clamped` with a sibling `…more`; the old `.rest-row` (Details-disclosure-beside-link) is gone, replaced by `.rest-meta` (distance toggle + link) and an `expanded`-gated full-width `.logistics` panel.

### Step 4: Update `<style>` — add new rules

- [ ] In the `<style>` block, restyle `.why` to be the hero line and `.summary` to be the secondary, clampable line. Find the existing `.summary` and `.why` rules (~lines 578–599) and replace them with:

```css
  /* why_recommended is the hero decision line ("is this for me?") — promoted
     above the factual description and given primary-ish emphasis. */
  .why {
    margin: 0;
    display: flex;
    gap: 0.35rem;
    font-size: 0.85rem;
    line-height: 1.42;
    color: var(--text-primary);
  }
  .why-mark {
    color: var(--accent-text);
    flex-shrink: 0;
  }
  /* description = the factual "what it is", demoted under the why line and
     clamped to two lines at rest; `…more` reveals the rest via the same
     expand as the logistics panel. */
  .summary {
    margin: 0;
    font-size: 0.82rem;
    line-height: 1.45;
    color: var(--text-secondary);
  }
  .summary.clamped {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .more {
    align-self: flex-start;
    margin-top: 0.1rem;
    padding: 0;
    background: none;
    border: none;
    font: inherit;
    font-size: 0.78rem;
    color: var(--accent-text);
    cursor: pointer;
  }
  .more:hover { text-decoration: underline; text-underline-offset: 2px; }
```

- [ ] Add the new meta-row + logistics styles, **replacing** the old `.rest-row` and `.rest-link` rules in place (~lines 600–617). `.rest-link` is redefined here (same class name, new rules) — make sure only one `.rest-link` rule survives. The remaining dead selectors are removed in Step 5:

```css
  /* Rest meta row — the expand toggle (distance + chevron) on the left, the
     single deduped website/source link on the right. min-width:0 throughout
     so a long host label truncates instead of widening the card's 1fr track. */
  .rest-meta {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    min-width: 0;
    margin-top: 0.15rem;
  }
  .toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    min-width: 0;
    padding: 0.15rem 0;
    background: none;
    border: none;
    font: inherit;
    color: var(--text-tertiary);
    cursor: pointer;
    border-radius: 4px;
  }
  .toggle:focus-visible {
    outline: 2px solid var(--accent-text);
    outline-offset: 2px;
  }
  /* Distinct from the category-tinted `.distance` pill (still used by compact
     Plan-day cards) — the meta-row distance is a quiet inline pin + value. */
  .meta-distance {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.76rem;
    color: var(--text-tertiary);
    white-space: nowrap;
  }
  .chev {
    font-size: 0.7rem;
    line-height: 1;
    color: var(--text-tertiary);
    transition: transform 0.15s ease;
  }
  .chev.open { transform: rotate(180deg); }
  @media (prefers-reduced-motion: reduce) {
    .chev { transition: none; }
  }
  .rest-link {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    min-width: 0;
    margin-left: auto;
    font-size: 0.76rem;
    color: var(--text-tertiary);
    text-decoration: none;
  }
  .rest-link:hover { color: var(--accent-text); }
  .rest-link:hover .meta-svg { color: var(--accent-text); }
  .rest-link:hover .rest-link-text { text-decoration: underline; text-underline-offset: 2px; }
  .rest-link-text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* NOTE: `.meta-svg` (≈13px stroke SVG, currentColor) already exists in this
     file and is reused by the markup above — do NOT add a second rule for it. */
  /* Expanded logistics panel — full-width block (not a flex item beside the
     link), so long multi-day hours wrap cleanly and nothing overflows. */
  .logistics {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    margin-top: 0.5rem;
    padding-top: 0.5rem;
    border-top: 0.5px solid var(--border-subtle);
  }
  .li {
    display: flex;
    align-items: flex-start;
    gap: 0.45rem;
    min-width: 0;
    font-size: 0.8rem;
    line-height: 1.4;
    color: var(--text-secondary);
    text-decoration: none;
  }
  .li .meta-svg { margin-top: 0.15rem; color: var(--text-tertiary); }
  .li-tx { min-width: 0; overflow-wrap: anywhere; }
  a.li--act { cursor: pointer; }
  a.li--act:hover { color: var(--accent-text); }
  a.li--act:hover .meta-svg { color: var(--accent-text); }
  a.li--act:hover .li-tx { text-decoration: underline; text-underline-offset: 2px; }
  @media (pointer: coarse) {
    .toggle, .more, .rest-link, a.li--act { min-height: var(--tap-min); }
  }
```

### Step 5: Remove now-dead CSS and verify it compiles cleanly

- [ ] Run: `npm run check`
- [ ] svelte-check will report **unused CSS selector** warnings for the old non-compact rest-row styles now that their markup is gone. Remove exactly the selectors it names — expected set: `.rest-row`, `.rest-disclosure`, `.rest-summary`, `.rest-summary:hover`, `.rest-summary::-webkit-details-marker`, `.rest-chev`, `.rest-disclosure[open] .rest-chev`, `.rest-drawer`, `.addr-line`, `a.addr-line`/`:hover` variants, `.addr-line--static`, `.meta-actions`, `.meta-act`, `a.meta-act`/`:hover` variants, `.meta-text`, and the `@media (pointer: coarse) { .rest-summary … }` block — **including the `min-width:0` lines added to `.rest-row`/`.rest-disclosure` in #527**.
  - **Caution:** do NOT remove selectors still used elsewhere — `.rest-link` (redefined in Step 4, still used), `.meta-svg` (reused by the new markup), `.distance` (the category-tinted pill, still used by compact Plan-day cards), and the `compact`/`inRail` selectors `.compact-addr`, `.addr-link`, `.addr-text`, `.addr-pin`, `.meta-link`, `.meta-line`, `.prep`, `.disclosure`, `.disclosure-summary`, `.disclosure-chev`, `.prep-content`, `.drawer-contact`, `.tips`, `.todos`, `.cat-badge`, `.cat-dot`, `.cat-label`, `.compact-distance`. svelte-check only flags genuinely-unused selectors, so trust its list — but if it flags one of these, a markup ref was lost by mistake; re-check Step 3 rather than deleting it.
- [ ] Re-run `npm run check` until it reports `0 WARNINGS` with a real file count (not `0 FILES`).

### Step 6: Commit

```bash
git add src/lib/components/StopCard.svelte
git commit -m "refresh(candidates): decision-first stop card with unified expand"
```

---

## Task 2: Remove dead onClick / scrollToCard wiring

**Files:**
- Modify: `src/lib/components/StopCard.svelte`
- Modify: `src/lib/components/CandidatesSection.svelte`

Context: `CandidatesSection` passes `onClick={scrollToCard}` to `StopCard` (and `LodgingCard`), but `StopCard` never invokes `onClick` on the `<article>` — whole-card click is dead, and the `.stop-card { cursor: pointer }` is a misleading affordance. The card→map highlight is driven by `onHover` and stays.

### Step 1: Drop the unused `onClick` prop from StopCard

- [ ] In `src/lib/components/StopCard.svelte`, remove the `onClick = () => {},` line from the `$props()` destructure (~line 37). Confirm `onClick` appears nowhere else in the file first: `grep -n onClick src/lib/components/StopCard.svelte` should return only the prop line.

### Step 2: Remove the misleading whole-card pointer cursor

- [ ] In the `.stop-card` rule (~line 333), delete the `cursor: pointer;` line. (Interactive children — `.toggle`, `.more`, `.rest-link`, `.li--act`, footer buttons, drag handle — carry their own cursors.)

### Step 3: Drop the `onClick={scrollToCard}` pass-throughs in CandidatesSection

- [ ] In `src/lib/components/CandidatesSection.svelte`, remove the `onClick={scrollToCard}` line from the `StopCard` usage (~line 732) and from the `LodgingCard` usage (~line 791). Also remove the standalone one at ~line 488 if it targets a `StopCard`/`LodgingCard` whose `onClick` is now gone — verify each: `grep -n "scrollToCard\|onClick" src/lib/components/CandidatesSection.svelte`.
- [ ] If `scrollToCard` (defined ~line 364) is now unreferenced, delete the function too. If anything still calls it (e.g. a map-pin handler), leave it. Confirm with the grep above.
- [ ] If `LodgingCard` declares an `onClick` prop that's now unused, that's fine to leave for this change (out of scope) — only remove the StopCard prop. Do not otherwise modify `LodgingCard`.

### Step 4: Verify and commit

- [ ] Run: `npm run check` → expect `0 ERRORS 0 WARNINGS`, real file count. (svelte-check flags unused props/vars and unused CSS, so this confirms the removals are clean and nothing dangling.)
- [ ] Commit:

```bash
git add src/lib/components/StopCard.svelte src/lib/components/CandidatesSection.svelte
git commit -m "refresh(candidates): drop dead onClick/scrollToCard wiring"
```

---

## Task 3: Full verification + Playwright-MCP QA

**Files:** none (verification only)

### Step 1: Verify gate

- [ ] Run: `npm run verify`
- [ ] Expected: svelte-check `0 ERRORS 0 WARNINGS` (real file count), all tests pass, build succeeds.

### Step 2: Browser QA at phone width (the layout regression check)

- [ ] Start a dev server on a non-default port with dev creds and drive it with Playwright-MCP (pattern from `docs/manual-qa.md`; dev creds at `~/.config/traverse/dev.env`; never use port 3456):

```bash
set -a; source ~/.config/traverse/dev.env; set +a
npx vite dev --port 3470 --strictPort
```

- [ ] Resize to **390×844**, navigate to a real enriched trip: `http://localhost:3470/trips/ozark-national-riverways`.
- [ ] Run the overflow measurement with all candidate cards expanded; assert every card and the document are clean:

```js
() => {
  document.querySelectorAll('article.stop-card .toggle').forEach(b => { if (b.getAttribute('aria-expanded') === 'false') b.click(); });
  void document.body.offsetWidth;
  const cards = [...document.querySelectorAll('article.stop-card')];
  const over = cards.map(c => ({ name: c.querySelector('.name')?.textContent?.trim().slice(0,24), over: c.scrollWidth - c.clientWidth })).filter(c => c.over > 0);
  return { viewport: innerWidth, docOverflow: document.documentElement.scrollWidth - innerWidth, cardsOverflowing: over, allClean: over.length === 0 };
}
```

- [ ] Expected: `allClean: true`, `docOverflow: 0` (the same invariant that #527 restored — now structurally guaranteed by the full-width panel).

### Step 3: Visual + interaction confirm

- [ ] Screenshot a card at rest and expanded. Confirm against the spec's Manual QA pass:
  1. Rest: `●` name + category caption, `↳` why line as the emphasized hero, 2-line description with `…more` when long, meta row = `📍 distance · website ↗ · ▾`. No hours/address/phone visible.
  2. Tap toggle / `…more` / chevron → expands full-width: full description + hours (incl. a long multi-day string wrapping cleanly) + tappable address + phone; chevron rotates.
  3. Tapping address/phone/website opens maps/call/site without toggling the card; Promote/Hide still work.
  4. Keyboard: Tab to the toggle, Enter/Space expands/collapses; focus ring visible; `aria-expanded` flips.
  5. A card missing a website (and one missing hours) omits those elements cleanly in both states.

- [ ] Stop the dev server (`lsof -ti tcp:3470 | xargs kill`); remove any screenshots saved into the repo root. No commit (verification only).

---

## Self-Review Notes

- **Spec coverage:** rest hierarchy (Task 1 Step 3 markup + Step 4 `.why`/`.summary` CSS), expanded panel replacing the disclosure (Step 3 `.logistics` + Step 5 removal), unified single-tap expand + a11y (`expanded` state, `aria-expanded`, focus ring, reduced-motion chevron — Steps 1/3/4), forgiving toggle targets (toggle button + `…more` both call `toggleExpanded`), dead-wiring cleanup (Task 2), QA via Playwright (Task 3). Future-work items (exception chip, distance gating, LodgingCard) are intentionally **not** built — spec lists them as future.
- **No-emoji invariant:** all icons reuse the existing inline stroke-SVG paths (pin/clock/phone/external-link), not the emoji used in the brainstorm mockups.
- **Unused-CSS strategy:** Task 1 Step 5 leans on svelte-check `--fail-on-warnings` to name dead selectors rather than hardcoding line numbers (which drift) — with an explicit guard list of compact/inRail selectors NOT to remove.
- **Type/name consistency:** `expanded`, `toggleExpanded`, `hasLogistics`, `expandable`, `descOverflows`, `clampProbe`, `.rest-meta`, `.toggle`, `.meta-distance`, `.chev`, `.rest-link`/`.rest-link-text`, `.logistics`, `.li`/`.li-tx`/`.li--act` are used consistently across markup and CSS. The new `.meta-distance` is intentionally distinct from the existing compact-shared `.distance` pill. `mapsUrl`/`telUrl`/`primaryUrl`/`primaryLabel`/`description`/`why`/`.meta-svg` reuse existing values/rules.
- **No intermediate breakage:** Task 1 changes script+markup+CSS in one commit (a split would trip unused-selector warnings mid-way); Task 2 is independent cleanup.

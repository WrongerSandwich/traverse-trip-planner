# Planning Page Visual Refresh — Implementation Plan (sonnet ticket chain)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refresh the planning detail page (`/trips/[slug]`) into the approved "Direction B, tiered" look — soft-card dashboard chrome for the structured tools, calm editorial prose for the text sections, plus a desktop two-column sticky trip rail — entirely within the existing Dusk token system, with no behavior/data changes.

**Architecture:** Five dependency-ordered tickets. **T1 sets the patterns** (new elevation/radius tokens, a `.cat-chip` category-chip utility, the page shell, and the Tier-1 prose treatment) and blocks the rest. **T2/T3** restyle the Plan and Candidates sections to Tier-2 cards reusing T1's primitives. **T4** adds the desktop two-column layout + sticky `TripRail`. **T5** is the dark-mode/a11y/manual-QA/docs closeout. Each ticket extracts a small pure helper into `src/lib/utils/` so it can carry a real unit test (AGENTS.md forbids testing UI rendering output); the remaining visual surface is gated by `svelte-check` + the Playwright manual-QA pass.

**Tech Stack:** SvelteKit, Svelte 5 runes, CSS custom-property tokens in `src/app.css`, vitest, Playwright-MCP for manual QA.

**Source of truth for visual detail:** `docs/superpowers/specs/2026-06-13-planning-page-visual-refresh-design.md` (committed). Tickets reference its sections rather than duplicating every value — read the spec section named in each ticket before implementing.

**Labels / routing:** T1 is **`opus`** (pattern-setting — it defines the token + tier language everything else follows). T2, T3, T4 are **`sonnet`** (pattern-following once T1 lands). T5 is **`sonnet`** to execute but needs a human/Opus visual sign-off on the AA/dark pass. Adjust labels to taste before filing.

**Global conventions for every ticket:**
- Branch via `scripts/new-worktree.sh <name>` (never a dot-prefixed path — svelte-check goes vacuously green). Base each ticket's branch on the **merged** previous ticket.
- Use **only** semantic tokens (`--surface-*`, `--text-*`, `--border-*`, `--accent`/`--accent-text`, `--state-*`, `--cat-<category>`/`-tint`/`-on`, `--planning-*`, and the new `--shadow-*`/`--radius-*`). Raw hex only for shadows / photo scrims. No behavior, endpoint, schema, or `plan.yaml`/`candidates.yaml` changes.
- `npm run verify` (svelte-check `--fail-on-warnings` → vitest → build) is the go/no-go. Run it often.
- Extracted helpers live in `src/lib/utils/` with a mirrored `tests/<module>.test.js`.

---

## Task 1: Foundation — tokens, category-chip utility, page shell, Tier-1 prose

**Label:** `opus` · **Depends on:** nothing · **Blocks:** T2, T3, T4, T5

**Spec sections:** "Design system additions", "Page shell", "Tier 1 — calm prose sections", "Dark mode".

**Files:**
- Modify: `src/app.css` (add elevation/radius tokens + dark overrides; add `.cat-chip` utility)
- Modify: `src/routes/trips/[slug]/+page.svelte` (header gradient, meta pill row, hero scrim, Tier-1 prose treatment for the prose sections + dividers + empty states)
- Create: `src/lib/utils/trip-meta.js` (pure `metaPills(trip)` helper)
- Test: `tests/trip-meta.test.js`

- [ ] **Step 1: Write the failing test for `metaPills`**

```js
// tests/trip-meta.test.js
import { describe, it, expect } from 'vitest';
import { metaPills } from '../src/lib/utils/trip-meta.js';

describe('metaPills', () => {
  it('builds the pill row from present fields, dropping absent ones', () => {
    const trip = { destination: 'St. Louis, MO', _drive_label: '4h · 312 mi', lodging: { nights: 2 } };
    expect(metaPills(trip)).toEqual([
      { kind: 'destination', text: 'St. Louis, MO' },
      { kind: 'drive', text: '4h · 312 mi' },
      { kind: 'nights', text: '2 nights' },
    ]);
  });

  it('omits nights when not derivable and singularizes one night', () => {
    expect(metaPills({ destination: 'X', lodging: { nights: 1 } }))
      .toEqual([{ kind: 'destination', text: 'X' }, { kind: 'nights', text: '1 night' }]);
    expect(metaPills({ destination: 'X' }))
      .toEqual([{ kind: 'destination', text: 'X' }]);
  });

  it('returns [] for an empty trip', () => {
    expect(metaPills({})).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it — expect failure**

Run: `npx vitest run tests/trip-meta.test.js`
Expected: FAIL (`metaPills` not defined).

> Before implementing, confirm the real field names on the enriched trip object: open `src/routes/trips/[slug]/+page.svelte` and the `driveLabel` / `trip._cost` / `trip.destination` / lodging usages already in the template (around the `.trip-meta` block) and `src/lib/server/data.js` enrichment. Use the **actual** synthetic field that backs today's `driveLabel` rather than the placeholder `_drive_label` above; update the test's input field name to match what you find. Keep the output shape `{kind, text}[]`.

- [ ] **Step 3: Implement `metaPills`**

```js
// src/lib/utils/trip-meta.js
// Pure builder for the planning-page meta pill row. Order is fixed;
// absent fields are dropped so the row never shows empty pills.
export function metaPills(trip = {}) {
  const pills = [];
  if (trip.destination) pills.push({ kind: 'destination', text: trip.destination });
  const drive = trip._drive_label; // ← replace with the real drive-label field
  if (drive) pills.push({ kind: 'drive', text: drive });
  const nights = trip.lodging?.nights;
  if (Number.isFinite(nights) && nights > 0) {
    pills.push({ kind: 'nights', text: `${nights} night${nights === 1 ? '' : 's'}` });
  }
  return pills;
}
```

- [ ] **Step 4: Run the test — expect pass**

Run: `npx vitest run tests/trip-meta.test.js` → PASS.

- [ ] **Step 5: Add the design-system tokens to `src/app.css`**

In `:root, [data-theme="light"]` (after the layout constants block):

```css
/* Elevation — soft warm shadows for Tier-2 cards (light mode) */
--shadow-card:   0 2px 12px rgba(60, 41, 33, 0.09);
--shadow-raised: 0 8px 28px rgba(60, 41, 33, 0.14);

/* Radius scale */
--radius-sm: 8px;
--radius-md: 12px;
--radius-lg: 16px;
```

In `[data-theme="dark"]` (shadows read poorly on dark — convey elevation via surface + border instead):

```css
--shadow-card:   0 1px 0 rgba(0, 0, 0, 0.25);
--shadow-raised: 0 1px 0 rgba(0, 0, 0, 0.35);
```

- [ ] **Step 6: Add the `.cat-chip` category-chip utility to `src/app.css`**

A token-driven chip used by both Plan stop rows (T2) and Candidates (T3). Color comes from the `--cat-*` family via a `data-category` attribute selector, so markup stays `<span class="cat-chip" data-category="food">♪</span>`.

```css
/* ── Category chip ───────────────────────────────────────────────────────
   Square, filled with the category's pin color; glyph in the on-color.
   One selector per category keeps it tokenized (no inline color literals). */
.cat-chip {
  width: 28px; height: 28px; flex: none;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: var(--radius-sm);
  font-size: 14px; line-height: 1;
  color: var(--text-inverse);
  background: var(--cat-misc);
}
.cat-chip[data-category="historic"]      { background: var(--cat-historic); }
.cat-chip[data-category="cultural"]      { background: var(--cat-cultural); }
.cat-chip[data-category="food"]          { background: var(--cat-food); }
.cat-chip[data-category="entertainment"] { background: var(--cat-entertainment); }
.cat-chip[data-category="outdoors"]      { background: var(--cat-outdoors); }
.cat-chip[data-category="view"]          { background: var(--cat-view); }
.cat-chip[data-category="quirky"]        { background: var(--cat-quirky); }
.cat-chip[data-category="shopping"]      { background: var(--cat-shopping); }
.cat-chip[data-category="misc"]          { background: var(--cat-misc); }
```

> Verify these category keys match the canonical set used elsewhere (grep `--cat-` in `src/app.css` and how `CandidatesSection.svelte` currently maps category → color). Use whatever glyph source the current candidate cards use; if none, a short text initial is acceptable and decorative (`aria-hidden`).

- [ ] **Step 7: Restyle the page shell in `+page.svelte`**

Per the spec "Page shell" section: slim sticky header with a `linear-gradient(160deg, var(--forest-800), var(--forest-900))` band (keep the existing `.header-pill` system and all buttons); convert the `.trip-meta` strip to a pill row driven by `metaPills(trip)` (stage pill keeps `--planning-*`; other pills use `--surface-sunken`/`--text-secondary`, `--radius-lg` rounded); add a soft bottom scrim behind the hero `.vibe` tag. Do not change any markup that carries behavior (back/Ask/Re-research/kebab handlers).

- [ ] **Step 8: Apply the Tier-1 prose treatment**

Per the spec "Tier 1" section, for the Overview / Route / Logistics sections in `+page.svelte`: remove the heavy card border; render each as overline label (`.text-caption`, `--accent-text`) → Fraunces title → short `--accent` hairline rule → prose; keep `Edit` / `↳ Ask` as quiet text actions; separate sections with hairline dividers (`--border-subtle`); restyle the empty-state placeholder + `Research →` to match. Preserve the overview/route long-section expand/collapse logic untouched.

- [ ] **Step 9: Verify + visual check**

Run: `npm run verify` → all green (0 svelte-check warnings).
Then a quick Playwright-MCP screenshot of `st-louis-brick-city` at 390px to confirm the shell + tiered prose read correctly (dev server: `npm run dev -- --port 3456`).

- [ ] **Step 10: Commit**

```bash
git add src/app.css src/routes/trips/'[slug]'/+page.svelte src/lib/utils/trip-meta.js tests/trip-meta.test.js
git commit -m "feat(planning): tokens, category-chip utility, page shell + Tier-1 prose"
```

---

## Task 2: Plan section → Tier-2 cards

**Label:** `sonnet` · **Depends on:** T1 · **Blocks:** T3 (shared `.cat-chip`), T5

**Spec section:** "Tier 2 — Plan section".

**Files:**
- Modify: `src/lib/components/PlanSection.svelte` (card wrapper, trip-prep progress bar, day card accent + `Day N` chip, stop-row chip/grip, disclosure pill, drive connector, add-stop ghost)
- Modify: `src/lib/components/StopCard.svelte` (icon-chip + grip + disclosure pill — confirm which file owns the row markup before editing; PlanSection may render rows inline)
- Modify: `src/lib/components/LodgingCard.svelte` (tinted sub-card + Book button)
- Create: `src/lib/utils/drive-connector.js` (`driveConnectorLabel(seg)`)
- Test: `tests/drive-connector.test.js`

- [ ] **Step 1: Write the failing test for `driveConnectorLabel`**

```js
// tests/drive-connector.test.js
import { describe, it, expect } from 'vitest';
import { driveConnectorLabel } from '../src/lib/utils/drive-connector.js';

describe('driveConnectorLabel', () => {
  it('formats distance alone', () => {
    expect(driveConnectorLabel({ mi: 2 })).toBe('↓ 2 mi');
  });
  it('appends duration when present', () => {
    expect(driveConnectorLabel({ mi: 5, min: 12 })).toBe('↓ 5 mi · 12 min');
  });
  it('rounds fractional miles to one decimal and drops trailing .0', () => {
    expect(driveConnectorLabel({ mi: 0.8 })).toBe('↓ 0.8 mi');
    expect(driveConnectorLabel({ mi: 9.0 })).toBe('↓ 9 mi');
  });
  it('returns null when there is no distance to show', () => {
    expect(driveConnectorLabel({})).toBeNull();
    expect(driveConnectorLabel({ mi: 0 })).toBeNull();
  });
});
```

- [ ] **Step 2: Run it — expect failure**

Run: `npx vitest run tests/drive-connector.test.js` → FAIL.

> First confirm what drive data actually exists between consecutive stops today: grep the existing `mi` badge in `PlanSection.svelte` (the `2 mi` / `9 mi` rendering) and trace its source field. If only distance exists (no per-segment minutes), keep `min` optional exactly as the helper does — **do not fabricate drive times**. Adjust the test's field names to the real ones if they differ.

- [ ] **Step 3: Implement `driveConnectorLabel`**

```js
// src/lib/utils/drive-connector.js
// Formats the between-stops drive connector. Distance is required to render;
// duration is appended only when available. Returns null when nothing to show.
export function driveConnectorLabel(seg = {}) {
  const mi = Number(seg.mi);
  if (!Number.isFinite(mi) || mi <= 0) return null;
  const miText = Number.isInteger(mi) ? `${mi}` : `${mi.toFixed(1).replace(/\.0$/, '')}`;
  let out = `↓ ${miText} mi`;
  if (Number.isFinite(Number(seg.min)) && Number(seg.min) > 0) out += ` · ${Math.round(seg.min)} min`;
  return out;
}
```

- [ ] **Step 4: Run the test — expect pass**

Run: `npx vitest run tests/drive-connector.test.js` → PASS.

- [ ] **Step 5: Restyle the Plan card + day cards**

Per spec: wrap the section in an elevated card (`--surface-raised`, `--radius-lg`, `--shadow-card`); add the thin trip-prep progress bar (`--accent` on `--surface-sunken`) and turn `Refresh prep`/`Re-generate all` into quiet chips; give `.day-card` the `--surface-page` + `--radius-md` + `--border-subtle` treatment with a 3px `--accent` left edge and a `Day N` chip in `.day-header`. Preserve the day `⋯` menu, date/notes editors, and Arrange mode exactly.

- [ ] **Step 6: Restyle stop rows + disclosure + connector**

Per spec: each `.stop-row` gets a `.cat-chip` (from T1) for its category, name + address, and a subtle grip glyph replacing the literal "drag" text (keep the existing drag/reorder handlers and ARIA). Turn the `<details>` summary into a pill. Move the drive distance out of the floating badge into a connector element between rows, rendered from `driveConnectorLabel(seg)` (skip rendering when it returns null).

- [ ] **Step 7: Restyle lodging + add-stop**

Per spec: `LodgingCard` becomes a tinted sub-card (`--surface-sunken`, `--radius-md`) with bed glyph, name, `N nights · <tier>`, and an `--accent` Book button; `+ Add stop` becomes a dashed ghost button. Preserve the `+ Add lodging` empty state behavior.

- [ ] **Step 8: Verify + visual check**

Run: `npm run verify` → green. Playwright screenshot of `st-louis-brick-city` Plan section (390px) — confirm connectors, chips, day accent, lodging sub-card. Confirm reorder + Arrange mode still work.

- [ ] **Step 9: Commit**

```bash
git add src/lib/components/PlanSection.svelte src/lib/components/StopCard.svelte src/lib/components/LodgingCard.svelte src/lib/utils/drive-connector.js tests/drive-connector.test.js
git commit -m "feat(planning): Plan section Tier-2 cards, drive connectors, chips"
```

---

## Task 3: Candidates section → Tier-2 cards

**Label:** `sonnet` · **Depends on:** T2 (reuses `.cat-chip`) · **Blocks:** T5

**Spec section:** "Tier 2 — Candidates section".

**Files:**
- Modify: `src/lib/components/CandidatesSection.svelte` (card wrapper, rounded inline map, segmented Stops/Lodging control, category filter chips, candidate cards)
- Create: `src/lib/utils/candidate-filters.js` (`activeCategories(candidates)` — the set of categories present, for which filter chips to show)
- Test: `tests/candidate-filters.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/candidate-filters.test.js
import { describe, it, expect } from 'vitest';
import { activeCategories } from '../src/lib/utils/candidate-filters.js';

describe('activeCategories', () => {
  it('returns the distinct categories present, in canonical order', () => {
    const cands = [{ category: 'food' }, { category: 'outdoors' }, { category: 'food' }, { category: 'historic' }];
    expect(activeCategories(cands)).toEqual(['historic', 'food', 'outdoors']);
  });
  it('ignores unknown/missing categories', () => {
    expect(activeCategories([{ category: 'food' }, {}, { category: 'nope' }])).toEqual(['food']);
  });
  it('handles an empty pool', () => {
    expect(activeCategories([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it — expect failure**

Run: `npx vitest run tests/candidate-filters.test.js` → FAIL.

> Confirm the canonical category order and key list from `src/app.css` (`--cat-*`) and how `CandidatesSection.svelte` currently derives its filter set. Match `CANON` below to that order exactly.

- [ ] **Step 3: Implement `activeCategories`**

```js
// src/lib/utils/candidate-filters.js
// Which category filter chips to render: the distinct, known categories
// present in the candidate pool, returned in canonical (palette) order.
const CANON = ['historic', 'cultural', 'food', 'entertainment', 'outdoors', 'view', 'quirky', 'shopping', 'misc'];
export function activeCategories(candidates = []) {
  const present = new Set(candidates.map((c) => c?.category).filter((c) => CANON.includes(c)));
  return CANON.filter((c) => present.has(c));
}
```

- [ ] **Step 4: Run the test — expect pass**

Run: `npx vitest run tests/candidate-filters.test.js` → PASS.

- [ ] **Step 5: Restyle Candidates**

Per spec: wrap in an elevated card to match Plan; give the inline map `--radius-md` corners; convert the Stops/Lodging tabs to a segmented control (pill track on `--surface-sunken`, raised active segment); render category filter chips from `activeCategories(...)`, each lit in its `--cat-<category>`/`-tint`/`-on` when active and neutral (`--border-subtle`) when not; restyle candidate cards with a `.cat-chip`, name, short description, and the existing `Promote to day…` (`+ Day`) / on-plan `Day N` badge + `Un-promote` actions. **Preserve all filter/promote/un-promote behavior and the pin-status hint.**

- [ ] **Step 6: Verify + visual check**

Run: `npm run verify` → green. Playwright screenshot of the Candidates section; confirm segmented control toggles Stops/Lodging, filter chips light in category color, promote/un-promote still work.

- [ ] **Step 7: Commit**

```bash
git add src/lib/components/CandidatesSection.svelte src/lib/utils/candidate-filters.js tests/candidate-filters.test.js
git commit -m "feat(planning): Candidates section Tier-2 cards, segmented control, filter chips"
```

---

## Task 4: Desktop two-column + sticky trip rail

**Label:** `sonnet` · **Depends on:** T1 (recommend after T2 + T3 so content is final) · **Blocks:** T5

**Spec section:** "Desktop — two-column + sticky trip rail".

**Files:**
- Modify: `src/routes/trips/[slug]/+page.svelte` (two-column `.layout` grid at ≥960px; mount `TripRail`)
- Create: `src/lib/components/TripRail.svelte` (mini overview map + quick stats + jump-nav)
- Create: `src/lib/utils/trip-rail.js` (`tripQuickStats(trip)`, `activeSection(positions, scrollY)`)
- Test: `tests/trip-rail.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// tests/trip-rail.test.js
import { describe, it, expect } from 'vitest';
import { tripQuickStats, activeSection } from '../src/lib/utils/trip-rail.js';

describe('tripQuickStats', () => {
  it('builds present stat rows in order, dropping absent ones', () => {
    const trip = { home_distance_mi: 312, _drive_label: '4h 30m', lodging: { nights: 2 }, plan: { days: [{}, {}] } };
    expect(tripQuickStats(trip)).toEqual([
      { label: 'Distance', value: '312 mi' },
      { label: 'Drive', value: '4h 30m' },
      { label: 'Nights', value: '2' },
      { label: 'Days planned', value: '2' },
    ]);
  });
  it('returns [] when nothing is known', () => {
    expect(tripQuickStats({})).toEqual([]);
  });
});

describe('activeSection', () => {
  const positions = [
    { id: 'overview', top: 0 }, { id: 'route', top: 500 },
    { id: 'plan', top: 1200 }, { id: 'candidates', top: 2000 },
  ];
  it('returns the last section whose top is at or above the scroll line', () => {
    expect(activeSection(positions, 0)).toBe('overview');
    expect(activeSection(positions, 600)).toBe('route');
    expect(activeSection(positions, 1300)).toBe('plan');
    expect(activeSection(positions, 9999)).toBe('candidates');
  });
  it('clamps to the first section above the top', () => {
    expect(activeSection(positions, -50)).toBe('overview');
  });
  it('returns null for no sections', () => {
    expect(activeSection([], 100)).toBeNull();
  });
});
```

- [ ] **Step 2: Run them — expect failure**

Run: `npx vitest run tests/trip-rail.test.js` → FAIL.

> Confirm the real field names for distance / drive label / nights / planned-day count on the enriched trip (reuse what T1's `metaPills` settled on for drive + nights). Adjust the test inputs to the real fields; keep the output shapes.

- [ ] **Step 3: Implement the helpers**

```js
// src/lib/utils/trip-rail.js
// Pure helpers for the desktop trip rail. No DOM access here — the component
// measures section offsets and passes them in.
export function tripQuickStats(trip = {}) {
  const rows = [];
  if (Number.isFinite(trip.home_distance_mi)) rows.push({ label: 'Distance', value: `${trip.home_distance_mi} mi` });
  if (trip._drive_label) rows.push({ label: 'Drive', value: trip._drive_label }); // ← real drive field
  const nights = trip.lodging?.nights;
  if (Number.isFinite(nights) && nights > 0) rows.push({ label: 'Nights', value: `${nights}` });
  const days = trip.plan?.days?.length;
  if (Number.isFinite(days) && days > 0) rows.push({ label: 'Days planned', value: `${days}` });
  return rows;
}

// Scroll-spy: given each section's top offset (px) and the current scroll
// line, return the id of the section currently in view (the last one whose
// top has been passed). Pure + deterministic so it can be unit-tested.
export function activeSection(positions = [], scrollY = 0) {
  if (!positions.length) return null;
  let current = positions[0].id;
  for (const p of positions) {
    if (p.top <= scrollY) current = p.id;
    else break;
  }
  return current;
}
```

- [ ] **Step 4: Run the tests — expect pass**

Run: `npx vitest run tests/trip-rail.test.js` → PASS.

- [ ] **Step 5: Build `TripRail.svelte`**

A presentational component: props `{ trip, home, sections, activeId }`. Renders a mini overview map (reuse `MiniMap` or `TripMap` overview mode — check which the page already imports), the `tripQuickStats(trip)` rows, and a jump-nav `<a href="#section-…">` list that highlights `activeId`. Card styling: `--surface-raised`, `--border-subtle`, `--radius-lg`, `--shadow-card`. All links use the existing `#section-<name>` anchor ids already on the page.

- [ ] **Step 6: Wire the two-column layout in `+page.svelte`**

At `≥960px`, make `.layout` a `grid-template-columns: minmax(0,1fr) 320px` with the rail in the second column and `position: sticky; top: <header height>` on the rail wrapper (`align-self: start`). Below 960px, the rail is `display: none` and the existing inline overview map stays as today (so mobile is unchanged). Drive `activeId` with a scroll listener that reads section offsets and calls `activeSection(...)` (throttle with `requestAnimationFrame`). Keep the existing `.page` grid shell and sticky header intact.

- [ ] **Step 7: Verify + visual check**

Run: `npm run verify` → green. Playwright at 1280px: confirm two columns, sticky rail, mini-map, stats, and jump-nav scroll-spy highlight; then at 800px confirm it collapses to the single mobile column with the inline map.

- [ ] **Step 8: Commit**

```bash
git add src/routes/trips/'[slug]'/+page.svelte src/lib/components/TripRail.svelte src/lib/utils/trip-rail.js tests/trip-rail.test.js
git commit -m "feat(planning): desktop two-column layout + sticky trip rail"
```

---

## Task 5: Closeout — dark mode, a11y, manual QA, docs

**Label:** `sonnet` (execute) + human/Opus visual sign-off · **Depends on:** T2, T3, T4

**Spec sections:** "Dark mode", "Accessibility", "Manual QA pass".

**Files:**
- Modify (as needed): any of the above for AA/dark/tap-floor fixes surfaced by QA
- Modify (if affordance copy changed): `CLAUDE.md`

- [ ] **Step 1: Dark-mode pass.** Toggle `[data-theme="dark"]` and walk the whole planning page. Confirm Tier-2 cards read as elevated (lighter surface + `--border-subtle`, not shadow), and every new text-on-tint pairing (`.cat-chip` glyphs, meta/disclosure pills, the trip-prep progress label, filter chips, segmented control, rail stats) clears **AA**. Fix any failures by re-mapping to existing AA-safe token stops — no new literals.
- [ ] **Step 2: Tap-floor pass.** Emulate `hasTouch:true` (coarse pointer, not just a narrow viewport — see the coarse-pointer QA note). Confirm the new chips, segmented control, filter chips, and disclosure summaries clear `--tap-min` (44px).
- [ ] **Step 3: Run the full Manual QA checklist** from the spec's "Manual QA pass" section against `st-louis-brick-city` (2-day plan + large candidate pool) via Playwright-MCP. Record results; file follow-ups for anything cosmetic-but-out-of-scope rather than scope-creeping.
- [ ] **Step 4: Out-of-scope regression check.** Open the brochure, today view, offline bundle, and a completed-trip read-only render; confirm **none** changed appearance (shared `StopCard`/`LodgingCard` were correctly scoped per the spec's "Shared-component caution").
- [ ] **Step 5: Docs.** This refresh is presentation-only, so DoD #3 likely needs no `CLAUDE.md` change — but if any affordance description drifted (e.g. "drag a stop from Candidates" wording), update it. Otherwise note "no doc change required" in the PR.
- [ ] **Step 6: Final verify + commit any fixes**

Run: `npm run verify` → green.
```bash
git commit -am "fix(planning): dark-mode + a11y closeout for visual refresh"
```

---

## Self-review

**Spec coverage:** Design-system additions → T1·S5/6. Page shell → T1·S7. Tier-1 prose → T1·S8. Tier-2 Plan (card, prep bar, day card, stop row, disclosure, connector, lodging, add-stop) → T2·S5–7. Tier-2 Candidates (card, map, segmented, filter chips, cards) → T3·S5. Desktop rail (mini-map, stats, jump-nav scroll-spy, breakpoint collapse) → T4·S5–6. Dark mode → T1·S5 + T5·S1. Accessibility (tap floors, `<details>`, aria-hidden glyphs, AA) → T5·S1–2 + spec-driven markup notes. Shared-component caution → T2/T3 markup + T5·S4. Manual QA → T5·S3. Future context map → out of scope (spec). **No gaps.**

**Placeholder scan:** The only intentional unknowns are the *real field names* on the enriched trip object (`_drive_label`, nights source, planned-day count), flagged in each ticket with a "confirm the real field" note and a grep target — the implementer resolves them against `+page.svelte`/`data.js` before coding, and the tests are adjusted to match. No "TBD"/"add error handling"/vague steps remain.

**Type consistency:** Helper names and shapes are stable across tickets — `metaPills → {kind,text}[]`, `driveConnectorLabel(seg)→string|null`, `activeCategories → string[]`, `tripQuickStats → {label,value}[]`, `activeSection(positions, scrollY) → id|null`. The `.cat-chip` utility + `data-category` contract defined in T1 is consumed verbatim in T2 and T3.

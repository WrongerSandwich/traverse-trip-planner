---
target: top bar
total_score: 26
p0_count: 0
p1_count: 2
timestamp: 2026-05-18T01-21-31Z
slug: src-routes-page-svelte-header
---
## Design Health Score — Header

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Desktop shows trip count + active filters; mobile hides count entirely so the header gives no state cue. |
| 2 | Match System / Real World | 4 | Serif wordmark + hand-drawn road/sunrise mark; recognizable icon vocabulary. |
| 3 | User Control and Freedom | 2 | Wordmark is not a link to `/`. From sub-routes the only path home is browser back. |
| 4 | Consistency and Standards | 2 | Three semantically distinct controls (settings nav, seed action, pin action) all rendered as 28px circles distinguished only by border color. |
| 5 | Error Prevention | 3 | Seed/pin both gate on confirm or non-empty input. Solid. |
| 6 | Recognition Rather Than Recall | 2 | Icon-only seed/pin/settings; `title=` tooltips invisible on touch. |
| 7 | Flexibility and Efficiency | 3 | `Cmd/Ctrl+Enter` submits seed; `Escape` closes popovers. No global shortcut to open them. |
| 8 | Aesthetic and Minimalist Design | 4 | Restrained palette, one serif, one accent. Count typography is editorial-magazine, not SaaS-metric. |
| 9 | Error Recovery | 2 | Header surfaces no app-level error state; toasts live outside. |
| 10 | Help and Documentation | 1 | `title=` only, no help icon, no tagline. |
| **Total** | | **26/40** | Materially below the whole-page score (34/40). The header is the densest concentration of stress points on the surface. |

## Anti-Patterns Verdict (Header)

**Not AI-slop.** The serif wordmark + custom Logo + editorial count typography + restrained icon row reads "personal field-notebook tool," not generic dashboard. Two slop-adjacent tells survive:

1. Three near-identical 28px circular icon buttons cluster in the right slot (settings cog, seed +, pin) at `+page.svelte:497, 519, 540`. That trio is the universally-generated dashboard top-right.
2. Right-side reading order is **settings → count → seed → pin**, which puts a rare nav link before two primary actions before the state readout — no clear rationale, looks like icons-collected-into-a-row.

**Absolute bans:** all pass within the header (no gradient text, no glass, no side-stripe, no hero-metric template, no nested cards, no modal-as-first-thought).

**Detector (`npx impeccable detect`):** 0 header-scoped hits across file and live URL scans. All 23 URL pattern hits trace to non-header sources (controls bar, card stack, app-wide `.text-caption` utility). The detector also _missed_ two real header issues that the agent surfaced manually: count-label tiny-text (~9.3px) and count-label sub-AA contrast.

**Browser overlay:** the Claude extension is still not connected this session, so no live measurements / overlays. All findings are from source review.

## Overall Impression

The header has two strong identity moments (the serif wordmark + sunrise-Logo on the left, the editorial count typography on the right) and a cluster of weak chrome between them. The chrome cluster is where almost every issue lives: three icon buttons treated as visually equivalent when they're semantically distinct (a nav link, a primary AI action, another primary AI action); one of those buttons fails AA contrast in light mode; on mobile, one fails the touch-target floor; the only state cue (the count) disappears at the breakpoint where state matters most.

Biggest opportunity: **rethink the right-side cluster as a deliberate hierarchy of three different things, not three same things.**

## What's Working

- **Wordmark identity moment** (`+page.svelte:479-482`, `Logo.svelte:34-91`). Serif h1 + hand-drawn road/sunrise SVG mark, paired tightly with `gap: 0.55rem`. Reads "field notebook" instantly, not "SaaS dashboard."
- **Count typography** (`+page.svelte:1192-1205`). 1.75rem sans at weight 600 with `letter-spacing: -0.04em`, paired with a 0.58rem uppercase caps label. Editorial-magazine treatment that elevates "32 destinations" from chrome to data.
- **`--header-h` ResizeObserver primitive** (`+page.svelte:144-152`). The right architecture for sticky-aware overlays — toast stack and popovers both consume it.

## Priority Issues

**[P1] Pin button icon fails AA contrast in light mode (~2.5:1).**
Why: `+page.svelte:951` sets `.pin-btn { color: var(--accent-text) }`, which is `#8D4C24` in light mode. Header bg is `--forest-800` (`#1F4332`). The icon `<svg>` fills with `currentColor`, so the only visual signal of the button's purpose is well below the 3:1 non-text floor. Dark mode is fine (`--accent-text` becomes `#E0884F` in dark mode, ~5.7:1).
Fix: use a lighter resting color for the pin icon in light mode — `var(--sunset-200)` (`#F0B080`) or `var(--sunset-400)` (`#E0884F`) clears 3:1 on forest-800. Keep `--accent-text` for sunset-on-cream text contexts only.
→ `/impeccable colorize`

**[P1] Settings link still 28×28 on mobile, fails 44px touch floor.**
Why: `+page.svelte:900` declares `width: 28px; height: 28px`. The mobile @media block at line 1486 enlarges `.seed-btn` to `var(--tap-min)` but does NOT add an equivalent rule for `.settings-link`. Previously flagged in the whole-page critique and intentionally not picked up. The settings link is a destination-altering nav target (route to /settings) sitting adjacent to seed/pin on mobile, so a miss-tap goes somewhere unrecoverable.
Fix: add `.settings-link { width: var(--tap-min); height: var(--tap-min); }` inside the mobile @media block at line 1486. The visual icon stays the same size; the hit area expands.
→ `/impeccable adapt`

**[P2] count-label is ~9.3px and ~3.7:1 contrast at non-large size.**
Why: `+page.svelte:1199-1200` sets `font-size: 0.58rem` (~9.3px on 16px root). Color is `--bone-600` (`#9A8A6F`) on `--forest-800` (`#1F4332`) ≈ 3.7:1. AA requires 4.5:1 for body text and 3:1 only for "large text" (18pt+ or 14pt bold) — 9.3px non-bold doesn't qualify. The detector didn't catch this because it samples `.text-caption` (11px) instead.
Fix: either bump the count-label to ≥12px AND raise color toward `--bone-400` (`#C9B695`, ~6.4:1), or restructure so the "of N destinations" reads as part of the count-num itself with a single contrast pair.
→ `/impeccable typeset`

**[P2] Three semantically distinct controls collapsed into one visual treatment.**
Why: Settings (rare nav), Seed (primary AI action), Pin (primary AI action) are all 28px circles in the same cluster, distinguished only by border color and a tiny icon. No primary action is visually privileged; new users have a "where do I start?" moment. The previous critique flagged the seed/pin pairing; this is the wider version that includes settings.
Fix options:
  (a) Move settings out of the header — onto a footer, into a `⋯` menu, or under a tiny avatar/profile slot when there's user content.
  (b) Make seed a labeled pill ("+ New ideas") and let pin be the smaller secondary icon. Establishes one clear primary.
  (c) Merge seed and pin into a split button (primary "+ Add ideas" with a chevron-menu for "name a specific place"). Both are "add ideas to the system" — they don't actually need two separate top-level affordances.
→ `/impeccable shape`

**[P3] Logo SVG aria-label "Traverse" + adjacent `<h1>Traverse</h1>` produces double screen-reader announcement.**
Why: `Logo.svelte:22` defaults `aria-label="Traverse"`; the wordmark renders both the Logo and `<h1>Traverse</h1>` (`+page.svelte:479-482`). Screen readers announce both. Cheap fix.
Fix: pass `aria-label=""` (or `aria-hidden="true"`) to the Logo when paired with a visible wordmark. Keep the default for places that render the Logo alone.
→ `/impeccable polish`

## Persona Red Flags

**Sunday-morning owner (desktop, anticipatory):** First-load scan path lands on "Traverse" + Logo, drifts right to "32 destinations." Good. Then they look for "where do I start?" and find three 28px circles. The primary action (seed) requires hover-to-discover; in the first session there's a friction moment that a labeled CTA would eliminate.

**Kitchen-phone owner (mobile, brief reference):** The count is hidden on mobile (`+page.svelte:1497`) so they get no "how many trips do I have?" cue. The biggest interactive element in the header is the map-toggle, which biases them toward the map (right when browsing, wrong when checking one specific trip). Settings stays at 28px adjacent to the seed (+) — miss-tap risk.

**First-timer (share link):** If they navigate up to `/` from a share page, the header is the wordmark + four affordances with no labels and no tagline. The wordmark isn't a link. Nothing tells them what this is or where to go. The Logo's road/sunrise iconography is the only domain cue and isn't legible without context.

## Minor Observations

- Wordmark `<h1>` isn't wrapped in `<a href="/">`. Most users expect the wordmark to navigate home. `+page.svelte:481`.
- `.seed-btn:hover` (`+page.svelte:926`) and `.settings-link:hover` (`:909`) both set `background: var(--forest-800)` — which is the header background. Hover state is effectively invisible. The hover color shift (bone-600 → bone-400) is the only feedback.
- Seed and pin buttons lack explicit `type="button"`. Outside a form they default safely to `submit`-but-no-action, so harmless, but explicit is cheap insurance.
- Asymmetric gaps: left cluster `0.55rem` (tight identity pairing), right cluster `0.75rem` (looser for multiple controls). Deliberate, fine.
- `+page.svelte:873` uses raw `--forest-800` rather than a semantic surface token. The app.css comment at line 141 says "components that still reference raw tokens for surface/text/border need to migrate," but the header may legitimately want to be brand-invariant across themes. If so, this is intentional rather than drift; document the choice or migrate to a `--surface-brand` token explicitly named for this role.
- **Worth verifying with a browser:** the LLM agent claimed the sticky header on mobile (z-index 30) bleeds through the popover backdrop (z-index 50). Pure z-index math says 50 > 30 so it should NOT bleed through, but if the header sits inside a nested stacking context, it could. Couldn't confirm without the browser extension; worth a manual check.

## Questions to Consider

1. **Should settings be in the header at all?** It's a rare nav target. Moving it to a footer / `⋯` menu would clear the cluster and let seed/pin be visually weighted as primary.
2. **Should the wordmark and the count change places?** Personal-tool register often leads with state ("32 destinations") and treats the brand as a colophon. The current arrangement makes the brand primary; the count secondary. Is that the intended hierarchy, or is the brand pulling weight it doesn't earn on every page load?
3. **Are seed and pin actually two affordances, or one?** Both are "add ideas to the system." A single split button would clear half the right-side cluster and remove the "two near-identical circles" confusion entirely.

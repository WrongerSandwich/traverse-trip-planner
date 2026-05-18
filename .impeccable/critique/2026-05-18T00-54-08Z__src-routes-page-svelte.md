---
target: main page
total_score: 34
p0_count: 0
p1_count: 3
timestamp: 2026-05-18T00-54-08Z
slug: src-routes-page-svelte
---
## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 4 | Solid — inline spinners, ambient pill, per-trip badges, polite toasts. |
| 2 | Match System / Real World | 4 | Solid — "Trips / Idea / Planning / Completed", vibe eyebrows. |
| 3 | User Control and Freedom | 3 | No undo on archive; success toasts auto-dismiss without an undo affordance. |
| 4 | Consistency and Standards | 4 | Solid — uniform button vocabulary, single easing curve, single font role assignment. |
| 5 | Error Prevention | 3 | No char cap on seed prompt; disabled-button tooltips are hover-only (invisible on touch). |
| 6 | Recognition Rather Than Recall | 4 | Solid — filters visible, sort labeled, stages color-coded. |
| 7 | Flexibility and Efficiency | 3 | `Cmd/Ctrl+Enter` exists but undocumented in UI; no shortcut to switch tabs or open seed. |
| 8 | Aesthetic and Minimalist Design | 4 | Genuinely strong — restraint earned. |
| 9 | Error Recovery | 3 | Most failures are typed via `ERROR_REGISTRY`, but `archiveTrip` falls back to `alert()` (`+page.svelte:369`). |
| 10 | Help and Documentation | 2 | No first-run hint, no "what is this?", settings is a 28px gear; promise tooltips are the only inline help. |
| **Total** | | **34/40** | **Excellent (most real interfaces score 20–32)** |

## Anti-Patterns Verdict

**Does this look AI-generated?** No. It clears both reflex checks.

- **First-order** ("road-trip planner" → hero photo + 3-up cards + Inter + navy sidebar): refused. Fixed-height shell, map column pinned left at 42%, single-column card stack, Fraunces wordmark, forest-on-bone palette.
- **Second-order** (anti-refs → AllTrails/Komoot earth tones + sunset accent on cream): this *is* where it lands aesthetically, but it commits — the forest is dark enough to feel inky rather than corporate-green, the sunset accent is surgical (NPS badge, pin button border, route line), and the hand-drawn `Logo.svelte` SVG mark is a thing an LLM does not ship by default.

**Absolute bans — explicit check:**

| Ban | Status | Evidence |
|-----|--------|----------|
| Side-stripe borders >1px | **HIT (minor)** | `TripCard.svelte:223` — 3px stage-color left-stripe on stage badge. `BackgroundJobsIndicator.svelte:471` — 3px on success toast. Both small, scoped uses, but literal-rule hits. |
| Gradient text | Pass | Zero matches in `src/`. |
| Default glassmorphism | Pass (caveat) | `TripCard.svelte:226` has `backdrop-filter: blur(4px)` on stage badge over a 72%-opaque scrim — legibility doesn't rely on the blur. Principled use. |
| Hero-metric template | Pass | `.count-num` (`+page.svelte:1072`) is data-as-display ("5 of 30"), not vanity metric. |
| Identical card grids | Pass | Single column flex stack, not a grid; cards carry distinct content. |
| Modal-as-first-thought | Pass | Detail panel is a side panel; popovers used for seed/add; only destructive confirm uses `ConfirmModal`. |

**Deterministic detector** (`npx impeccable detect`):

- *Source scan (6 files):* 6 warnings — 2 `side-tab` (above), 3 `layout-transition` (`max-height` on filter panel `+page.svelte:1198`, `height` on mobile map collapse `+page.svelte:1350`, `width/height` on Leaflet divIcon `OverviewMap.svelte:96`), 1 `overused-font` (Fraunces).
- *Live URL scan (Puppeteer):* 37 instance-findings across 7 patterns. Top hits:
  - **12 × low-contrast** — all the same pair: `#7c8a7b` on `#1e2c24`, 4.0:1 (AA wants 4.5:1). Dark-mode muted text on dark surface. Fixing this one token clears all 12.
  - **7 × layout-transition** (matches source).
  - **5 × nested-cards** — TripCard sits inside container that the detector reads as another card. Worth verifying visually.
  - **5 × line-length** — text containers running ~100ch (want 65–75ch for prose).
  - **4 × tiny-text** at 11px — likely the JetBrains-mono meta footer. Stylistic floor; not a real failure on labels but flagged.
  - **3 × wide-tracking** at `0.18em` — fine on ALL-CAPS labels, real if body-sized mixed-case.
  - **1 × overused-font** — primary face at runtime is Inter (57%), not Fraunces. Inter is the system body, Fraunces is reserved for wordmark + card titles. Likely intentional split.

**False positives noted:** badge-stripe and toast-stripe are both small scoped uses; `tiny-text` 11px is meta-footer (intentional); Fraunces "overused" finding doesn't reflect its actual narrow role.

**Browser overlay:** the `[Human]` and `[LLM]` browser tabs **did not open** — the Claude browser extension is not connected, so both assessments fell back to source + Puppeteer-rendered URL scans. The detector's `npx impeccable live` subcommand also does not exist in the installed v2.1.9 (only `detect` ships). All findings above are evidence-backed by source or Puppeteer-rendered DOM.

## Overall Impression

This is one of the more committed personal-tool home pages I'd expect to see. The map-cards split (`+page.svelte:1087-1101`) expresses "the map is the interface" as structure, not slogan; the hover-fly-route choreography (`OverviewMap.svelte:206-290`) lands "motion as geography"; the JetBrains-mono meta footer on each card makes the data feel handled, not pasted. It reads as field-notebook, not SaaS dashboard, not Pinterest board.

The single biggest opportunity isn't the page itself — it's that the **map's tile layer is raw OSM**. Everything else here is hand-considered (Fraunces, the hand-drawn Logo, the bone palette, the sunset route line). Default OSM tiles in the middle of that read as a third-party island. A confident version paints them.

The most important fix is the dark-mode contrast pair: 12 occurrences of `#7c8a7b on #1e2c24` at 4.0:1 fail AA, which the brief sets as the floor.

## What's Working

- **Map-cards split as structure (`+page.svelte:1087-1101`).** 42% map column, 58% cards, with `box-shadow: -6px 0 24px` suggesting the map sits beneath. The principle is the layout, not a tagline.
- **Hover-fly-route choreography (`OverviewMap.svelte:206-290`).** `scheduleRouteReveal` fades the route in after the camera settles, spokes hide while zooming, differentiated camera behavior for drive vs not-drive. Built by someone who uses it.
- **TripCard meta footer (`TripCard.svelte:331-357`).** JetBrains-mono at 11px, "5.5 hr · Mammoth Cave NP" with cost right-aligned. The hr/min unit treatment (`TripCard.svelte:21-25`) is a small piece of craft.
- **Promise tooltips on AI actions.** Time + token estimates fed from rolling p50 telemetry. Almost nothing on the consumer web tells you what an AI action will cost.

## Priority Issues

**[P1] Dark-mode body text fails AA contrast in 12 places.**
- *Why:* `#7c8a7b` muted text on `#1e2c24` surface = 4.0:1; AA wants 4.5:1 for body. PRODUCT.md sets AA as the floor.
- *Fix:* darken the surface or lift the text token. Lifting the text (e.g. to `#94a193`) is usually the safer move because surface darkness is doing identity work. One token edit clears all 12.
- *Suggested command:* `/impeccable colorize "lift dark-mode muted-text token so #7c8a7b on #1e2c24 reaches AA 4.5:1"`

**[P1] No persistent display of active filters.**
- *Why:* the controls bar shows "Filters (2)" but doesn't reveal *which* two. With ~30 trips and 5 dimensions (stage × distance × cost × NPS × bookmarked), removing a single active filter is a re-open task per `+page.svelte:711-752`.
- *Fix:* render selected filter values as removable pills below the controls row, or inline next to the Filters toggle (Linear's filter row, Notion's filter chips).
- *Suggested command:* `/impeccable polish "expose active filters as removable inline pills on the home page"`

**[P1] `alert()` in archive failure path (`+page.svelte:369`), plus deepen alerts at 337/342/347.**
- *Why:* the rest of the page routes typed failures through `ERROR_REGISTRY` with inline envelopes (`+page.svelte:577-585`). The archive path drops to a browser `alert("Couldn't archive that one. The server log may have more detail.")`. This is exactly what the project's own conventions warn against ("typed failure routes through `ERROR_REGISTRY` ... no inline catch sentences").
- *Fix:* add an `archive_failed` (and `deepen_failed`) code to `ERROR_REGISTRY`; route through the same toast/inline envelope the other actions use.
- *Suggested command:* `/impeccable harden "replace alert() calls in home page archive/deepen handlers with ERROR_REGISTRY-routed inline failures"`

**[P2] Em-dashes in UI chrome copy violate the project's own ban.**
- *Why:* CLAUDE.md (and the impeccable laws) forbid em-dashes in copy. The home page has multiple: seed popover (`+page.svelte:530`), pin popover (`:594`), deepen confirm body (`:330`), plus tooltips at 485/506. Hits the ban repeatedly.
- *Fix:* replace each `—` with a period, semicolon, or restructure to two sentences.
- *Suggested command:* `/impeccable distill "remove em-dashes from home-page UI copy (popovers, tooltips, confirm bodies)"`

**[P2] Map-toggle label is a literal no-op: `{mapVisible ? 'Map' : 'Map'}` (`+page.svelte:454`).**
- *Why:* both branches return the same string. The `aria-label` correctly says "Hide map" / "Show map" but the visible label gives no state feedback — state is signalled only by the active background. Either an intentional decoration decision or a copy-paste left over from a refactor.
- *Fix:* either commit to "Hide map" / "Show map" (matches aria-label, costs nothing), or remove the text label entirely and rely on the icon + active background. Don't leave the visible-vs-aria split.
- *Suggested command:* `/impeccable clarify "fix map-toggle label conditional in +page.svelte:454 — both branches return 'Map'"`

**[P3] OSM default tiles undercut the curated aesthetic.**
- *Why:* everything else here is hand-considered; raw OSM tiles read as third-party island. The brochure already uses Stadia per CLAUDE.md.
- *Fix:* swap to Stadia Outdoors / Stamen Toner-Lite, or apply `filter: sepia(0.15) saturate(0.85)` to the leaflet tile pane in light mode and a warm-dark filter in dark mode. The map becomes part of the brand identity.
- *Suggested command:* `/impeccable colorize "harmonize home overview-map tile layer with the cream/forest palette"`

## Persona Red Flags

**Sunday-morning owner (laptop, anticipatory):**
- Filter tabs aren't keyboard-cyclable (no `1–4`); seed shortcut (`Cmd/Ctrl+Enter`) is wired (`+page.svelte:539-542`) but undocumented in the UI.
- The map's fly choreography only fires on card hover; the single-column card stack pushes the next pointer-natural card below the fold, so you end up scrolling out of fly-range frequently.

**Kitchen-phone owner (brief reference):**
- Filter panel `max-height: 200px` (`+page.svelte:1372`) likely truncates content on 390px viewport with 4 filter groups + clear-all + 36px min-height chips. Source bug; couldn't visually confirm.
- Settings gear at 28×28px (`+page.svelte:837`) is below the 44px touch-target floor PRODUCT.md sets. Seed/pin buttons get a `--tap-min` width but the settings link doesn't.
- The `'Map':'Map'` label bug above will be more visible on mobile where the toggle is the primary way to swap between map and cards.

**First-timer share-link (out of strict scope for `/`):**
- If a friend somehow landed here, the wordmark + count "5 destinations" is intelligible but presumes context. No tagline, no help link, no "what is this?" The page assumes the owner.

## Minor Observations

- `+page.svelte:974` `border-top-color: #fff` on `.btn-spinner` — raw white literal in chrome. Token it.
- Sort select at `margin-left: auto` (`+page.svelte:1190`) creates an inconsistent gap from Filters at narrow-but-not-mobile widths.
- Seed (forest) and pin (sunset) are two different "primary" treatments side by side in the header; intentional code, but the tooltip is hover-only so touch users can't learn the distinction.
- `header h1` is `font-weight: 500`, `.count-num` is `font-weight: 800` (`+page.svelte:1062, 1074`) — the count visually outweighs the wordmark. Mildly inverted hierarchy.
- Two stacked top-right success toasts (`+page.svelte:427-437`) share fixed position with no stacking offset.
- The aside: the live page rendered with only 5 cards during scanning (`count-num = 5`, not the target ~30). Cognitive-load assessment is conditional on the populated state. Worth re-running this critique against a 30-trip database to verify the single-column stack scales gracefully.

## Questions to Consider

1. **Why is the map's tile layer raw OSM?** Everything else is hand-considered. Default OSM is the third-party island in a curated room. Stadia or a filtered OSM would make the map *part of the brand*.
2. **What if cards became a denser list?** With 30 trips you'll scroll a lot. A horizontal-photo-strip row (thumb left, title + meta right) doubles density; the photo can still go generous on hover/focus. Cards-as-cards may be reflexive here.
3. **What if filters lived on the map?** The map already has every pin. Lasso, zoom-to-region, drive-time-radius from home are spatial filter primitives that would push hardest on "the map is the interface."

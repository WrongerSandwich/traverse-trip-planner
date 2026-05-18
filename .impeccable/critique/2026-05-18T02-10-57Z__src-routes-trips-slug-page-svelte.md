---
target: planning page
total_score: 28
p0_count: 2
p1_count: 5
timestamp: 2026-05-18T02-10-57Z
slug: src-routes-trips-slug-page-svelte
---
## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Jobs badge, brochure-stale notice, editing banner, typing dots, save spinner. Stale notice is Edit-mode-gated. |
| 2 | Match System / Real World | 3 | "Trip / Stops / Logistics / Field guide" all read naturally. "Re-prepare brochure" is mildly jargonish. |
| 3 | User Control and Freedom | 3 | Save/Cancel per section, confirms for destructive actions; no unsaved-edit warning on navigate-away. |
| 4 | Consistency and Standards | 2 | Amber tokens that don't exist, two different banner styles, staleness only in Edit mode, hero taller than map. |
| 5 | Error Prevention | 3 | Confirms before complete/archive/disable-share; `anySectionEditing` blocks mode toggle. |
| 6 | Recognition Rather Than Recall | 2 | Edit-mode toggle hides all editing affordances. New users won't know per-section editing exists. |
| 7 | Flexibility and Efficiency | 3 | Chat persists per trip, Enter sends, Esc closes. No arrow-key kebab nav, no keyboard mode-toggle. |
| 8 | Aesthetic and Minimalist Design | 3 | Restrained content, but header carries 6 things and section cards are uniform boxes. Amber accent is off-palette. |
| 9 | Error Recovery | 3 | `ERROR_REGISTRY` plumbed in some places; 5 raw `alert()` calls remain. |
| 10 | Help and Documentation | 3 | Read-mode callout teaches the page; EmptyItineraryCTA teaches the brochure flow; chat empty-state offers example prompts. |
| **Total** | | **28/40** | Middle of the pack: home page 34, settings 21, header 26, this 28. Structural problems with the map and the Read/Edit split. |

## Anti-Patterns Verdict

Not slop. The page resists both obvious templates: no hero/tabs/sidebar/day-by-day scaffold, no sticky outline. Single-column field-notebook scroll: header bar, hero, slim map strip, vertical stack of bordered section cards, slide-in chat. The Read-as-default decision (`+page.svelte:80, :754-760`) is the structural choice that most differentiates this from a generic trip planner.

What undercuts it: every planning trip renders structurally identical. Same four section boxes in the same order, same map strip, same hero. Zero data-driven hierarchy. A second-order critic would say "field-notebook with rounded-rect section boxes" is itself becoming a template.

**Absolute bans:**

| Ban | Status |
|-----|--------|
| Side-stripe borders >1px | **HIT (2 instances).** `.callout` (`:1187`) — 3px forest-800. `.itinerary-view :global(h2)` (`:1557`) — 3px sunset-800. The second compounds: every day heading in a day-by-day view carries the stripe. |
| Gradient text | Pass |
| Default glassmorphism | Pass |
| Hero-metric template | Pass |
| Identical card grids | Pass (single-column scroll) |
| Modal as first thought | Pass (popovers and a slide-in panel for chat) |
| Em-dashes in copy | **HIT, severe (8 user-visible occurrences).** Worst is the brochure confirm-modal body at `:541` carrying TWO em-dashes in one sentence. Also `:168, :214, :569, :705, :857, :895, :968` + BrochureDayView.svelte separator. |

**Detector findings (verified):**
- File scan: 2 × side-tab (above), 1 × bounce-easing (`.typing` dots animation at `:1455-1464`).
- Live URL scan: 17 × line-length (~94-97 chars/line — section prose has no max-width clamp), 1 × overused-font (Inter at 94%), plus the side-tab and bounce-easing pickups.

**Browser overlay:** extension still not connected this session — source-only review.

## Overall Impression

The page has good bones (Read mode as default, EmptyItineraryCTA pattern, per-trip chat history, kebab grouping) but three structural issues drag it down. **The map is decorative** when the project's core principle is "the map is the interface" — a single-marker 220px strip with no waypoints, no route line, no stop pins, on the page where seeing the route should be free. **The Read/Edit toggle hides correctness signals** — the brochure-stale notice and the per-section "Research this →" buttons only appear in Edit mode, so a casual reader can't see that the brochure is out of date. **The amber accent uses tokens that don't exist** — every `var(--amber-*, #literal)` falls back to its hex literal (10 occurrences), which means the Edit-mode toggle, editing banner, and brochure-stale notice are stuck on amber regardless of theme, in a palette that doesn't otherwise use amber.

**Biggest opportunity:** make the map carry the page. Promote it from a 220px strip to a proper route-aware surface with waypoints, OSRM line, and numbered stop pins from `brochure.stops`. That single change moves the page from "trip data inspector" to "trip atlas," which is the brand promise.

## What's Working

- **Read mode as default** (`:80, :754-760`). Strips per-section authoring chrome from the casual-read case; changes the page's character from dashboard to notebook. Right call.
- **EmptyItineraryCTA pattern** (`EmptyItineraryCTA.svelte:41-55`). Title + subtitle + promise + button is an on-archetype Ambient Background entry point. The template the rest of the page should aspire to.
- **Per-trip chat history persistence** (`:243-260`). LocalStorage-keyed by slug, cleared when emptied. Continuing a conversation across visits feels right.
- **Chat empty-state suggestions** (`:962-968`). Three concrete example prompts in the assistant's voice. Teaches the interface in four lines.
- **Kebab grouping by purpose** (Output / Activity / Lifecycle). The right mental model — output-of-this-trip vs activity-on-this-trip vs lifecycle-of-this-trip.

## Priority Issues

**[P0] Amber accent uses 10 literal hex fallbacks because the tokens don't exist.**
Why: Every `var(--amber-*, #literal)` at `:1071-1078, :1084-1088, :1599-1603` falls back to the hardcoded hex. No `--amber-*` definition exists in `app.css` (verified). The Edit-mode toggle active state, editing banner, and brochure-stale notice are stuck on amber regardless of theme. Amber is also off-palette for forest+bone+sunset+bark.
Fix: replace `--amber-*` with `--sunset-*` (sunset-50 background, sunset-200 border, sunset-800 text). Sunset already carries the "warning/active/edit" semantic across the rest of the project. No new tokens needed.
→ `/impeccable colorize`

**[P0] Em-dashes in 8 user-visible copy locations.**
Why: Project policy from the home/settings cleanup. This page is the residual offender. The brochure confirm-modal body at `:541` is the worst (two em-dashes in one sentence). Also page `<title>` (`:705`), inline error strings (`:168, :214, :569`), tooltip (`:857`), stale notice (`:895`), chat hint (`:968`), and `BrochureDayView.svelte:14, :24`.
Fix: replace each `—` with a period, comma, parenthesis, or restructured clause. For the BrochureDayView time-to-activity separator, pick consciously (vertical bar, colon, comma — affects every itinerary line).
→ `/impeccable distill`

**[P1] The map is a decorative 220px strip, not the interface.**
Why: CLAUDE.md says "On planning trips with `waypoints` set, the route line should be drawn." `MiniMap` (`MiniMap.svelte:1-43`) is single-marker, no waypoints, no OSRM line, no numbered pins. The strip sits at `:803` between callout and itinerary. The hero photo (280px) is taller than the map (220px), inverting the brief's principle. For a road-trip filing cabinet, the planning page is *the* page where the route should be free.
Fix: swap MiniMap for a route-aware surface that consumes `waypoints` and `brochure.stops`, draws the OSRM line, drops numbered pins, and claims ~40vh of the desktop layout. Reuse the brochure-page map component if one exists.
→ `/impeccable shape`

**[P1] Empty-section state doesn't teach; brochure-stale notice is Edit-mode-only.**
Why: `.section-empty` (`:1291`) is one italic gray line. In Read mode the "Research this section →" button (`:850-862`) is gated behind Edit mode, so a casual reader gets "Not yet researched." with no path forward. The brochure-stale notice (`:893-903`) is similarly Edit-mode-only — a trip whose stops file changed yesterday won't surface staleness on Sunday-morning visits.
Fix: show "Research this section →" in Read mode (it's a content-producing action, not an authoring affordance — matches EmptyItineraryCTA's logic). Make brochure-stale notice always visible, calm in style; the Re-prepare button can still require Edit mode.
→ `/impeccable shape`

**[P1] Side-stripe borders >1px in two places (absolute-ban hit).**
Why: `.callout` at `:1187` (3px forest-800) and `.itinerary-view :global(h2)` at `:1557` (3px sunset-800). The second compounds — every day heading in a day-by-day view carries a 3px sunset stripe.
Fix: rewrite. Callout becomes a full border (1px sunset-200) + background tint (sunset-50). Itinerary day-heading uses a leading number badge (e.g. `Day 1`) instead of a stripe — already conceptually there as the "Day N" copy.
→ `/impeccable polish`

**[P1] Five `alert()` calls remain.**
Why: `:214` (save edits), `:358` (mark completed), `:487` (enable sharing), `:510` (disable sharing), `:607` (archive). The home page got migrated to `ERROR_REGISTRY` earlier this session; the settings page too. This page lags. Each alert is a UX dead-end and inconsistent with `failureSentence()` routing already used elsewhere on the same page.
Fix: route each through `ERROR_REGISTRY` codes (most can use the new `save_failed` or a per-action label like `action_failed` with `{action}`). Display via inline toast/banner, not `alert()`.
→ `/impeccable harden`

**[P1] Line length runs ~94-97ch; heading scale is shallow.**
Why: Content max-width 760px at 0.92rem (~14.7px) produces ~85-90ch of body — above the 65-75ch comfort range. Heading scale: h1 1.4rem → section h2 1.05rem → prose h2/h1 1rem → body 0.92rem — only ~5-7% between steps. Hard to tell at a glance which heading you're under.
Fix: drop content max-width to ~680px (or bump body to ~1rem), and widen the scale: h1 1.6rem, section h2 1.2rem, prose h3 0.95rem. Cuts 17 line-length detector findings in one stroke.
→ `/impeccable typeset`

**[P2] Touch targets below 44px on edit toggle and chat FAB.**
Why: `.edit-mode-toggle` (`:1053`) is ~30px tall. `.chat-fab` mobile (`:1643`) is ~36-40px. PRODUCT.md commits to 44px.
Fix: `min-height: var(--tap-min)` on both. The chat FAB is a primary AI affordance — more important.
→ `/impeccable adapt`

## Persona Red Flags

**Sunday-morning owner (desktop, anticipatory):** Photo and stage pill, scroll, 220px map strip is a single dot (no sense of the drive), four uniform section cards. To know "is this trip ready" they have to spot the brochure-stale notice — hidden because they haven't entered Edit mode. The "anticipation" the brief promises gets undercut: the map is decorative and the correctness signal is invisible.

**Kitchen-phone owner (mobile, brief reference):** Header wraps to 2-3 rows of chrome. Hero (200px) + map (220px) + Read-mode callout + itinerary slot push the Stops card ~600px down. Edit toggle is ~30px tap. The drive-time in the meta row is their best shortcut, at least it's always visible.

**Friend-with-share-link:** The Read default is right for them. They don't see Edit affordances (good). They see hero + map dot + section prose. Kebab feature-gating for share-route context needs an audit not visible in this file (which kebab items appear under `/share/<token>` should be a deliberate decision).

## Minor Observations

- `text-secondary, #64748b` fallback at `:1590` is slate blue — wrong palette. Drop the fallback or use a bone-* shade.
- "Mark as completed" body copy at `:347` says "It'll move out of planning into the completed archive." Calling completed "the archive" is misleading given there's an actual `archived/` folder.
- "Re-prepare brochure" label at `:900` is jargon. "Regenerate brochure" or "Refresh" would read better.
- Chat input placeholder "What should change?" is good — keep it.
- KebabMenu lacks arrow-key navigation between items; on a 5-7 item menu the omission is noticeable.
- KebabMenu doesn't move focus into the panel on open or return it to the trigger on close — keyboard discoverability cliff.
- Disable-share button (`:641`) is destructive-ish (revokes a public URL) but isn't marked `danger: true` — renders identically to non-destructive Output items.
- `.typing` dots use `animation: bounce` at `:1460` — the keyframes are translateY + opacity, not a true bounce, but the detector name-match and the visual hop both flag. Could become opacity-only pulse for less dated-loader feel.

## Questions to Consider

1. **If "the map is the interface," why is the map a 220px decorative strip and the hero photo 280px?** Inverting that ratio would change the page's character — from "trip data inspector" to "trip atlas."
2. **Is the Read/Edit toggle the right primitive, or is it a polite way of saying "we built two pages and rolled them into one"?** Would a long-form planning page + a separate quick-reference mobile view actually be cheaper than the toggle's cognitive cost?
3. **The page has 8 different ways to surface in-flight work** (header job badge, brochure-stale notice, editing banner, chat typing dots, save spinner, EmptyItineraryCTA busy state, ⋯ menu disabled labels, in-modal promise). They're each individually well-considered. Does the page *as a whole* have a coherent status visual language?

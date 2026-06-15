---
name: Traverse
description: A personal road-trip filing cabinet where the map is the interface.
colors:
  forest-primary: "#2D5840"
  forest-deep: "#1F4332"
  forest-ink: "#112619"
  bone-page: "#FCFAF5"
  bone-raised: "#F6F1E5"
  bone-sunken: "#EBE0C9"
  sunset-accent: "#D87B3F"
  sunset-accent-ink: "#8D4C24"
  ink-tertiary: "#5F5341"
  border-default: "#C9B695"
  border-subtle: "#DCD2BC"
  state-danger: "#A82F1F"
  state-info: "#3D5A6E"
  state-warning: "#8D4C24"
typography:
  display:
    fontFamily: "Fraunces, ui-serif, Georgia, serif"
    fontSize: "56px"
    fontWeight: 500
    lineHeight: 1
    letterSpacing: "0.005em"
  headline:
    fontFamily: "Fraunces, ui-serif, Georgia, serif"
    fontSize: "40px"
    fontWeight: 500
    lineHeight: 1.1
  title:
    fontFamily: "Fraunces, ui-serif, Georgia, serif"
    fontSize: "26px"
    fontWeight: 500
    lineHeight: 1.23
  body:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "11px"
    fontWeight: 500
    letterSpacing: "0.18em"
  mono:
    fontFamily: "JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.54
rounded:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  chip: "999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "6": "24px"
  "8": "32px"
  "12": "48px"
  "16": "64px"
components:
  button-primary:
    backgroundColor: "{colors.forest-deep}"
    textColor: "{colors.bone-page}"
    rounded: "{rounded.xs}"
    padding: "10px 18px"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.forest-primary}"
    rounded: "{rounded.xs}"
    padding: "10px 18px"
  chip-category:
    backgroundColor: "{colors.sunset-accent}"
    textColor: "{colors.bone-page}"
    rounded: "{rounded.sm}"
    size: "28px"
  pill-status:
    backgroundColor: "{colors.bone-sunken}"
    textColor: "{colors.forest-primary}"
    rounded: "{rounded.chip}"
    padding: "3px 9px"
  card-tier2:
    backgroundColor: "{colors.bone-raised}"
    textColor: "{colors.forest-ink}"
    rounded: "{rounded.lg}"
    padding: "16px"
---

# Design System: Traverse

> **Scope.** This is the AI-agent-facing token spec: normative tokens in the
> frontmatter, applied guidance in the prose. The comprehensive human reference
> (logo construction, iconography, brand voice, the paper-map illustration) lives
> in [`design-spec.md`](design-spec.md); the dark theme rationale in
> [`traverse-dark-mode-spec.md`](traverse-dark-mode-spec.md). When values here and
> in `design-spec.md` disagree, **the implemented tokens in `src/app.css` win** and
> this file tracks them.

## 1. Overview

**Creative North Star: "The Field Atlas"**

Traverse is a personal road-trip filing cabinet, and it should feel like one good
object: the energy of a well-drawn atlas married to the precision of a
well-maintained field notebook. You are looking at a map before a trip, not
managing a to-do list. Spatial context is primary; data serves the mood. The
palette is "Dusk" — warm bone-cream surfaces, deep forest ink, a single sunset
accent — and it never reaches for the cold, the corporate, or the loud.

Density is earned, not assumed. This is a one-or-two-traveler tool, so restraint
is the credibility signal: hairline borders, two type weights, one accent used
sparingly, generous air around the things that matter. The structured planning
surfaces (Plan, Candidates) carry a quiet "soft-card dashboard" chrome; the prose
surfaces (Overview, Route, Logistics) stay calm and editorial. The contrast
between those two registers — not decoration — is what creates hierarchy.

It explicitly rejects: the transactional review-industrial clutter of
TripAdvisor/Booking; the navy-sidebar, hero-metric, identical-card-grid look of a
generic SaaS dashboard; the ornamental, image-over-substance influencer aesthetic
of travel blogs and Pinterest; and the personality-free utilitarianism of raw
Google Maps. The map here is curated, not a search result.

**Key Characteristics:**
- Warm, never stark — every neutral is tinted toward bone or forest.
- The map is the interface, not an illustration.
- Tiered surfaces: calm prose vs. carded tools.
- Restraint as credibility; one accent, two type weights.
- Mobile is a first-class context, not a shrunk desktop.

## 2. Colors

A warm "Dusk" palette: cream paper, forest ink, one sunset accent, with quiet
brand-family ramps (sky, bark, bone) reserved for categorization.

### Primary
- **Forest** (`#2D5840` primary, `#1F4332` deep, `#112619` ink): the brand's
  structural color. Primary text, the sticky header band, primary-button fill,
  the "planning" stage family. Forest is the ink and the architecture.

### Accent
- **Sunset** (`#D87B3F`, ink form `#8D4C24`): the single accent. Reserved for
  primary actions, current selection/active state, progress, and the day-card
  leading edge. Its rarity is the point.

### Neutral
- **Bone** (`#FCFAF5` page, `#F6F1E5` raised, `#EBE0C9` sunken): warm cream
  surfaces. Elevation reads as *lighter*, not shadowed. `#5F5341` is tertiary ink;
  `#C9B695` / `#DCD2BC` are the default / subtle borders.

### Tertiary (categorization only)
- **Sky** `#5B7E92`, **Bark** `#5C4031`, plus sunset/forest/bone stops: each
  candidate **category** maps to a brand-family ramp (`--cat-<category>` with a
  `-tint` background and an `-on` text stop) so a glance at the candidate pool
  reads "what kind of trip is forming." Never used decoratively outside category
  signaling.

### State
- **Danger** `#A82F1F`, **Info** `#3D5A6E`, **Warning** `#8D4C24`, **Success**
  forest. Each has a light surface tint for filled banners/badges.

### Named Rules
**The Warm Neutral Rule.** Never `#000` or `#fff`. Every neutral is tinted toward
bone or forest. Pure black/white is forbidden.

**The Quiet Accent Rule.** Sunset is used for primary actions, current selection,
and state only — never as decoration, and never on inactive states. If the accent
is everywhere, it means nothing.

**The Dark Mode Re-map Rule.** Dark mode ("Dusk after dark") re-maps semantic
tokens to deep warm forest-charcoal surfaces; it never inverts. Raw brand ramps
are not redefined — mode-dependent color flows through semantic tokens only.

## 3. Typography

**Display Font:** Fraunces (serif), with `ui-serif, Georgia` fallback.
**Body / UI Font:** Inter, with the native `-apple-system` stack.
**Mono Font:** JetBrains Mono (metadata, coordinates, keycaps).

**Character:** A warm high-contrast serif for headings against a clean neutral
sans for everything operational. The serif carries the "notebook" warmth; the
sans keeps data legible and quiet.

### Hierarchy
- **Display** (Fraunces 500, 56px/56): rare brand moments only.
- **Headline** (Fraunces 500, 40px/44): page titles.
- **Title** (Fraunces 500, 26px/32): section headings (Overview, Plan, Candidates).
- **Body** (Inter 400, 15px/24): prose and content; cap measure at 65–75ch.
- **Label** (Inter 500, 11px, `0.18em`, uppercase): overlines and small caps.
- **Mono** (JetBrains Mono 400, 13px/20): coordinates, drive figures, `⌘K` keycaps.

### Named Rules
**The Two-Weights Rule.** Only 400 (regular) and 500 (medium). Weights of 600+
are forbidden — they fight the quiet civic register.

**The Sentence-Case Rule.** Button and UI labels are sentence case, never
UPPERCASE. The only uppercase is the tracked `label` overline.

## 4. Elevation

Tonal layering first, with soft warm shadows as a light accent on the structured
"Tier-2" cards. Depth is primarily conveyed by surface lightness (raised > page >
sunken). In **dark mode**, shadows read poorly, so elevation is conveyed by a
lighter surface stop plus a faint border — the shadow tokens collapse to a
near-invisible hairline.

### Shadow Vocabulary
- **`--shadow-card`** (`0 2px 12px rgba(60,41,33,0.09)`): the default lift for
  Tier-2 cards (Plan, Candidates) and on candidate-card hover.
- **`--shadow-raised`** (`0 8px 28px rgba(60,41,33,0.14)`): reserved for the most
  elevated transient surfaces (menus/overlays).

### Named Rules
**The Tonal-First Rule.** Reach for a lighter surface before a shadow. Shadows are
a soft accent on cards, not the primary depth cue.

**The Elevation-By-Light Rule (dark mode).** On dark surfaces, lift with a lighter
surface + `--border-subtle`, never a drop shadow.

## 5. Components

Refined and restrained, warmly so. Standard affordances behave the way fluent
users expect; personality lives in the palette and type, not in invented controls.

### Buttons
- **Shape:** 4px radius (`rounded.xs`), 1.5px border, weight 500, sentence case.
- **Primary:** forest-deep fill, cream text. In dark mode it inverts to a light
  fill with dark text (highest affordance). Hover deepens the fill.
- **Secondary:** transparent with a hairline default border, forest text; hover
  fills with `--surface-raised`.
- **Tertiary:** text-only, tertiary ink, darkens to primary on hover.
- **Danger:** transparent with a danger-colored border; hover fills with the
  danger surface tint.
- **States:** every button has a 44px tap floor on coarse pointers
  (`@media (pointer: coarse)`), regardless of visual padding.

### Chips and pills
- **Category icon-chip** (`.cat-chip`): a solid square (`rounded.sm`, 28px) filled
  with the saturated `--cat-<category>` color, glyph in the on-color. Decorative
  (`aria-hidden`); the category is always also in text.
- **Itinerary marker** (Plan day rail): a *circular* category-colored disc — not
  the square `.cat-chip` — carrying the stop's sequence number in tabular figures.
  The only place order is encoded as a marker; the number is decorative
  (`aria-hidden`, sequence is also carried by DOM order).
- **Status / toggle pills** (meta pills, day chips, filter chips, prep chips):
  fully rounded (`rounded.chip`) with a single 1px border (`--chip-border`). One
  pill geometry for all status/toggle tokens; color/state varies, geometry does
  not.
- **Chrome controls** (header pills): button family (4px), live on the forest
  header band.

### Cards / Containers
- **Tier-2 card** (`.section` for Plan/Candidates): `--surface-raised`,
  `rounded.lg`, `--shadow-card`, 16px padding. The elevated "tool" surface.
- **Day card** (signature): `--surface-page`, `rounded.md`, full `--border-subtle`
  border plus a 3px sunset leading edge (`--accent-edge`, lifted in dark mode) that
  reads as a "day spine," with a `Day N` chip in the header. The day's title is a
  small Fraunces serif (the only serif below section-title size). Inside the card
  the stops render as a **numbered itinerary rail**: an itinerary-marker per stop
  on a left rail, joined by one continuous hairline thread (`--border-default`, not
  the accent), with the drive between stops riding the thread as a mono node.
  Distinct from the card's day-spine leading edge; the thread is a centered gutter
  rule, not a border stripe.
- **Lodging sub-card:** tinted `--surface-sunken`, `rounded.md`, with an accent
  Book button.
- **Tier-1 prose** (Overview/Route/Logistics): no card — an overline label, a
  Fraunces title, a short sunset hairline rule, then prose, separated by hairline
  dividers. The calm counterweight to the Tier-2 cards.

### Navigation
- **Sticky header:** a slim forest band (subtle `forest-800 → forest-900`
  gradient) with chrome pills; stays pinned while scrolling.
- **Desktop trip rail** (signature, ≥960px): a sticky right column with a mini
  overview map, quick stats, and a scroll-spy section nav. Collapses into the
  single mobile column below the breakpoint.

### Signature: the map
The map is a first-class surface, not an illustration — OSM tiles are filtered to
the cream/forest palette so they read as part of the design. Leaflet maps must
isolate their stacking context so internal z-index layers can't paint over chrome.

## 6. Do's and Don'ts

### Do:
- **Do** tint every neutral toward bone or forest (chroma is small but present).
- **Do** keep the accent rare — primary actions, selection, and state only.
- **Do** convey elevation with surface lightness first; soft shadow only on Tier-2
  cards; in dark mode, surface + border instead of shadow.
- **Do** use exactly two type weights (400/500) and sentence-case labels.
- **Do** give the map primacy; ground every destination geographically.
- **Do** keep prose at 65–75ch and honor the 44px coarse-pointer tap floor.

### Don't:
- **Don't** use `#000` or `#fff`, or any cold/neutral gray that isn't tinted.
- **Don't** build the generic SaaS dashboard — no navy sidebar, no hero-metric
  template, no endless identical icon+heading+text card grids (a PRODUCT.md
  anti-reference).
- **Don't** drift transactional like TripAdvisor/Booking (star ratings, "Book now"
  urgency, ad density) or ornamental like a travel-blog/Pinterest feed (PRODUCT.md
  anti-references).
- **Don't** let the map feel like raw Google Maps — it is curated, not a search
  result.
- **Don't** use gradient text (`background-clip: text`), decorative glassmorphism,
  or weights of 600+.
- **Don't** use emoji as functional UI icons — they break the warm Dusk palette
  with multicolor glyphs and render inconsistently across platforms. Use inline
  stroke SVGs in `currentColor` (the address pin, hours, website, phone, and
  "find more" sparkle all follow this). See `design-spec.md` §6 Iconography.
- **Don't** use a colored single-sided border stripe (`border-left`/`border-right`
  > 1px as an accent) on cards, list items, or callouts. *(One sanctioned
  exception: the Plan day-card's 3px leading edge, which sits on a card that already
  has a full border + radius and reads as a structural "day spine" — not a bare
  stripe. New patterns should not copy it without that justification.)*
- **Don't** reinvent standard affordances for flavor (custom scrollbars, weird
  form controls, modal-as-first-thought).

# Traverse

## Register

product

## Users

One or two travelers, self-hosted on a home server accessed over LAN. Two primary contexts:

**Desktop (planning mode):** At home on a laptop, leisurely and anticipatory, browsing ideas, looking at routes, deciding between options. This is where new trips get seeded and deepened.

**Mobile (reference and discovery mode):** On a phone anywhere in the house, on the couch, in the kitchen. Checking what's bookmarked, seeing what's been researched, triggering a deepen or seed. Not a booking flow. Quick reads, not deep research sessions. The map should still work; the detail panel should still be usable; the card list should be the primary browsing surface.

Both users are comfortable with technology. Mobile-friendliness means useful-on-phone, not app-store-polish.

## Product Purpose

A personal road-trip filing cabinet. Ideas get seeded, researched, deepened, and eventually planned and completed. The tool tracks the full lifecycle of a trip from loose pitch to retrospective. Success looks like the user actually going somewhere they found in this tool — and coming back to log that they did.

## Brand Personality

Exploratory, confident, spatial.

References: AllTrails, Komoot — tools that make you feel like you're already on the road while you're still planning. The map is never decorative; it is the interface. The experience should have the energy of a good atlas and the precision of a well-maintained notebook.

## Anti-references

- **TripAdvisor / Booking.com** — transactional, ad-dense, review-industrial-complex. No star ratings, no "Book now" urgency, no clutter.
- **Generic SaaS dashboard** — navy sidebar, hero metrics, identical card grids, nothing that suggests the product knows what it's for.
- **Travel blog / Pinterest** — influencer aesthetic, image-first to the point of substance loss, ornamental typography.
- **Google Maps UI** — utilitarian to the point of personality-free. The map here should feel curated, not like a search result.

## Design Principles

1. **The map is the interface.** Spatial context is primary, not supplemental. Every interaction that involves a destination should ground it geographically.
2. **Anticipation over administration.** The design should evoke the feeling of looking at a map before a trip, not managing a to-do list. Data serves the mood; the mood isn't incidental.
3. **Earn every pixel of complexity.** This is a personal tool with ~30 trips. It doesn't need the density of a professional tool. Restraint is credibility.
4. **Motion as geography.** Animations should feel like travel — the map flies, routes appear — not like software responding to clicks.
5. **Depth without friction.** The filing-cabinet metaphor means there's always more to explore (stops, logistics, routes) but the surface should never feel like work to navigate.
6. **Mobile as a first-class context, not an afterthought.** The phone version should be immediately useful, not a degraded experience. Cards scroll well, the detail panel opens cleanly, the map is present but not dominant.

## Accessibility & Inclusion

Personal tool, no external WCAG requirement. Aim for WCAG AA on text contrast as a floor. Touch targets minimum 44px. Reduced motion should respect `prefers-reduced-motion` for the map animations.

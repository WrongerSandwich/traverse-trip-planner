# Offline support — static Today-view bundle (#443)

**Milestone:** v0.1.3 Offline support
**Status:** Design approved, ready for implementation plan
**Date:** 2026-06-07

## Problem

Traverse is self-hosted on a home-server Docker container (port 3456). On the
road — a state park, a Driftless backroad — that server is simply
**unreachable**. The mobile Today view (#442) is a live on-the-road surface, but
it assumes you can load a page from the home LAN exactly when you can't. The
in-trip data matters most precisely where the server is out of reach.

## Scope

**In scope (v0.1.3):** Make the **Today view** survive zero connectivity via a
**static, self-contained HTML bundle** the user downloads before leaving Wi-Fi.

**Out of scope (deferred):**
- Offline brochure / detail / whole filing cabinet. The brochure is asset-heavy
  (Stadia tile mosaic, Pexels photos, route SVG); the Today view is the
  milestone's in-trip surface and is near-asset-free, so it is the right and
  cheap target.
- PWA / service worker. See "PWA: deferred, TLS-gated" below.
- In-trip *capture* / writes — that is #444, which builds on this snapshot model.

## Why a static bundle (not a PWA)

A service worker — the usual offline mechanism — **requires a secure context**
(HTTPS or `localhost`). The documented Traverse deploy serves **plain HTTP on a
LAN address** (`http://<server-ip>:3456`, docs/deploy.md; compose maps 3456
straight through, no TLS). Over plain-HTTP-to-a-LAN-IP, browsers refuse to
register a service worker. Standing up HTTPS for a `.lan` host means installing a
local-CA certificate on every phone — a real burden, out of scope for v0.1.3.

A downloaded HTML file has **no such requirement**: it works regardless of TLS,
needs no server, and — because the Today view is text plus tappable links with
no inline maps or photos — is tiny and trivially self-contained.

## What the bundle is

- **One self-contained `.html` file per trip**, covering **all days** of the
  Today view.
- **Default zero external references.** All CSS inlined in a `<style>` block; the
  app logo inlined as a `data:` URI; no map tiles, no Pexels photos, no remote
  fonts, no `/_app/` asset links. The file must render identically with the
  network fully off. This is an enforced invariant (see Testing).
- **In-file day switcher.** A few lines of vanilla JS (no framework, no
  SvelteKit hydration) toggle between days, mirroring the day-picker on the live
  Today view. All days are embedded. On open, the inline script resolves the
  default day against the **device clock** (using the embedded per-day dates, the
  same logic as `resolveCurrentDay()`), so a bundle saved days early still opens
  to the correct day once the trip is underway; it falls back to the
  generation-time default day if date resolution yields nothing.
- **Staleness banner.** A `synced as of <timestamp>` line baked in at generation
  time so a frozen snapshot is never mistaken for live data. Copy:
  *"Offline copy · synced <date> — re-download if you change the plan."*

### Content (exact mirror of the Today view)

Per day, in Today-view order:
- **Stops:** number, name, category, hours, address, the "Start here" marker on
  stop 1, and the per-stop tips & to-dos (rendered expanded — no JS disclosure
  needed offline, or a CSS-only `<details>`).
- **Tonight's lodging:** name, Navigate, and Booking link (omitted on nights with
  no lodging, matching the live view).
- **Trip-wide Field guide & gotchas** (notes + gotchas lists).

No new content types are introduced; the bundle renders the same
`deriveBrochure()` data the Today route already consumes.

### Action links offline

- **`tel:`** — works fully offline.
- **Navigate** — keep the existing Google Maps URL **and add a `geo:<lat>,<lng>`
  link** as an offline-friendly handoff to the device's default maps app (which
  may have offline maps downloaded). Google Maps web URLs need connectivity;
  `geo:` does not.
- **Website** — kept; needs connectivity, degrades to a non-functional link
  offline.
- **Addresses and phone numbers stay as selectable text** so the information is
  usable even when every link is dead.

## Architecture

Mirror the brochure's derivation pattern: request-time, no AI, no file cache.

1. **`renderOfflineToday(brochureData, { generatedAt })` → HTML string.**
   A new pure server-side renderer. Consumes the **same `deriveBrochure()`
   shape** the Today route uses — no new data path. Produces a complete,
   self-contained HTML document (inlined `<style>`, inlined logo, inline day
   switcher script, `geo:` links). Responsible for HTML-escaping all
   trip-derived content.

2. **`GET /trips/[slug]/today/offline` endpoint** (`+server.js`).
   - `isValidSlug` → `deriveBrochure(slug)` → `renderOfflineToday(...)`.
   - Returns `text/html` with
     `Content-Disposition: attachment; filename="<sanitized-slug>-today.html"`.
   - No-plan / missing `plan.yaml`: return 404 — there is nothing to bundle for
     download. (This differs from the Today *route*, which renders a "No
     day-by-day plan yet" empty state; an empty state is meaningless for a file
     download.) The UI only shows the affordance when a plan exists, so this is a
     defensive path.

3. **Affordance (Instant Inline — synchronous, no AI, no job):**
   - A **"⤓ Save for offline"** button in the Today view header (primary — you
     prep there before leaving Wi-Fi).
   - A **"📥 Save offline copy"** entry in the detail-page `⋯` menu *Output*
     group, gated on the same `data.plan?.days?.length` condition as the existing
     brochure/Today affordances.
   - Both are plain links to the endpoint; the browser downloads the file. No
     spinner state beyond the browser's own download UI.

### Drift control (primary risk)

A second renderer can diverge from the live Today view. Mitigations:
- Both render from the single `deriveBrochure()` contract — divergence is limited
  to presentation, not data.
- The renderer is a small, focused, co-located module.
- A **golden/snapshot test** asserts the bundle contains the expected
  stops/lodging/notes for a fixture trip, **and** that it contains **zero
  `http(s)://` references** — the offline guarantee, enforced in CI. If a future
  change reintroduces a remote asset, the test fails.

## Staleness model

The bundle is a frozen snapshot with no mechanism to refresh (no service worker).
The `synced as of` banner is the entire staleness contract: the user re-downloads
after changing the plan. This is acceptable for v0.1.3 and consistent with the
ticket's "offline data is a snapshot" framing.

## PWA: deferred, TLS-gated

Recorded as the future upgrade path, **not built in v0.1.3**:
- A PWA/service worker would cache the Today view and could later host #444's
  offline writes (a write queue that syncs when the home server is reachable).
- **Blocker:** service workers need a secure context. Reviving this requires a
  TLS decision for the self-hosted deploy (reverse proxy + a phone-trusted
  certificate). Until that is made, the static bundle is the supported offline
  path.

## Testing

- **Renderer unit tests** (`tests/offline-today.test.js`): correct content from a
  fixture `deriveBrochure` shape; HTML-escaping of trip-derived strings;
  `geo:`/`tel:` link formation; **no external `http(s)://` references**
  (offline invariant); graceful render of edge cases (a day with no lodging, a
  stop with no phone/website, empty field guide).
- **Endpoint test:** `Content-Disposition`/filename, content-type, slug
  sanitization, 404 on a trip with no plan.
- **Drift snapshot:** the no-external-refs assertion plus a content snapshot for a
  known fixture trip.

## Edge cases

- **No plan:** endpoint 404; affordance hidden.
- **A day with no lodging:** omit the Tonight section (matches live Today view).
- **A stop with no phone/website:** render only the links that exist (matches live
  view's conditional Navigate/Call/Site matrix).
- **Filename sanitization:** derive the download filename from the slug, stripped
  to a safe `[a-z0-9-]` set.
- **HTML injection:** all trip-derived content is HTML-escaped in the renderer.

## Decisions (locked)

- One file per trip with an in-file day switcher (not one file per day).
- Include `geo:` nav links alongside the existing Maps URLs.
- Today view only; brochure/whole-cabinet deferred.
- Static bundle now; PWA deferred and TLS-gated.

# Cover photo override

GitHub issue: [#193 — Add ability to pick a different cover picture if default pexels search picks something that doesn't match appropriately](https://github.com/WrongerSandwich/traverse/issues/193)

## Problem

Cover photos come from a Pexels search keyed by the `image_query` frontmatter field (authored by the seed/add LLM, falling back to title-minus-stopwords). The top result is used as the hero on the card, the slide-in detail panel, the detail page, and the printable brochure.

Two failure modes are unrecoverable from the UI today:

1. **Query is wrong.** The LLM picked a phrase that returns unrelated imagery (e.g. a quirky-town name that matches a different place on Pexels). Every result is bad — the search itself needs to change.
2. **Query is fine but the top hit is meh.** Pexels already returns three candidates (`per_page=3`); we always use index 0. The other two may be better, but the user can't see or pick them.

The only escape today is hand-editing `image_query` in markdown and clearing the cache entry — not a workflow the browser-first product is supposed to require.

## Solution

A single "Change cover photo" modal accessed from the detail page's `⋯` menu that handles both failure modes:

- An editable `image_query` field with a **Re-search** button, so the user can fix a wrong query.
- A row of three thumbnail tiles (the current Pexels candidates) with the active one highlighted, so the user can pick a different result without changing the query.

The user's choice persists in frontmatter as `image_query` (possibly updated) and `image_pick` (an index 0/1/2 into the photos array). `enrichTrips()` honors the pick on the next load.

### 1. UX

**Archetype: Instant Inline** (per `docs/ai-workflow-ux.md`). Pexels round-trips are sub-second; the modal stays open and shows a button-as-spinner on Re-search.

**Affordance placement:** new item in the detail page's `⋯` menu, in the **Output** group:

```
↗ View full brochure
🖼 Change cover photo…       ← new
🔗 Generate share link
```

Reasoning:

- The `⋯` menu is where metadata-flavored actions already live (Share, Add retro, Archive).
- Available in both Read and Edit modes, and on idea / planning / completed trips alike — cover photo is metadata, not content, so it shouldn't be gated to Edit mode (which is hidden on completed trips anyway).
- No new chrome on the hero photo or card thumbnails. Discoverability via the menu is consistent with Share.

**Modal layout** (uses the existing `ConfirmModal` primitive as a base, or a sibling component if `ConfirmModal` is too constrained):

```
┌─ Change cover photo ─────────────────────────────┐
│                                                  │
│  Pexels search                                   │
│  ┌────────────────────────────────┐ ┌──────────┐ │
│  │ Glacier mountains              │ │Re-search │ │
│  └────────────────────────────────┘ └──────────┘ │
│                                                  │
│  Pick one                                        │
│  ┌─────┐  ┌─────┐  ┌─────┐                       │
│  │ [✓] │  │     │  │     │                       │
│  │ img │  │ img │  │ img │                       │
│  └─────┘  └─────┘  └─────┘                       │
│  Photo by Jane Doe / Pexels                      │
│                                                  │
│              [ Cancel ]   [ Save ]               │
└──────────────────────────────────────────────────┘
```

Behavior:

- Modal opens prefilled with the current `image_query` and the current 3 photos. The active tile (index = current `image_pick`, default 0) is highlighted.
- Editing the query field enables the **Re-search** button. Clicking it calls the search endpoint; on success, the tile row swaps to the new 3 photos and the first is auto-selected. On failure, an `ERROR_REGISTRY`-driven inline message renders (no inline catch sentences).
- Clicking a tile selects it (selection is local until Save).
- **Save** commits both the query (if changed) and the pick to frontmatter, closes the modal, and triggers a `invalidate('app:trip')` so the hero photo re-renders.
- **Cancel** discards local state.
- No confirmation prompt — the action is reversible by reopening the modal.

**Failure modes routed through `ERROR_REGISTRY`** (`src/lib/errors-registry.js`):

- `image_search_failed` — Pexels returned no photos or hit an error. Inline message: "No photos found for that search. Try different words."
- `image_search_unconfigured` — `PEXELS_API_KEY` missing. Inline message reuses the existing copy from when the image cache returns null.
- `image_save_failed` — server write failed. Inline message with retry CTA.

### 2. Persistence (frontmatter)

Two fields, both on the trip's source-of-truth markdown (`ideas/<slug>.md` or `planning/<slug>/overview.md` or `completed/<slug>/overview.md`):

- `image_query` — **already exists.** This spec only changes who writes it (now also the UI, not just the LLM).
- `image_pick: 1` — **new.** Integer 0–2. Omitted entirely when value would be 0, to keep frontmatter quiet for the common case.

Writes go through the existing `setFrontmatterField` / `findTripFile` plumbing — same shape as `toggleStarred` and `setShared` in `src/lib/server/data.js`.

When `image_pick: 0` (or unset), behavior is identical to today's. Migration impact: zero. Existing trips render unchanged until the user explicitly opens the modal.

### 3. Reading side (`enrichTrips`)

In `src/lib/server/data.js`, after `fetchImage(q)`:

```js
const image = await fetchImage(q);
if (image) {
  const photos = image.photos ?? [image];
  const rawPick = Number(trip.image_pick);
  const pick = Number.isInteger(rawPick) ? Math.max(0, Math.min(rawPick, photos.length - 1)) : 0;
  const reordered = pick === 0 ? photos : [photos[pick], ...photos.slice(0, pick), ...photos.slice(pick + 1)];
  trip._image = { ...reordered[0], photos: reordered };
} else {
  trip._image = null;
}
```

Reasoning for reordering rather than just overriding top-level fields:

- Brochure atmosphere images use `photos[1]` and `photos[2]` (see `Brochure.svelte:83`). If we only swap top-level fields, the chosen cover may also appear in the atmosphere slot, double-printing.
- Reordering puts the chosen photo at index 0 and pushes the unchosen ones to 1/2, so atmosphere stays consistent and the cover is never duplicated.
- Clamping handles the edge case where a re-search returns fewer than 3 photos and a previously-saved `image_pick: 2` is now out of bounds.

The Pexels fetch itself doesn't change. Cache key stays `image_query`. `pruneCaches()` already orphan-cleans cache entries whose query no longer appears in any live trip, so changing `image_query` doesn't leak.

### 4. Server endpoints

Two new endpoints, both under `src/routes/api/trip/[slug]/image/`:

**`GET /api/trip/[slug]/image/search?q=<query>`**

Calls `fetchImage(q)` and returns `{ photos: [...] }` for the modal preview. Does not write anything. Lets the user inspect candidates for a new query before committing. Behavior:

- Same query mid-modal returns the cached entry — no extra Pexels call.
- Missing/empty `q` → 400.
- Pexels miss (zero photos) → 200 with `{ photos: [] }`. The modal interprets this as `image_search_failed`.
- Missing `PEXELS_API_KEY` → 503 with `{ code: 'image_search_unconfigured' }`.

**`POST /api/trip/[slug]/image`**

Body: `{ image_query?: string, image_pick?: 0|1|2 }`. Writes the provided fields to frontmatter via `setFrontmatterField`, omitting `image_pick` from the file entirely when the value is 0 (use `removeFrontmatterField`). Calls `invalidateEnrichCache()`. Returns `{ ok: true }`.

- Trip not found → 404.
- Invalid `image_pick` (non-integer, out of 0–2) → 400.
- File write failure → 500 with `{ code: 'image_save_failed' }`.

### 5. Components

**New: `CoverPhotoModal.svelte`** under `src/lib/components/`. Self-contained:

- Props: `trip`, `open`, `onclose`, `onsaved`.
- Owns its local state (current query, candidate photos, selected index, busy/error flags).
- Renders the layout above. Uses CSS custom-property tokens from `src/app.css` — no raw color literals.

**Modified: `src/routes/trips/[slug]/+page.svelte`**

- Add a state flag `coverPhotoModalOpen`.
- Add an item to the `Output` group in `kebabGroups`: `🖼 Change cover photo…` → opens the modal.
- After save: call `invalidateAll()` so the hero photo re-renders with the new pick.

No changes to `TripCard.svelte`, `DetailPanel.svelte`, or `Brochure.svelte` — they all read from `trip._image`, which the reading-side change above keeps correct.

## Out of scope

- **Custom uploads.** Issue asks for "a different picture" — interpreted as a different Pexels result, not user-supplied imagery. Adding upload + asset hosting + frontmatter URL handling balloons scope and adds storage concerns the rest of the product doesn't have.
- **More than three candidates.** Sticking with `per_page=3` so cache shape doesn't change. If a user wants different photos, they re-search with a different query. Easy to bump to 6 later behind the same UI.
- **Bulk re-image action.** Per-trip granularity is what the issue asks for.
- **Telemetry / "user changed photo" event.** Not load-bearing for the product. Reversible action.

## Open assumptions

These are decisions the spec commits to. Flag during review if any are wrong:

1. **Modal, not inline panel.** A row-of-three picker inline on the detail page would clutter the hero area. Modal keeps the action distinct and matches the existing pattern for retro and confirm flows.
2. **`⋯` menu, not a corner button on the hero photo.** Quieter chrome. If discoverability becomes an issue later, a small "edit cover" button on hover is a follow-up, not a re-think.
3. **`image_pick` is an integer, not a photo URL.** URLs are unstable (Pexels can rotate them), and the cache already stores 3 photos per query. Index is the natural reference.
4. **Reorder photos in `_image.photos` rather than only swap top-level fields.** Avoids the picked photo also appearing as brochure atmosphere.
5. **Available on idea trips, not just planning/completed.** Ideas are the most visible cards on the home page; gating this to planning/completed would leave the most-affected surface unfixable.
6. **No undo log.** Reversible via the same modal.

## Testing

- Unit: image-pick clamping in `enrichTrips` (out-of-bounds, missing, non-integer values).
- Unit: frontmatter round-trip for `image_pick: 0` (file should not contain the field) and `image_pick: 2` (file should).
- Unit: the new endpoints (search returns `photos`, POST writes both fields, error codes match `ERROR_REGISTRY`).
- Manual: open modal on idea / planning / completed trips; pick a non-zero photo; verify card, detail panel, detail page hero, and brochure cover all reflect the change; verify brochure atmosphere photos don't duplicate the cover.
- `npm run verify` before merge.

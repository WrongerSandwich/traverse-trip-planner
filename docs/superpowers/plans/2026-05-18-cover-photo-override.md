# Cover photo override — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a UI to override the Pexels cover photo on any trip — both by editing the search query and by picking among the candidate results — without hand-editing markdown.

**Architecture:** Two new frontmatter fields (`image_query` reused, `image_pick` new). A pure helper `applyImagePick()` reorders the photos array so the picked one is always at index 0. Two new endpoints under `/api/trip/[slug]/image/` (GET to search, POST to save). One new modal component opened from the detail page's `⋯` menu.

**Tech Stack:** SvelteKit (Svelte 5 runes), Vitest, vanilla `fetch` to Pexels via the existing `fetchImage()` helper.

Spec: [`docs/superpowers/specs/2026-05-18-cover-photo-override-design.md`](../specs/2026-05-18-cover-photo-override-design.md). GitHub issue: [#193](https://github.com/WrongerSandwich/traverse/issues/193).

## File map

**New files**
- `src/lib/components/CoverPhotoModal.svelte` — modal UI (query input + 3 tiles + Save/Cancel)
- `src/routes/api/trip/[slug]/image/+server.js` — `POST` writes frontmatter
- `src/routes/api/trip/[slug]/image/search/+server.js` — `GET` previews Pexels results
- `tests/data-image-pick.test.js` — unit tests for `applyImagePick`
- `tests/data-update-image-meta.test.js` — unit tests for `updateImageMeta`
- `tests/api-trip-image.test.js` — endpoint tests

**Modified files**
- `src/lib/server/data.js` — add `applyImagePick()` and `updateImageMeta()`; wire pick into `enrichTrips()` image block
- `src/lib/errors-registry.js` — three new error codes
- `src/routes/trips/[slug]/+page.svelte` — menu item, modal state, save handler

---

### Task 1: Add `applyImagePick` pure helper + tests

Pure function that takes the `_image` object from `fetchImage()` plus a frontmatter `image_pick` value and returns the same shape with `photos` reordered so the picked photo is at index 0. Lives in `data.js` so `enrichTrips()` can use it. Pure and side-effect-free so it's easy to unit-test.

**Files:**
- Modify: `src/lib/server/data.js` (insert helper near `fetchImage`, around line 146)
- Test: `tests/data-image-pick.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/data-image-pick.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { applyImagePick } from '../src/lib/server/data.js';

const A = { medium: 'a-m', large: 'a-l', photographer: 'A' };
const B = { medium: 'b-m', large: 'b-l', photographer: 'B' };
const C = { medium: 'c-m', large: 'c-l', photographer: 'C' };

const image = { ...A, photos: [A, B, C] };

describe('applyImagePick', () => {
  it('returns null when image is null', () => {
    expect(applyImagePick(null, 1)).toBe(null);
  });

  it('returns the original shape when pick is 0', () => {
    expect(applyImagePick(image, 0)).toEqual(image);
  });

  it('returns the original shape when pick is undefined', () => {
    expect(applyImagePick(image, undefined)).toEqual(image);
  });

  it('reorders photos so the picked one is at index 0', () => {
    const result = applyImagePick(image, 1);
    expect(result.photos).toEqual([B, A, C]);
    expect(result.medium).toBe('b-m');
    expect(result.large).toBe('b-l');
    expect(result.photographer).toBe('B');
  });

  it('accepts string pick values (frontmatter is parsed as strings)', () => {
    const result = applyImagePick(image, '2');
    expect(result.photos).toEqual([C, A, B]);
    expect(result.medium).toBe('c-m');
  });

  it('clamps pick down to the last index when out of bounds', () => {
    const result = applyImagePick({ ...A, photos: [A, B] }, 2);
    expect(result.photos).toEqual([B, A]);
    expect(result.medium).toBe('b-m');
  });

  it('clamps negative pick values to 0', () => {
    expect(applyImagePick(image, -1)).toEqual(image);
  });

  it('ignores non-integer pick values', () => {
    expect(applyImagePick(image, 'oops')).toEqual(image);
    expect(applyImagePick(image, NaN)).toEqual(image);
    expect(applyImagePick(image, 1.5)).toEqual(image);
  });

  it('handles legacy single-photo shape (no .photos array)', () => {
    const legacy = { medium: 'l-m', large: 'l-l', photographer: 'L' };
    expect(applyImagePick(legacy, 1)).toEqual(legacy);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/data-image-pick.test.js`
Expected: FAIL — `applyImagePick` is not exported from `data.js`.

- [ ] **Step 3: Write the helper**

Insert into `src/lib/server/data.js` immediately after `fetchImage()` (around line 146):

```js
// Apply a frontmatter `image_pick` to a Pexels result. Returns the same
// shape as `fetchImage()` with `photos` reordered so the picked photo
// sits at index 0, and the top-level medium/large/photographer fields
// point at the picked photo. This keeps brochure atmosphere slots
// (photos[1], photos[2]) from accidentally showing the new cover.
//
// Frontmatter values arrive as strings, so accept either; clamp to a
// valid index, and short-circuit on the trivial cases.
export function applyImagePick(image, pick) {
  if (!image) return null;
  const photos = image.photos;
  if (!Array.isArray(photos) || photos.length < 2) return image;
  const raw = typeof pick === 'string' ? Number(pick) : pick;
  if (!Number.isInteger(raw) || raw <= 0) return image;
  const idx = Math.min(raw, photos.length - 1);
  const reordered = [photos[idx], ...photos.slice(0, idx), ...photos.slice(idx + 1)];
  return { ...reordered[0], photos: reordered };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/data-image-pick.test.js`
Expected: PASS — all 9 cases green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/data.js tests/data-image-pick.test.js
git commit -m "feat(images): applyImagePick helper for cover photo override"
```

---

### Task 2: Wire `applyImagePick` into `enrichTrips()`

The image block in `enrichTrips()` currently sets `trip._image` directly from the cache hit or fresh fetch. Pipe it through `applyImagePick` so frontmatter wins.

**Files:**
- Modify: `src/lib/server/data.js:482-495`

- [ ] **Step 1: Read the current block**

The image block in `enrichTrips()` looks like:

```js
// Image
const q = imageQuery(trip);
if (q) liveImageKeys.add(q);
if (q) {
  const cached = readImageCacheEntry(imageCache, q);
  if (cached.state === 'hit') {
    trip._image = cached.value;
  } else {
    trip._image = await fetchImage(q);
    await sleep(50);
  }
} else {
  trip._image = null;
}
```

- [ ] **Step 2: Replace with picked variant**

Edit `src/lib/server/data.js` to wrap the assignments in `applyImagePick`:

```js
// Image
const q = imageQuery(trip);
if (q) liveImageKeys.add(q);
if (q) {
  const cached = readImageCacheEntry(imageCache, q);
  const raw = cached.state === 'hit' ? cached.value : await fetchImage(q);
  if (cached.state !== 'hit') await sleep(50);
  trip._image = applyImagePick(raw, trip.image_pick);
} else {
  trip._image = null;
}
```

- [ ] **Step 3: Run the full test suite to confirm nothing broke**

Run: `npx vitest run`
Expected: PASS — same as before this change; `applyImagePick` is a no-op when `image_pick` is missing, so existing trips render identically.

- [ ] **Step 4: Commit**

```bash
git add src/lib/server/data.js
git commit -m "feat(images): honor image_pick frontmatter in enrichTrips"
```

---

### Task 3: Add `updateImageMeta` server helper + tests

A frontmatter-mutation helper parallel to `toggleStarred` / `setShared`. Takes a slug and a partial `{ image_query?, image_pick? }` object; writes the markdown atomically; invalidates the enrich cache.

**Files:**
- Modify: `src/lib/server/data.js` (insert after `setShared`, around line 710)
- Test: `tests/data-update-image-meta.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/data-update-image-meta.test.js`. Follows the existing `tests/data-append-notes.test.js` convention: stub `node:fs` with an in-memory state so `data.js` (which derives `ROOT` from `process.cwd()` at module load) is unaffected by our test environment.

```js
import { describe, it, expect, beforeEach, vi } from 'vitest';

const fsState = { files: {} };

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal();
  const isDir = (p) => Object.keys(fsState.files).some(k => k.startsWith(p + '/'));
  return {
    ...actual,
    // `findTripLocation` calls existsSync on directory paths (e.g.
    // planning/<slug>) as well as file paths, so we report a directory
    // as "existing" whenever any seeded file lives under it.
    existsSync: (p) => p in fsState.files || isDir(p),
    readFileSync: (p) => {
      if (!(p in fsState.files)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return fsState.files[p];
    },
    writeFileSync: (p, content) => { fsState.files[p] = content; },
    readdirSync: () => [],
    statSync: (p) => ({ isDirectory: () => isDir(p) }),
  };
});

const { updateImageMeta } = await import('../src/lib/server/data.js');

// data.js builds paths via `join(ROOT, 'ideas', `${slug}.md`)` or
// `join(ROOT, 'planning', slug, 'overview.md')`. We seed both locations
// using the same join logic so findTripFile() resolves them.
import { join } from 'node:path';
const ROOT = process.cwd();

function seedIdea(slug, content) {
  fsState.files[join(ROOT, 'ideas', `${slug}.md`)] = content;
}
function seedPlanning(slug, content) {
  fsState.files[join(ROOT, 'planning', slug, 'overview.md')] = content;
}
function readBack(path) {
  return fsState.files[path];
}

beforeEach(() => { fsState.files = {}; });

describe('updateImageMeta', () => {
  it('writes image_query to an idea-stage trip', () => {
    const path = join(ROOT, 'ideas', 'demo.md');
    seedIdea('demo', `---
title: Demo
status: idea
destination: Demo, KS
image_query: old query
---

body
`);
    const result = updateImageMeta('demo', { image_query: 'new query' });
    expect(result).toEqual({ ok: true });
    expect(readBack(path)).toMatch(/^image_query: new query$/m);
  });

  it('writes image_pick when value is a positive integer', () => {
    const path = join(ROOT, 'ideas', 'demo.md');
    seedIdea('demo', `---
title: Demo
status: idea
destination: Demo, KS
---

body
`);
    updateImageMeta('demo', { image_pick: 2 });
    expect(readBack(path)).toMatch(/^image_pick: 2$/m);
  });

  it('removes image_pick when value is 0', () => {
    const path = join(ROOT, 'ideas', 'demo.md');
    seedIdea('demo', `---
title: Demo
status: idea
destination: Demo, KS
image_pick: 2
---

body
`);
    updateImageMeta('demo', { image_pick: 0 });
    expect(readBack(path)).not.toMatch(/image_pick/);
  });

  it('writes both fields in one call (planning stage)', () => {
    const path = join(ROOT, 'planning', 'demo', 'overview.md');
    seedPlanning('demo', `---
title: Demo
status: planning
destination: Demo, KS
---

body
`);
    updateImageMeta('demo', { image_query: 'mountains', image_pick: 1 });
    const out = readBack(path);
    expect(out).toMatch(/^image_query: mountains$/m);
    expect(out).toMatch(/^image_pick: 1$/m);
  });

  it('returns null when the trip does not exist', () => {
    expect(updateImageMeta('missing', { image_query: 'x' })).toBe(null);
  });

  it('rejects an image_pick outside 0..2', () => {
    seedIdea('demo', `---
title: Demo
status: idea
destination: Demo, KS
---
`);
    expect(() => updateImageMeta('demo', { image_pick: 3 })).toThrow(/image_pick/);
    expect(() => updateImageMeta('demo', { image_pick: -1 })).toThrow(/image_pick/);
    expect(() => updateImageMeta('demo', { image_pick: 'oops' })).toThrow(/image_pick/);
  });

  it('rejects image_query containing newlines or carriage returns', () => {
    seedIdea('demo', `---
title: Demo
status: idea
destination: Demo, KS
---
`);
    expect(() => updateImageMeta('demo', { image_query: 'multi\nline' })).toThrow(/image_query/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/data-update-image-meta.test.js`
Expected: FAIL — `updateImageMeta` not exported.

- [ ] **Step 3: Write the helper**

Insert into `src/lib/server/data.js` after `setShared()` (around line 710):

```js
// ── Image metadata mutation ──
// Writes image_query and/or image_pick to a trip's frontmatter. Both are
// optional — caller provides only the fields they want to update.
//
// image_pick === 0 (or omitted) is the implicit default, so we remove the
// field entirely in that case rather than littering frontmatter with zeros.
//
// Throws TypeError on invalid inputs so the endpoint can return 400.
export function updateImageMeta(slug, { image_query, image_pick } = {}) {
  if (image_query !== undefined) {
    if (typeof image_query !== 'string' || /[\r\n]/.test(image_query)) {
      throw new TypeError('image_query must be a single-line string');
    }
  }
  let pick;
  if (image_pick !== undefined) {
    const n = typeof image_pick === 'string' ? Number(image_pick) : image_pick;
    if (!Number.isInteger(n) || n < 0 || n > 2) {
      throw new TypeError('image_pick must be an integer 0, 1, or 2');
    }
    pick = n;
  }

  const filePath = findTripFile(slug);
  if (!filePath) return null;

  let content = readFileSync(filePath, 'utf8');
  if (!parseFrontmatter(content)) return null;

  if (image_query !== undefined) {
    content = setFrontmatterField(content, 'image_query', image_query);
  }
  if (pick !== undefined) {
    content = pick === 0
      ? removeFrontmatterField(content, 'image_pick')
      : setFrontmatterField(content, 'image_pick', pick);
  }

  writeFileSync(filePath, content);
  invalidateEnrichCache();
  return { ok: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/data-update-image-meta.test.js`
Expected: PASS — all 7 cases green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/data.js tests/data-update-image-meta.test.js
git commit -m "feat(images): updateImageMeta server helper"
```

---

### Task 4: Add error registry codes

Three new `ERROR_REGISTRY` entries the modal will use to render failure sentences without inline catch strings.

**Files:**
- Modify: `src/lib/errors-registry.js`
- Test: `tests/errors-registry.test.js` (existing — extend)

- [ ] **Step 1: Write the failing test**

Open `tests/errors-registry.test.js` and add at the end of the existing describe block (or in a new `describe` near the end):

```js
describe('image cover-photo codes', () => {
  it('exposes image_search_failed with a retry affordance', () => {
    expect(ERROR_REGISTRY.image_search_failed).toBeDefined();
    expect(ERROR_REGISTRY.image_search_failed.affordances).toContain('retry');
  });
  it('exposes image_search_unconfigured with a dismiss affordance', () => {
    expect(ERROR_REGISTRY.image_search_unconfigured).toBeDefined();
    expect(ERROR_REGISTRY.image_search_unconfigured.affordances).toContain('dismiss');
  });
  it('exposes image_save_failed with a retry affordance', () => {
    expect(ERROR_REGISTRY.image_save_failed).toBeDefined();
    expect(ERROR_REGISTRY.image_save_failed.affordances).toContain('retry');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/errors-registry.test.js`
Expected: FAIL — codes are undefined.

- [ ] **Step 3: Add the codes**

Append to the `ERROR_REGISTRY` object in `src/lib/errors-registry.js` (immediately before the closing `};`):

```js
  image_search_failed: {
    sentence: 'No photos found for that search. Try different words.',
    affordances: ['retry', 'dismiss'],
  },
  image_search_unconfigured: {
    sentence: 'Image search is not configured. Add a PEXELS_API_KEY to enable it.',
    affordances: ['dismiss'],
  },
  image_save_failed: {
    sentence: "Couldn't save the cover photo. Try again.",
    affordances: ['retry', 'dismiss'],
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/errors-registry.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/errors-registry.js tests/errors-registry.test.js
git commit -m "feat(images): error codes for cover-photo modal"
```

---

### Task 5: GET `/api/trip/[slug]/image/search` endpoint + tests

Calls `fetchImage(q)` and returns the candidate photos. No frontmatter writes here — this is preview-only.

**Files:**
- Create: `src/routes/api/trip/[slug]/image/search/+server.js`
- Test: `tests/api-trip-image.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/api-trip-image.test.js`:

```js
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// We stub data.js (fetchImage / updateImageMeta) per-test instead of
// touching real disk or hitting Pexels.

afterEach(() => vi.resetModules());

describe('GET /api/trip/[slug]/image/search', () => {
  it('returns 400 when q is missing', async () => {
    vi.doMock('$lib/server/data.js', () => ({ fetchImage: vi.fn() }));
    const { GET } = await import('../src/routes/api/trip/[slug]/image/search/+server.js');
    const res = await GET({ params: { slug: 'demo' }, url: new URL('http://x/?q=') });
    expect(res.status).toBe(400);
  });

  it('returns 503 image_search_unconfigured when PEXELS_API_KEY is missing', async () => {
    vi.doMock('$lib/server/data.js', () => ({
      // fetchImage returns null when no API key is configured.
      fetchImage: vi.fn().mockResolvedValue(null),
      isPexelsConfigured: vi.fn().mockReturnValue(false),
    }));
    const { GET } = await import('../src/routes/api/trip/[slug]/image/search/+server.js');
    const res = await GET({ params: { slug: 'demo' }, url: new URL('http://x/?q=mountains') });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe('image_search_unconfigured');
  });

  it('returns the photos array on success', async () => {
    const photos = [
      { medium: 'a-m', large: 'a-l', photographer: 'A' },
      { medium: 'b-m', large: 'b-l', photographer: 'B' },
    ];
    vi.doMock('$lib/server/data.js', () => ({
      fetchImage: vi.fn().mockResolvedValue({ ...photos[0], photos }),
      isPexelsConfigured: vi.fn().mockReturnValue(true),
    }));
    const { GET } = await import('../src/routes/api/trip/[slug]/image/search/+server.js');
    const res = await GET({ params: { slug: 'demo' }, url: new URL('http://x/?q=mountains') });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.photos).toEqual(photos);
  });

  it('returns empty photos when Pexels finds nothing', async () => {
    vi.doMock('$lib/server/data.js', () => ({
      fetchImage: vi.fn().mockResolvedValue(null),
      isPexelsConfigured: vi.fn().mockReturnValue(true),
    }));
    const { GET } = await import('../src/routes/api/trip/[slug]/image/search/+server.js');
    const res = await GET({ params: { slug: 'demo' }, url: new URL('http://x/?q=zzzzzz') });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.photos).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api-trip-image.test.js`
Expected: FAIL — endpoint module does not exist.

- [ ] **Step 3: Add `isPexelsConfigured` to data.js**

Insert into `src/lib/server/data.js` immediately before `fetchImage()` (around line 115):

```js
// Whether Pexels search is available in this environment. The endpoint
// distinguishes "search failed" (network/quota) from "search unconfigured"
// (no API key) so the UI can render the right ERROR_REGISTRY sentence.
export function isPexelsConfigured() {
  return !!resolveEnv('PEXELS_API_KEY');
}
```

- [ ] **Step 4: Write the endpoint**

Create `src/routes/api/trip/[slug]/image/search/+server.js`:

```js
import { json } from '@sveltejs/kit';
import { fetchImage, isPexelsConfigured } from '$lib/server/data.js';

export async function GET({ url }) {
  const q = url.searchParams.get('q')?.trim();
  if (!q) return new Response('Missing q parameter', { status: 400 });

  if (!isPexelsConfigured()) {
    return json({ code: 'image_search_unconfigured' }, { status: 503 });
  }

  const image = await fetchImage(q);
  return json({ photos: image?.photos ?? [] });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/api-trip-image.test.js`
Expected: PASS — first four cases green (POST tests come in Task 6).

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/data.js src/routes/api/trip/[slug]/image/search/+server.js tests/api-trip-image.test.js
git commit -m "feat(images): GET /api/trip/[slug]/image/search endpoint"
```

---

### Task 6: POST `/api/trip/[slug]/image` endpoint + tests

Writes `image_query` and/or `image_pick` to frontmatter via `updateImageMeta`. Maps validation errors to 400, missing trip to 404, file write failures to 500 with `image_save_failed`.

**Files:**
- Create: `src/routes/api/trip/[slug]/image/+server.js`
- Test: `tests/api-trip-image.test.js` (extend)

- [ ] **Step 1: Extend the test file**

Append to `tests/api-trip-image.test.js`:

```js
describe('POST /api/trip/[slug]/image', () => {
  it('writes image_query when provided', async () => {
    const updateImageMeta = vi.fn().mockReturnValue({ ok: true });
    vi.doMock('$lib/server/data.js', () => ({ updateImageMeta }));
    const { POST } = await import('../src/routes/api/trip/[slug]/image/+server.js');
    const res = await POST({
      params: { slug: 'demo' },
      request: new Request('http://x', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ image_query: 'mountains' }),
      }),
    });
    expect(res.status).toBe(200);
    expect(updateImageMeta).toHaveBeenCalledWith('demo', { image_query: 'mountains' });
  });

  it('writes image_pick when provided', async () => {
    const updateImageMeta = vi.fn().mockReturnValue({ ok: true });
    vi.doMock('$lib/server/data.js', () => ({ updateImageMeta }));
    const { POST } = await import('../src/routes/api/trip/[slug]/image/+server.js');
    const res = await POST({
      params: { slug: 'demo' },
      request: new Request('http://x', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ image_pick: 2 }),
      }),
    });
    expect(res.status).toBe(200);
    expect(updateImageMeta).toHaveBeenCalledWith('demo', { image_pick: 2 });
  });

  it('returns 404 when the trip is not found', async () => {
    vi.doMock('$lib/server/data.js', () => ({
      updateImageMeta: vi.fn().mockReturnValue(null),
    }));
    const { POST } = await import('../src/routes/api/trip/[slug]/image/+server.js');
    const res = await POST({
      params: { slug: 'missing' },
      request: new Request('http://x', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ image_query: 'x' }),
      }),
    });
    expect(res.status).toBe(404);
  });

  it('returns 400 when updateImageMeta throws TypeError (invalid input)', async () => {
    vi.doMock('$lib/server/data.js', () => ({
      updateImageMeta: vi.fn(() => { throw new TypeError('image_pick must be an integer 0, 1, or 2'); }),
    }));
    const { POST } = await import('../src/routes/api/trip/[slug]/image/+server.js');
    const res = await POST({
      params: { slug: 'demo' },
      request: new Request('http://x', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ image_pick: 7 }),
      }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 500 image_save_failed on unexpected errors', async () => {
    vi.doMock('$lib/server/data.js', () => ({
      updateImageMeta: vi.fn(() => { throw new Error('disk full'); }),
    }));
    const { POST } = await import('../src/routes/api/trip/[slug]/image/+server.js');
    const res = await POST({
      params: { slug: 'demo' },
      request: new Request('http://x', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ image_query: 'x' }),
      }),
    });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe('image_save_failed');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api-trip-image.test.js`
Expected: FAIL — POST endpoint module does not exist.

- [ ] **Step 3: Write the endpoint**

Create `src/routes/api/trip/[slug]/image/+server.js`:

```js
import { json } from '@sveltejs/kit';
import { updateImageMeta } from '$lib/server/data.js';

export async function POST({ params, request }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const patch = {};
  if ('image_query' in body) patch.image_query = body.image_query;
  if ('image_pick'  in body) patch.image_pick  = body.image_pick;
  if (Object.keys(patch).length === 0) {
    return new Response('No fields to update', { status: 400 });
  }

  try {
    const result = updateImageMeta(params.slug, patch);
    if (!result) return new Response('Not found', { status: 404 });
    return json(result);
  } catch (err) {
    if (err instanceof TypeError) {
      return json({ code: 'invalid_input', reason: err.message }, { status: 400 });
    }
    console.error('updateImageMeta failed:', err);
    return json({ code: 'image_save_failed' }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/api-trip-image.test.js`
Expected: PASS — all 9 cases green (4 from Task 5 + 5 new).

- [ ] **Step 5: Commit**

```bash
git add src/routes/api/trip/[slug]/image/+server.js tests/api-trip-image.test.js
git commit -m "feat(images): POST /api/trip/[slug]/image endpoint"
```

---

### Task 7: Build `CoverPhotoModal.svelte`

A self-contained modal: editable query input, Re-search button, three thumbnail tiles, Save / Cancel. Mirrors `ConfirmModal`'s focus management, Escape-to-close, and focus-trap behavior. Uses CSS custom-property tokens — no raw color literals.

**Files:**
- Create: `src/lib/components/CoverPhotoModal.svelte`

- [ ] **Step 1: Create the component**

Create `src/lib/components/CoverPhotoModal.svelte`:

```svelte
<script>
  import { failureSentence } from '$lib/errors-registry.js';

  let {
    open = $bindable(false),
    trip,
    onclose,
    onsaved,
  } = $props();

  let query     = $state('');
  let photos    = $state([]);
  let pick      = $state(0);
  let busy      = $state(false);
  let saving    = $state(false);
  let errorCode = $state(null);
  let initialQuery = $state('');
  let cancelBtn = $state(null);
  let saveBtn   = $state(null);
  let previousFocus = null;

  // Seed local state when the modal opens.
  $effect(() => {
    if (!open || !trip) return;
    initialQuery = trip.image_query || trip.title || trip.destination || '';
    query  = initialQuery;
    photos = trip._image?.photos ?? (trip._image ? [trip._image] : []);
    pick   = 0; // the live `_image.photos` is already in picked-first order
    busy   = false;
    errorCode = null;
    previousFocus = document.activeElement;
    queueMicrotask(() => saveBtn?.focus());
  });

  $effect(() => {
    if (!open && previousFocus) { previousFocus.focus(); previousFocus = null; }
  });

  const queryDirty = $derived(query.trim() !== initialQuery.trim());
  const canSearch  = $derived(!!query.trim() && !busy);
  const canSave    = $derived(!saving && photos.length > 0);

  async function search() {
    if (!canSearch) return;
    busy = true;
    errorCode = null;
    try {
      const url = `/api/trip/${encodeURIComponent(trip._slug)}/image/search?q=${encodeURIComponent(query.trim())}`;
      const res = await fetch(url);
      if (res.status === 503) { errorCode = 'image_search_unconfigured'; return; }
      if (!res.ok) { errorCode = 'image_search_failed'; return; }
      const data = await res.json();
      if (!data.photos?.length) { errorCode = 'image_search_failed'; photos = []; pick = 0; return; }
      photos = data.photos;
      pick = 0;
    } catch {
      errorCode = 'image_search_failed';
    } finally {
      busy = false;
    }
  }

  async function save() {
    if (!canSave) return;
    saving = true;
    errorCode = null;
    const patch = {};
    if (queryDirty) patch.image_query = query.trim();
    patch.image_pick = pick;
    try {
      const res = await fetch(`/api/trip/${encodeURIComponent(trip._slug)}/image`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) { errorCode = 'image_save_failed'; return; }
      open = false;
      onsaved?.();
    } catch {
      errorCode = 'image_save_failed';
    } finally {
      saving = false;
    }
  }

  function cancel() {
    open = false;
    onclose?.();
  }

  function handleKey(e) {
    if (!open) return;
    if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  }
</script>

<svelte:window onkeydown={handleKey} />

{#if open}
  <div class="backdrop" onclick={cancel} role="presentation"></div>

  <div class="modal" role="dialog" aria-modal="true" aria-labelledby="cover-title">
    <div class="modal-body">
      <h2 id="cover-title" class="modal-title">Change cover photo</h2>

      <label class="field-label" for="cover-query">Pexels search</label>
      <div class="query-row">
        <input
          id="cover-query"
          type="text"
          bind:value={query}
          placeholder="e.g. Glacier mountains"
          disabled={busy || saving}
        />
        <button
          class="btn btn-secondary btn-compact"
          onclick={search}
          disabled={!canSearch || !queryDirty}
          title={queryDirty ? 'Search Pexels with this query' : 'Edit the query to re-search'}
        >
          {busy ? 'Searching…' : 'Re-search'}
        </button>
      </div>

      <div class="tiles" role="radiogroup" aria-label="Pick a cover photo">
        {#each photos as photo, i (photo.medium)}
          <button
            class="tile"
            class:active={i === pick}
            role="radio"
            aria-checked={i === pick}
            onclick={() => (pick = i)}
            disabled={saving}
          >
            <img src={photo.medium} alt="" loading="lazy" />
            {#if i === pick}<span class="tile-check" aria-hidden="true">✓</span>{/if}
          </button>
        {/each}
        {#if photos.length === 0 && !busy}
          <div class="tiles-empty">No photos to pick from yet.</div>
        {/if}
      </div>

      {#if photos[pick]?.photographer}
        <p class="credit">
          Photo by
          {#if photos[pick].photographer_url}
            <a href={photos[pick].photographer_url} target="_blank" rel="noopener">{photos[pick].photographer}</a>
          {:else}
            {photos[pick].photographer}
          {/if}
          / Pexels
        </p>
      {/if}

      {#if errorCode}
        <p class="error" role="alert">{failureSentence(errorCode)}</p>
      {/if}
    </div>

    <div class="modal-actions">
      <button class="btn btn-tertiary" bind:this={cancelBtn} onclick={cancel} disabled={saving}>Cancel</button>
      <button class="btn btn-primary" bind:this={saveBtn} onclick={save} disabled={!canSave}>
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed; inset: 0;
    background: rgba(0, 0, 0, 0.45);
    z-index: 998;
  }
  .modal {
    position: fixed;
    top: 50%; left: 50%;
    transform: translate(-50%, -50%);
    width: min(480px, calc(100vw - 2rem));
    background: var(--surface-overlay);
    color: var(--text-primary);
    border-radius: 10px;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.35);
    z-index: 999;
    overflow: hidden;
    font-family: var(--font-sans);
  }
  .modal-body { padding: 1.4rem 1.4rem 0.9rem; }
  .modal-title {
    font-family: var(--font-serif);
    font-size: 1.1rem;
    font-weight: 500;
    margin: 0 0 0.9rem;
    color: var(--text-primary);
  }
  .field-label {
    display: block;
    font-size: 0.78rem;
    color: var(--text-secondary);
    margin-bottom: 0.3rem;
  }
  .query-row {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 0.9rem;
  }
  .query-row input {
    flex: 1;
    padding: 0.4rem 0.55rem;
    border: 1px solid var(--border-subtle);
    border-radius: 6px;
    background: var(--surface-input);
    color: var(--text-primary);
    font: inherit;
  }
  .tiles {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.5rem;
    margin-bottom: 0.45rem;
  }
  .tile {
    position: relative;
    padding: 0;
    border: 2px solid transparent;
    border-radius: 6px;
    overflow: hidden;
    background: var(--surface-input);
    cursor: pointer;
    aspect-ratio: 4 / 3;
  }
  .tile img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .tile.active { border-color: var(--accent); }
  .tile-check {
    position: absolute;
    top: 4px; right: 4px;
    width: 18px; height: 18px;
    border-radius: 50%;
    background: var(--accent);
    color: var(--surface-overlay);
    font-size: 12px;
    display: grid; place-items: center;
  }
  .tiles-empty {
    grid-column: 1 / -1;
    padding: 1.2rem 0;
    text-align: center;
    color: var(--text-secondary);
    font-size: 0.85rem;
  }
  .credit {
    font-size: 0.74rem;
    color: var(--text-secondary);
    margin: 0;
  }
  .credit a { color: inherit; text-decoration: underline; }
  .error {
    margin: 0.6rem 0 0;
    color: var(--state-danger);
    font-size: 0.85rem;
  }
  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.6rem;
    padding: 0.75rem 1.4rem 1.1rem;
  }
</style>
```

- [ ] **Step 2: Verify the component compiles via the build**

Run: `npm run check`
Expected: PASS — no svelte-check errors, no missing-token warnings. (If any token reference (`--surface-input`, `--accent`, `--border-subtle`, `--state-danger`, `--surface-overlay`) isn't defined in `src/app.css`, substitute with an existing token before continuing. Run `grep -n "^[[:space:]]*--" src/app.css` to see what's defined.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/components/CoverPhotoModal.svelte
git commit -m "feat(images): CoverPhotoModal component"
```

---

### Task 8: Wire the modal into the detail page

Add the `🖼 Change cover photo…` item to the `Output` group in the `⋯` menu, host the modal, and call `invalidateAll()` after save.

**Files:**
- Modify: `src/routes/trips/[slug]/+page.svelte`

- [ ] **Step 1: Add the import (after line 21)**

```svelte
  import CoverPhotoModal from '$lib/components/CoverPhotoModal.svelte';
```

- [ ] **Step 2: Add modal state (in the `// ── Share ──` neighborhood, around line 459)**

```js
  // ── Cover photo ──
  let coverPhotoOpen = $state(false);
```

- [ ] **Step 3: Insert the menu item**

In `kebabGroups` (around line 614), insert as the *second* item in `outputItems`, immediately after the brochure link:

```js
    outputItems.push({
      type: 'button',
      label: '🖼 Change cover photo…',
      onclick: () => { coverPhotoOpen = true; },
    });
```

The `outputItems` array should look like this after the edit:

```js
    const outputItems = [
      {
        type: 'link',
        label: '↗ View full brochure',
        href: brochureHref,
        target: '_blank',
        rel: 'noopener',
      },
    ];

    outputItems.push({
      type: 'button',
      label: '🖼 Change cover photo…',
      onclick: () => { coverPhotoOpen = true; },
    });

    if (data.features?.share) {
      // ... existing share branches
    }
```

- [ ] **Step 4: Mount the modal**

Find where `<RetroModal>` is rendered in the template (search for `RetroModal`) and add a sibling immediately after it:

```svelte
<CoverPhotoModal
  bind:open={coverPhotoOpen}
  trip={trip}
  onsaved={() => invalidateAll()}
/>
```

- [ ] **Step 5: Smoke-test in the browser**

Run: `npm run dev -- --port 3456`

In a browser:
1. Open any trip's detail page.
2. Click `⋯` → `🖼 Change cover photo…` — modal opens with current photo highlighted.
3. Click a different tile → click Save → confirm the hero photo on the detail page updates (page invalidates).
4. Open the modal again, change the query, click Re-search → confirm three new photos appear and the first is auto-selected.
5. Re-open and confirm previously-saved selection is the highlighted tile (i.e. the live `_image.photos` are already in picked-first order).
6. With `PEXELS_API_KEY` unset (temporarily comment in `.env`), click Re-search → confirm the inline error reads "Image search is not configured…" not a generic alert.
7. Reload home page → confirm the same trip's card thumbnail shows the new cover.
8. Open the trip's `/brochure` page → confirm the cover photo updated and the atmosphere photos do not duplicate the cover.

- [ ] **Step 6: Run the full verify gate**

Run: `npm run verify`
Expected: PASS — svelte-check, tests, build all green.

- [ ] **Step 7: Commit**

```bash
git add src/routes/trips/[slug]/+page.svelte
git commit -m "feat(images): cover-photo modal entry in detail-page kebab menu"
```

---

### Task 9: Final verification + push

- [ ] **Step 1: Re-run verify on a clean tree**

Run: `npm run verify`
Expected: PASS.

- [ ] **Step 2: Sanity-check the git log**

Run: `git log --oneline main..HEAD`
Expected: 7 focused commits (one per Task 1–8, except Task 4 + Task 7 are single-commit each).

- [ ] **Step 3: Push and open a PR (only if the user has asked you to)**

If the user has said to ship: push the branch and open a PR referencing issue #193 with the test plan from the spec's Testing section.

```bash
gh pr create --title "Cover photo override (#193)" --body "$(cat <<'EOF'
## Summary
- Adds a Change cover photo modal in the detail-page ⋯ menu.
- Lets the user edit the Pexels search query and pick from the three candidate results.
- Persists choice as image_query + image_pick frontmatter; honored by enrichTrips so card, detail, and brochure all reflect the pick.

Closes #193.

## Test plan
- [ ] Open ⋯ menu on idea / planning / completed trips — Change cover photo… appears.
- [ ] Pick a different tile → Save → hero updates on detail page.
- [ ] Edit query → Re-search → tiles refresh.
- [ ] Re-open modal after save → previously-picked tile is highlighted.
- [ ] Brochure atmosphere photos do not duplicate the new cover.
- [ ] PEXELS_API_KEY unset → inline error "Image search is not configured…".

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review notes

- **Spec coverage**: UX (Task 7–8), persistence (Task 3), reading side (Task 1–2), endpoints (Task 5–6), error codes (Task 4), out-of-scope items explicitly skipped. ✓
- **Type consistency**: `applyImagePick(image, pick)`, `updateImageMeta(slug, { image_query, image_pick })`, endpoint paths, error codes all match across tasks. ✓
- **No placeholders**: every step has code or a literal command. ✓
- **TDD**: every code-emitting task starts with a failing test except the Svelte component (no headless render harness in this repo — verified via `npm run check` + manual browser smoke per CLAUDE.md). ✓

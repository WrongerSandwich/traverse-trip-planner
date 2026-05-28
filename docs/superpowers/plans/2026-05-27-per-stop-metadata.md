# Per-stop metadata implementation plan (#403)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four optional fields (`address`, `hours`, `website`, `phone`) to every stop candidate, sourced via the extended geocode-candidates job (address as Nominatim byproduct) and a new `enrich-candidates` follow-on job (hours/website/phone via per-stop web search). Render the new data across the Candidates section, Plan day-cards, and brochure. Add a manual `Refresh metadata` button.

**Architecture:** Three layers of change. **Data:** four new optional fields on stop entries in `candidates.yaml`, flat at the top level. **Sourcing:** extend `geocode-candidates` to capture `address` from the Nominatim response it already makes (no extra HTTP); add a new `enrich-candidates` job that calls `chat()` + `search()` once per candidate to fill the remaining three fields. **UI:** a meta row on `StopCard.svelte` rendered in both Candidates and Plan-day modes, two new guarded slots on the existing brochure stop blocks, and a section-header refresh button with a kebab "Re-fetch all" override.

**Tech Stack:** SvelteKit, Node 20+, YAML for candidates persistence (`yaml` lib), Vitest for tests, Nominatim for geocoding, `chat()`/`search()` for AI search per-stop. Atomic file writes via the existing `atomicWrite()` helper.

---

## Spec reference

This plan implements [`docs/superpowers/specs/2026-05-27-per-stop-metadata-design.md`](../specs/2026-05-27-per-stop-metadata-design.md). When in doubt, the spec wins.

## File structure

**New files:**

| Path | Responsibility |
|---|---|
| `src/lib/server/enrich-job.js` | Per-stop `chat()`+search loop. Mirrors `geocode-job.js` shape. Exports `enrichCandidatesJob(slug, opts)`. |
| `src/routes/api/actions/enrich-candidates/[slug]/+server.js` | POST starts the job (with `{ force?: boolean }`), DELETE cancels. Mirrors `geocode-candidates/+server.js`. Exports `_startEnrichCandidatesJob` for the geocode-job's auto-trigger. |
| `src/lib/utils/links.js` | URL constructors for `tel:` / Google Maps / website new-tab. Pure functions. |
| `tests/enrich-job.test.js` | Loop behavior: skip when complete, force-mode, hidden, abort, per-stop failure tolerance. |
| `tests/links.test.js` | URL builders, edge cases (empty input, special characters). |

**Modified files:**

| Path | Why |
|---|---|
| `src/lib/server/candidates.js` | `addCandidateStop()` doesn't write any of the four new fields by default (they remain absent). No code change needed in `addCandidateStop` itself — but new fields must round-trip through `parseCandidatesFile` / `serializeCandidatesFile` (they will, as `yaml` is shape-agnostic). Tests confirm this. |
| `src/lib/server/realize-plan.js` | The per-stop object in lines 84–96 needs to pass through `address`/`hours`/`website`/`phone` from the LLM YAML when present. |
| `src/lib/server/data.js` | Add `reverseGeocode(coords)` that hits Nominatim's reverse endpoint with `addressdetails=1`, returns a formatted address string. New cache slice (`addr`) in `.caches.json`. One-shot migration of `combined.addr` on load. |
| `src/lib/server/geocode-job.js` | After successful `geocodeCandidate`, call `reverseGeocode(coords)` and write `address` to the candidate. Auto-trigger `_startEnrichCandidatesJob(slug)` after `completeJob` fires. |
| `src/lib/server/promises.js` | Add `'enrich-candidates'` entries to `MAX_TOKENS` and `HAND_DEFAULTS`. |
| `src/lib/errors-registry.js` | Add `enrich_all_failed` code. |
| `src/lib/utils/jobLabels.js` | Add `'enrich-candidates': 'Enriching candidates…'` to `WORKFLOW_LABELS`. |
| `src/lib/components/BackgroundJobsIndicator.svelte` | Add `'enrich-candidates': 'Enrich'` to the local `WORKFLOW_LABELS` map and `90` to the duration map. |
| `src/lib/server/derive-brochure.js` | Pass `address`, `hours`, `website`, `phone` through the candidate projection. |
| `src/lib/components/Brochure.svelte` | Add `{#if stop.website}` and `{#if stop.phone}` guarded blocks alongside the existing hours/address slots (twice — promoted-days path and flat-list fallback). Add CSS rules for `.stop-website` / `.stop-phone`. |
| `src/lib/components/StopCard.svelte` | Add a meta row below the summary in non-compact mode; add a vertical metadata stack in compact mode. New `Maps` / website / phone link rendering via `src/lib/utils/links.js`. |
| `src/lib/components/CandidatesSection.svelte` | Add `Refresh metadata` button + kebab menu with `Re-fetch all` in the section header (Stops tab only). |
| `src/routes/api/actions/find-more/[slug]/+server.js` | Update `geocodeCandidate` destructure — return shape stays unchanged (we keep it as coords-only). No-op unless we end up changing the return shape; per current plan we do NOT change it. |
| `src/routes/api/actions/add-candidate/[slug]/+server.js` | Same as above — no-op under current plan. |
| `src/routes/api/actions/deepen/[slug]/+server.js` | Extend the `<candidates>` prompt envelope with optional `hours`/`website`/`phone` fields the LLM may emit. Add `import { _startEnrichCandidatesJob }` if the deepen handler needs to know about it (it doesn't directly; the chain comes via geocode-job's auto-trigger). |
| `docs/superpowers/specs/2026-05-22-planning-plan-and-candidates-design.md` | Document the four new optional fields in the candidate schema section. |
| `CHANGELOG.md` | v0.1.2 entry noting per-stop metadata + Refresh metadata token cost. |
| `tests/realize-plan.test.js` | Round-trip new fields through realizePlan. |
| `tests/candidates-io.test.js` | Round-trip new fields through readCandidates/writeCandidates. |
| `tests/derive-brochure.test.js` | New fields project to brochure shape. |

---

## Phase 1 — Schema layer

### Task 1: Candidates I/O round-trips the four new optional fields

**Files:**
- Modify: `src/lib/server/candidates.js` (no functional change expected; verify YAML lib preserves unknown top-level keys)
- Test: `tests/candidates-io.test.js` (extend)

- [ ] **Step 1: Find an existing read/write round-trip test to anchor next to**

Run:
```bash
grep -n "writeCandidates\|readCandidates\|round-trip" tests/candidates-io.test.js | head -20
```

Read the file to understand the test setup conventions (likely `withTmpDir` or similar fixture).

- [ ] **Step 2: Write the failing test (round-trip new fields)**

Append to `tests/candidates-io.test.js`:

```js
test('round-trips address, hours, website, phone on stop candidates', async () => {
  await withTmpDir(async (root) => {
    const slug = 'meta-fields-rt';
    await mkdir(join(root, 'data', 'planning', slug), { recursive: true });
    await writeFile(join(root, 'data', 'planning', slug, 'overview.md'), '---\ntitle: Test\nstatus: planning\ndestination: Empire MI\n---\n');

    writeCandidates(slug, {
      stops: [{
        id: 'sleeping-bear',
        name: 'Sleeping Bear Dunes',
        category: 'outdoors',
        description: 'Sand dunes on Lake Michigan.',
        why_recommended: 'Park-leaning vibe',
        source_url: 'https://www.nps.gov/slbe/',
        coords: { lat: 44.88, lng: -86.05 },
        address: '9922 Front St, Empire, MI 49630',
        hours: 'Visitor Center 9am-4pm daily; park 24/7',
        website: 'https://www.nps.gov/slbe',
        phone: '(231) 326-4700',
        user_added: false,
      }],
      lodging: [],
    });

    const round = readCandidates(slug);
    expect(round.stops[0].address).toBe('9922 Front St, Empire, MI 49630');
    expect(round.stops[0].hours).toBe('Visitor Center 9am-4pm daily; park 24/7');
    expect(round.stops[0].website).toBe('https://www.nps.gov/slbe');
    expect(round.stops[0].phone).toBe('(231) 326-4700');
  });
});

test('omitted metadata fields stay undefined after round-trip', async () => {
  await withTmpDir(async (root) => {
    const slug = 'meta-fields-omit';
    await mkdir(join(root, 'data', 'planning', slug), { recursive: true });
    await writeFile(join(root, 'data', 'planning', slug, 'overview.md'), '---\ntitle: Test\nstatus: planning\ndestination: Anywhere\n---\n');

    writeCandidates(slug, {
      stops: [{
        id: 'x',
        name: 'Plain Stop',
        category: 'misc',
        description: '',
        user_added: false,
      }],
      lodging: [],
    });

    const round = readCandidates(slug);
    expect(round.stops[0].address).toBeUndefined();
    expect(round.stops[0].hours).toBeUndefined();
    expect(round.stops[0].website).toBeUndefined();
    expect(round.stops[0].phone).toBeUndefined();
  });
});
```

Match the existing import / `withTmpDir` / `expect` style of the surrounding tests. If the file uses a different fixture helper (`useTmpData`, etc.), use that instead.

- [ ] **Step 3: Run the new tests — expect them to PASS already**

```bash
npx vitest run tests/candidates-io.test.js
```

Expected: PASS. The `yaml` library passes through unknown fields transparently. No code change needed in `candidates.js`. If a test fails, debug and fix `serializeCandidatesFile` / `parseCandidatesFile` — likely something is stripping the new fields.

- [ ] **Step 4: Commit**

```bash
git add tests/candidates-io.test.js
git commit -m "test(candidates): round-trip address/hours/website/phone fields (#403)"
```

---

### Task 2: realize-plan passes through new fields from LLM YAML

**Files:**
- Modify: `src/lib/server/realize-plan.js` (lines 84–96)
- Test: `tests/realize-plan.test.js` (extend)

- [ ] **Step 1: Find the existing stop-candidate construction test**

Run:
```bash
grep -n "cands.stops.push\|raw.name" tests/realize-plan.test.js src/lib/server/realize-plan.js | head -10
```

Read enough of `tests/realize-plan.test.js` to understand how it currently feeds a parsed YAML into `realizePlan` and asserts the resulting `candidates.yaml`.

- [ ] **Step 2: Write the failing test**

Append to `tests/realize-plan.test.js` (adapt to existing test harness — likely a function that builds parsed data and calls `realizePlan(slug, { planData, candData })`):

```js
test('realizePlan passes hours/address/website/phone from LLM YAML to stops', async () => {
  await withTmpDir(async (root) => {
    const slug = 'meta-rt';
    await seedMinimalPlanningTrip(root, slug);  // existing helper or inline

    const candData = {
      stops: [{
        name: 'Lemon Bakery',
        category: 'food',
        description: 'Local bakery downtown.',
        why_recommended: 'Loved by passers-by.',
        source_url: 'https://example.com',
        hours: 'Mon-Sat 7am-3pm; closed Sundays',
        address: '123 Main St, Empire, MI',
        website: 'https://lemon.example.com',
        phone: '(231) 555-0100',
      }],
      lodging: [],
    };

    await realizePlan(slug, {
      planData: { field_guide_notes: [], gotchas: [] },
      candData,
    });

    const cands = readCandidates(slug);
    const stop = cands.stops[0];
    expect(stop.hours).toBe('Mon-Sat 7am-3pm; closed Sundays');
    expect(stop.address).toBe('123 Main St, Empire, MI');
    expect(stop.website).toBe('https://lemon.example.com');
    expect(stop.phone).toBe('(231) 555-0100');
  });
});

test('realizePlan does not add empty-string metadata fields when LLM omits them', async () => {
  await withTmpDir(async (root) => {
    const slug = 'meta-rt-empty';
    await seedMinimalPlanningTrip(root, slug);

    const candData = {
      stops: [{
        name: 'Plain Stop',
        category: 'misc',
        description: '',
      }],
      lodging: [],
    };

    await realizePlan(slug, {
      planData: { field_guide_notes: [], gotchas: [] },
      candData,
    });

    const cands = readCandidates(slug);
    expect(cands.stops[0].hours).toBeUndefined();
    expect(cands.stops[0].address).toBeUndefined();
    expect(cands.stops[0].website).toBeUndefined();
    expect(cands.stops[0].phone).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run tests — expect FAIL on the first test**

```bash
npx vitest run tests/realize-plan.test.js -t "passes hours/address"
```

Expected: FAIL. `stop.hours` is undefined because the current code at `realize-plan.js:84-96` doesn't pass it through.

- [ ] **Step 4: Implement — extend the stop object construction**

Edit `src/lib/server/realize-plan.js` lines 84–96 (the `for (const raw of candData.stops ?? [])` loop). Replace the `cands.stops.push({...})` block with:

```js
    cands.stops.push({
      id,
      name: raw.name,
      category: STOP_CATEGORIES.includes(raw.category) ? raw.category : 'misc',
      description: raw.description ?? '',
      why_recommended: raw.why_recommended ?? '',
      source_url: raw.source_url ?? '',
      ...(typeof raw.address === 'string' && raw.address.trim() ? { address: raw.address.trim() } : {}),
      ...(typeof raw.hours === 'string' && raw.hours.trim() ? { hours: raw.hours.trim() } : {}),
      ...(typeof raw.website === 'string' && raw.website.trim() ? { website: raw.website.trim() } : {}),
      ...(typeof raw.phone === 'string' && raw.phone.trim() ? { phone: raw.phone.trim() } : {}),
      user_added: false,
    });
```

This conditionally spreads each field only when the LLM emitted a non-empty trimmed string, so omitted fields stay `undefined` (matching the existing pattern for `source_url`). Use `??` for the existing string fields that should default to empty.

- [ ] **Step 5: Run tests — expect PASS**

```bash
npx vitest run tests/realize-plan.test.js -t "metadata fields"
```

Expected: both new tests PASS. Run the full file to confirm nothing else broke:

```bash
npx vitest run tests/realize-plan.test.js
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/realize-plan.js tests/realize-plan.test.js
git commit -m "feat(realize-plan): pass hours/address/website/phone through from LLM YAML (#403)"
```

---

## Phase 2 — Address capture via Nominatim reverse geocoding

We add a new `reverseGeocode(coords)` function in `data.js` rather than modifying `geocode()` directly. Reason: the cache shape for the forward geocoder is currently `coords[]`; changing it to `{ coords, address }` would require a migration AND touch every existing caller. A separate reverse-geocode path is one Nominatim HTTP per candidate (≈1s throttled), keeps the existing cache untouched, and isolates the change. (See `docs/superpowers/specs/2026-05-27-per-stop-metadata-design.md` for the design rationale.)

### Task 3: Add `reverseGeocode()` to data.js with its own cache slice

**Files:**
- Modify: `src/lib/server/data.js`
- Test: `tests/data-geocode.test.js` (extend if exists, else create alongside)

- [ ] **Step 1: Find existing geocode tests to anchor next to**

```bash
grep -rn "describe.*geocode\|test.*geocode" tests/ | head -10
```

If a `tests/data-geocode.test.js` exists, extend it; otherwise create `tests/reverse-geocode.test.js` next to similar fixtures.

- [ ] **Step 2: Write the failing test**

```js
import { describe, test, expect, vi, beforeEach } from 'vitest';

describe('reverseGeocode', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  test('returns formatted address from Nominatim reverse response', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        display_name: 'Sleeping Bear Dunes National Lakeshore, Empire Township, Leelanau County, Michigan, 49630, United States',
        address: {
          tourism: 'Sleeping Bear Dunes National Lakeshore',
          road: 'Front Street',
          house_number: '9922',
          city: 'Empire',
          state: 'Michigan',
          postcode: '49630',
        },
      }),
    }));

    const { reverseGeocode } = await import('../src/lib/server/data.js');
    const address = await reverseGeocode([44.88, -86.05]);

    // Cleaned format: "<house_number> <road>, <city>, <state> <postcode>"
    expect(address).toBe('9922 Front Street, Empire, Michigan 49630');
  });

  test('falls back to display_name when structured fields are sparse', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        display_name: 'Some Trailhead, Wilderness Area, Montana',
        address: { country: 'United States' },
      }),
    }));

    const { reverseGeocode } = await import('../src/lib/server/data.js');
    const address = await reverseGeocode([45.0, -110.0]);
    expect(address).toBe('Some Trailhead, Wilderness Area, Montana');
  });

  test('returns null on HTTP error', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    const { reverseGeocode } = await import('../src/lib/server/data.js');
    expect(await reverseGeocode([44.88, -86.05])).toBeNull();
  });

  test('hits cache on second call for same coords', async () => {
    const f = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        display_name: 'X, Y, Z',
        address: { road: 'Main', city: 'Springfield', state: 'IL', postcode: '12345' },
      }),
    }));
    global.fetch = f;

    const { reverseGeocode } = await import('../src/lib/server/data.js');
    await reverseGeocode([41.5, -89.5]);
    await reverseGeocode([41.5, -89.5]);
    expect(f).toHaveBeenCalledTimes(1);
  });

  test('returns null when coords are not a 2-element array', async () => {
    const { reverseGeocode } = await import('../src/lib/server/data.js');
    expect(await reverseGeocode(null)).toBeNull();
    expect(await reverseGeocode([])).toBeNull();
    expect(await reverseGeocode([44.88])).toBeNull();
  });
});
```

- [ ] **Step 3: Run tests — expect FAIL (function doesn't exist yet)**

```bash
npx vitest run tests/reverse-geocode.test.js
```

Expected: FAIL with "reverseGeocode is not a function" or similar import error.

- [ ] **Step 4: Implement `reverseGeocode` in data.js**

In `src/lib/server/data.js`, alongside the existing `geocode()` function (around line 297), add:

```js
// ── Reverse geocode (address from coords) ──
//
// Hits Nominatim's reverse endpoint with `addressdetails=1` to retrieve the
// structured address block for a known lat/lng. Cached separately from the
// forward `geocodeCache` slice (`addr`), keyed by "lat,lng" rounded to 5
// decimal places so co-located lookups share the cache entry.
//
// Used by the geocode-candidates background job to fill `address` on each
// stop candidate as a follow-on to coord capture. See per-stop-metadata
// design doc (#403).

const REVERSE_GEOCODE_THROTTLE_MS = 1100;

/** Build the cleaned address string used by the brochure / cards. */
export function formatStructuredAddress(addr, fallbackDisplayName) {
  if (!addr || typeof addr !== 'object') return fallbackDisplayName || null;
  const street = [addr.house_number, addr.road].filter(Boolean).join(' ');
  const city = addr.city || addr.town || addr.village || addr.hamlet || '';
  const state = addr.state || addr.region || '';
  const postcode = addr.postcode || '';
  const haveStructured = !!(street && (city || state));
  if (!haveStructured) return fallbackDisplayName || null;
  const parts = [];
  if (street) parts.push(street);
  if (city) parts.push(city);
  const stateLine = [state, postcode].filter(Boolean).join(' ').trim();
  if (stateLine) parts.push(stateLine);
  return parts.join(', ');
}

function reverseGeocodeKey(coords) {
  if (!Array.isArray(coords) || coords.length !== 2) return null;
  const [lat, lng] = coords;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return `${lat.toFixed(5)},${lng.toFixed(5)}`;
}

/**
 * Look up a human-readable address for a known coord pair.
 *
 * Returns the cleaned single-line address string, or `null` when the lookup
 * fails (HTTP error, rate-limit, empty response). Cache hits are free; cache
 * misses incur one Nominatim reverse-geocode HTTP and a 1.1s throttle sleep
 * to stay within the public-Nominatim 1 req/sec ToS.
 */
export async function reverseGeocode(coords) {
  const key = reverseGeocodeKey(coords);
  if (!key) return null;
  if (addressCache[key] !== undefined) return addressCache[key];

  const [lat, lng] = coords;
  const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`;
  let result = null;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'traverse/1.0 (personal)' } });
    if (res.ok) {
      const data = await res.json();
      result = formatStructuredAddress(data?.address, data?.display_name);
    } else {
      console.warn('reverseGeocode HTTP', res.status, 'for', key);
    }
  } catch (e) {
    console.warn('reverseGeocode error for', key, '—', e.message);
  }
  addressCache[key] = result;
  addressDirty = true;
  await sleep(REVERSE_GEOCODE_THROTTLE_MS);
  return result;
}
```

Then add the new cache slice. Near the top of the file where `geocodeCache` is declared (line ~45), add:

```js
let addressCache = {};
let addressDirty = false;
```

And in the function that loads caches from disk (the one that reads `combined.geo`, `combined.image`, `combined.route`), add:

```js
    addressCache = combined.addr  ?? {};
```

And in the function that writes the combined file (line ~73 and ~94 where `JSON.stringify({ geo, image, route }, ...)` is built), update both call sites to also serialize `addr`:

```js
    JSON.stringify({ geo: geocodeCache, image: imageCache, route: routeCache, addr: addressCache }, null, 2),
```

In the function that marks the file dirty for flushing, include `addressDirty` in the flush check and clear it after flush. Mirror the existing `geocodeDirty` pattern exactly — search for `geocodeDirty` in the file and add `addressDirty` everywhere it appears.

- [ ] **Step 5: Run tests — expect PASS**

```bash
npx vitest run tests/reverse-geocode.test.js
```

Expected: all 5 tests PASS. If the cache-hit test fails, double-check that `addressCache[key] !== undefined` short-circuits before the fetch.

- [ ] **Step 6: Run the full test suite to verify no regression**

```bash
npm run verify
```

Expected: PASS. If geocode-related tests break (cache flush behavior, etc.), the `addressDirty` integration in the flush logic isn't quite right — re-read the existing `geocodeDirty` handling and mirror it.

- [ ] **Step 7: Commit**

```bash
git add src/lib/server/data.js tests/reverse-geocode.test.js
git commit -m "feat(data): add reverseGeocode() with disk-backed address cache (#403)"
```

---

### Task 4: geocode-candidates writes `address` after capturing coords

**Files:**
- Modify: `src/lib/server/geocode-job.js`
- Test: `tests/geocode-job.test.js` (extend or create)

- [ ] **Step 1: Find or stub the geocode-job test fixture**

```bash
ls tests/ | grep -i geocode
```

If `tests/geocode-job.test.js` exists, extend it. If not, create one mirroring the style of an existing job test (e.g. similar shape to whatever covers `find-more` or `add-candidate`).

- [ ] **Step 2: Write the failing test**

```js
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { withTmpDir } from './_helpers/tmp-dir.js'; // adjust to actual helper

describe('geocodeCandidatesJob — address capture', () => {
  test('writes address to each candidate after successful geocode', async () => {
    await withTmpDir(async (root) => {
      const slug = 'addr-rt';
      const dir = join(root, 'data', 'planning', slug);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'overview.md'), '---\ntitle: T\nstatus: planning\ndestination: Empire MI\n---\n');
      writeFileSync(join(dir, 'candidates.yaml'),
        'stops:\n  - id: dunes\n    name: Sleeping Bear Dunes\n    category: outdoors\n    user_added: false\nlodging: []\n');

      // Mock both forward + reverse geocode
      global.fetch = vi.fn(async (url) => {
        if (url.includes('/reverse?')) {
          return {
            ok: true, status: 200,
            json: async () => ({
              display_name: 'Sleeping Bear Dunes, Empire, MI',
              address: { road: 'Front Street', city: 'Empire', state: 'Michigan', postcode: '49630' },
            }),
          };
        }
        return {
          ok: true, status: 200,
          json: async () => ([{ lat: '44.88', lon: '-86.05', addresstype: 'tourism' }]),
        };
      });

      const { geocodeCandidatesJob } = await import('../src/lib/server/geocode-job.js');
      const { readCandidates } = await import('../src/lib/server/candidates.js');
      await geocodeCandidatesJob(slug);

      const cands = readCandidates(slug);
      expect(cands.stops[0].coords).toEqual({ lat: 44.88, lng: -86.05 });
      expect(cands.stops[0].address).toBe('Front Street, Empire, Michigan 49630');
    });
  });

  test('does not overwrite an existing user-edited address', async () => {
    await withTmpDir(async (root) => {
      const slug = 'addr-preserve';
      const dir = join(root, 'data', 'planning', slug);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'overview.md'), '---\ntitle: T\nstatus: planning\ndestination: Empire MI\n---\n');
      writeFileSync(join(dir, 'candidates.yaml'),
        'stops:\n  - id: dunes\n    name: Dunes\n    category: outdoors\n    address: "User-edited address"\n    user_added: true\nlodging: []\n');

      global.fetch = vi.fn(async () => ({
        ok: true, status: 200,
        json: async () => ([{ lat: '44.88', lon: '-86.05', addresstype: 'tourism' }]),
      }));

      const { geocodeCandidatesJob } = await import('../src/lib/server/geocode-job.js');
      const { readCandidates } = await import('../src/lib/server/candidates.js');
      await geocodeCandidatesJob(slug);

      const cands = readCandidates(slug);
      expect(cands.stops[0].address).toBe('User-edited address');
    });
  });
});
```

- [ ] **Step 3: Run tests — expect FAIL (address never written)**

```bash
npx vitest run tests/geocode-job.test.js -t "address"
```

Expected: FAIL on the first test (`expected "..." but received undefined`).

- [ ] **Step 4: Implement — extend geocode-job to capture address**

Edit `src/lib/server/geocode-job.js`. Update the import line (line 27–31) to also import `reverseGeocode`:

```js
import { reverseGeocode } from './data.js';
import {
  geocodeCandidate,
  getDestinationRefCoords,
  readCandidates,
  writeCandidates,
} from './candidates.js';
```

Then update the loop body (lines 76–96) to also resolve the address after coords:

```js
  for (const entry of ids) {
    if (signal?.aborted) return;

    const coords = await geocodeCandidate(entry.name, destinationContext, refCoords);
    if (!coords) continue;

    // Re-read so any UI mutations since the prior iteration land in the
    // file we're about to write. If the candidate was deleted or hidden
    // mid-loop, skip the write — we don't want to resurrect a discard.
    const fresh = readCandidates(slug);
    if (!fresh) continue;

    const list = entry.kind === 'stop' ? fresh.stops : fresh.lodging;
    const target = list.find((c) => c.id === entry.id);
    if (!target) continue;
    if (target.hidden) continue;

    let needsWrite = false;
    if (!target.coords) {
      target.coords = { lat: coords[0], lng: coords[1] };
      needsWrite = true;
    }

    // Stop candidates: also resolve a human-readable address as a byproduct
    // of having coords. Skip lodging (the brochure doesn't have an address
    // slot for lodging yet). Skip when the candidate already has an address
    // (user edit, or a prior job run already filled this).
    if (entry.kind === 'stop' && !target.address) {
      const addr = await reverseGeocode(coords);
      if (addr) {
        target.address = addr;
        needsWrite = true;
      }
    }

    if (needsWrite) writeCandidates(slug, fresh);
  }
```

Note: the prior `continue` on `target.coords` is now removed because we may still want to fill an address when coords are already set (e.g. if a previous job run filled coords but not address). The `needsWrite` flag prevents redundant writes.

- [ ] **Step 5: Run tests — expect PASS**

```bash
npx vitest run tests/geocode-job.test.js
```

Expected: address tests PASS, and prior geocode-job tests still PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/geocode-job.js tests/geocode-job.test.js
git commit -m "feat(geocode-job): write address from Nominatim reverse lookup after coords (#403)"
```

---

## Phase 3 — enrich-candidates job

### Task 5: Register `enrich_all_failed` error code

**Files:**
- Modify: `src/lib/errors-registry.js`

- [ ] **Step 1: Add the new code**

In `src/lib/errors-registry.js`, add an entry to `ERROR_REGISTRY` (alphabetical-ish around the other "_failed" codes):

```js
  enrich_all_failed: {
    sentence: 'Couldn\'t enrich any of the candidates — try again, or check the server log if it keeps happening.',
    affordances: ['retry', 'dismiss'],
  },
```

- [ ] **Step 2: Quick verify — file still parses**

```bash
node -e "import('./src/lib/errors-registry.js').then(m => console.log(Object.keys(m.ERROR_REGISTRY).includes('enrich_all_failed')))"
```

Expected: `true`.

- [ ] **Step 3: Commit (rolled into Task 6's commit if you prefer)**

Hold the commit for the next task — these are paired plumbing changes.

---

### Task 6: Register `enrich-candidates` promise + token budget

**Files:**
- Modify: `src/lib/server/promises.js`

- [ ] **Step 1: Add MAX_TOKENS entry**

In `src/lib/server/promises.js`, add to the `MAX_TOKENS` object (after `'find-more': 6000,` for adjacency to similar AI workflows):

```js
  // enrich-candidates: one chat() per candidate; each call is tight (one place
  // name, three fields back). Per-call cap fits the YAML response with margin.
  'enrich-candidates': 1500,
```

- [ ] **Step 2: Add HAND_DEFAULTS entry**

In the same file, add to `HAND_DEFAULTS` (after `'geocode-candidates'`):

```js
  // Enrich-candidates is the second follow-on job after deepen. One chat()
  // with web_search per candidate fills `hours`/`website`/`phone` (address
  // comes from geocode-candidates' reverse lookup). Hand-default reflects a
  // typical 10-candidate trip × ~9s per chat() with caching; telemetry
  // recalibrates via workflow-stats rolling p50 once real runs land.
  'enrich-candidates': {
    verb: 'Enrich candidates',
    produces: "Hours, official website, and phone for each stop candidate. Runs in the background after geocoding completes.",
    time_seconds: 90,
    tokens_range: [3000, 12000],
  },
```

- [ ] **Step 3: Commit (with the error-code change from Task 5)**

```bash
git add src/lib/errors-registry.js src/lib/server/promises.js
git commit -m "feat(workflows): register enrich-candidates promise and error code (#403)"
```

---

### Task 7: Implement `enrich-job.js` — the per-stop loop

**Files:**
- Create: `src/lib/server/enrich-job.js`
- Test: `tests/enrich-job.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/enrich-job.test.js`:

```js
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { withTmpDir } from './_helpers/tmp-dir.js';

// Mock the AI + search layer at module boundary.
vi.mock('../src/lib/server/ai.js', () => ({
  chat: vi.fn(),
}));
vi.mock('../src/lib/server/search.js', () => ({
  search: vi.fn(),
  searchToolDefinition: () => ({ name: 'web_search' }),
}));

import { chat } from '../src/lib/server/ai.js';

const seedTrip = async (root, slug, stopsYaml) => {
  const dir = join(root, 'data', 'planning', slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'overview.md'), '---\ntitle: T\nstatus: planning\ndestination: Empire MI\n---\n');
  writeFileSync(join(dir, 'candidates.yaml'), `stops:\n${stopsYaml}lodging: []\n`);
};

const mockChatReturn = (yaml) => {
  chat.mockResolvedValueOnce({
    text: `<enrich>\n${yaml}\n</enrich>`,
    usage: { input: 100, output: 50 },
  });
};

describe('enrichCandidatesJob', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  test('writes hours/website/phone for each candidate', async () => {
    await withTmpDir(async (root) => {
      const slug = 'enrich-rt';
      await seedTrip(root, slug,
        '  - id: a\n    name: Place A\n    category: misc\n    user_added: false\n');

      mockChatReturn('hours: "9am-5pm"\nwebsite: "https://a.example"\nphone: "(555) 100-2000"');

      const { enrichCandidatesJob } = await import('../src/lib/server/enrich-job.js');
      const { readCandidates } = await import('../src/lib/server/candidates.js');
      const result = await enrichCandidatesJob(slug);

      const cands = readCandidates(slug);
      expect(cands.stops[0].hours).toBe('9am-5pm');
      expect(cands.stops[0].website).toBe('https://a.example');
      expect(cands.stops[0].phone).toBe('(555) 100-2000');
      expect(result).toMatchObject({ enriched: 1, attempted: 1, failed: 0 });
    });
  });

  test('skips candidates that have all three fields when not forced', async () => {
    await withTmpDir(async (root) => {
      const slug = 'enrich-skip';
      await seedTrip(root, slug,
        '  - id: a\n    name: A\n    category: misc\n    hours: "x"\n    website: "https://x"\n    phone: "1"\n    user_added: false\n');

      const { enrichCandidatesJob } = await import('../src/lib/server/enrich-job.js');
      const result = await enrichCandidatesJob(slug);
      expect(chat).not.toHaveBeenCalled();
      expect(result.enriched).toBe(0);
      expect(result.skipped).toBe(1);
    });
  });

  test('force mode re-runs even when all fields set', async () => {
    await withTmpDir(async (root) => {
      const slug = 'enrich-force';
      await seedTrip(root, slug,
        '  - id: a\n    name: A\n    category: misc\n    hours: "old"\n    website: "https://old"\n    phone: "old"\n    user_added: false\n');

      mockChatReturn('hours: "new"\nwebsite: "https://new"\nphone: "new"');

      const { enrichCandidatesJob } = await import('../src/lib/server/enrich-job.js');
      const { readCandidates } = await import('../src/lib/server/candidates.js');
      await enrichCandidatesJob(slug, { force: true });

      const cands = readCandidates(slug);
      expect(cands.stops[0].hours).toBe('new');
    });
  });

  test('skips hidden candidates', async () => {
    await withTmpDir(async (root) => {
      const slug = 'enrich-hidden';
      await seedTrip(root, slug,
        '  - id: a\n    name: A\n    category: misc\n    hidden: true\n    user_added: false\n');

      const { enrichCandidatesJob } = await import('../src/lib/server/enrich-job.js');
      const result = await enrichCandidatesJob(slug);
      expect(chat).not.toHaveBeenCalled();
      expect(result.skipped).toBe(1);
    });
  });

  test('continues past per-stop parse failure', async () => {
    await withTmpDir(async (root) => {
      const slug = 'enrich-partial';
      await seedTrip(root, slug,
        '  - id: a\n    name: A\n    category: misc\n    user_added: false\n' +
        '  - id: b\n    name: B\n    category: misc\n    user_added: false\n');

      chat.mockResolvedValueOnce({ text: 'GARBAGE NO TAGS', usage: { input: 10, output: 5 } });
      chat.mockResolvedValueOnce({
        text: '<enrich>\nhours: "ok"\nwebsite: "https://b.example"\nphone: "555"\n</enrich>',
        usage: { input: 10, output: 5 },
      });

      const { enrichCandidatesJob } = await import('../src/lib/server/enrich-job.js');
      const { readCandidates } = await import('../src/lib/server/candidates.js');
      const result = await enrichCandidatesJob(slug);

      const cands = readCandidates(slug);
      expect(cands.stops[0].hours).toBeUndefined();
      expect(cands.stops[1].hours).toBe('ok');
      expect(result).toMatchObject({ attempted: 2, enriched: 1, failed: 1 });
    });
  });

  test('throws when every attempted stop fails', async () => {
    await withTmpDir(async (root) => {
      const slug = 'enrich-all-fail';
      await seedTrip(root, slug,
        '  - id: a\n    name: A\n    category: misc\n    user_added: false\n');

      chat.mockResolvedValueOnce({ text: 'BAD', usage: { input: 10, output: 5 } });

      const { enrichCandidatesJob } = await import('../src/lib/server/enrich-job.js');
      await expect(enrichCandidatesJob(slug)).rejects.toMatchObject({ code: 'enrich_all_failed' });
    });
  });

  test('aborts cleanly when signal fires mid-loop', async () => {
    await withTmpDir(async (root) => {
      const slug = 'enrich-abort';
      await seedTrip(root, slug,
        '  - id: a\n    name: A\n    category: misc\n    user_added: false\n' +
        '  - id: b\n    name: B\n    category: misc\n    user_added: false\n');

      mockChatReturn('hours: "first"\nwebsite: "https://1"\nphone: "1"');
      const controller = new AbortController();
      chat.mockImplementationOnce(async () => {
        controller.abort();  // abort right before second iteration
        return {
          text: '<enrich>\nhours: "first"\nwebsite: "https://1"\nphone: "1"\n</enrich>',
          usage: { input: 10, output: 5 },
        };
      });

      const { enrichCandidatesJob } = await import('../src/lib/server/enrich-job.js');
      const { readCandidates } = await import('../src/lib/server/candidates.js');
      const result = await enrichCandidatesJob(slug, { signal: controller.signal });

      const cands = readCandidates(slug);
      expect(cands.stops[0].hours).toBe('first');
      expect(cands.stops[1].hours).toBeUndefined();
      // attempted counts only the actually-attempted ones (1, since the abort
      // happens after the first chat() resolves but before the second starts)
      expect(result.attempted).toBe(1);
    });
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL (module doesn't exist)**

```bash
npx vitest run tests/enrich-job.test.js
```

Expected: import error / function not found.

- [ ] **Step 3: Implement `enrich-job.js`**

Create `src/lib/server/enrich-job.js`:

```js
// Enrich-candidates follow-on background job (#403).
//
// Runs after geocode-candidates completes. For each visible stop candidate
// that's missing hours/website/phone, makes one chat() call with web_search
// to fill the gaps. Mirrors geocode-job's contract:
//   - reads candidates from disk on each iteration (concurrent edits survive)
//   - skips entries with all three fields set, unless opts.force is true
//   - skips entries with hidden: true
//   - writes candidates.yaml after each successful enrichment
//   - respects an AbortController.signal (checked at the top of each iteration)
//
// On total failure (every attempted stop fails), throws a TraverseError with
// code 'enrich_all_failed' so the route handler can route it through failJob.
// Partial failures complete normally with a result summary.

import { existsSync, readFileSync } from 'node:fs';
import { parse as yamlParse } from 'yaml';
import { findTripFile, parseFrontmatter } from './data.js';
import { readCandidates, writeCandidates } from './candidates.js';
import { chat } from './ai.js';
import { search, searchToolDefinition } from './search.js';
import { TraverseError } from './errors.js';
import { MAX_TOKENS } from './promises.js';

const URL_RE = /^https?:\/\//i;

function validateField(name, value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (name === 'website' && !URL_RE.test(trimmed)) return null;
  if (name === 'phone' && !/\d/.test(trimmed)) return null;
  return trimmed;
}

function extractEnrichBlock(text) {
  const m = text.match(/<enrich>([\s\S]*?)<\/enrich>/);
  if (!m) return null;
  try {
    return yamlParse(m[1]);
  } catch {
    return null;
  }
}

function readDestination(slug) {
  const path = findTripFile(slug);
  if (!path || !existsSync(path)) return '';
  const raw = readFileSync(path, 'utf8');
  const fm = parseFrontmatter(raw) || {};
  return fm.destination ?? '';
}

function buildPrompt({ stopName, address, destination }) {
  const where = address ? `(at ${address})` : (destination ? `in ${destination}` : '');
  return [
    {
      role: 'user',
      content: [
        `Find current operating hours, official website URL, and phone number for "${stopName}" ${where}.`,
        '',
        'Use the web_search tool to verify. If you cannot find a field with reasonable confidence, omit it. Do not invent.',
        '',
        'Respond with exactly one <enrich>...</enrich> block containing YAML. Example:',
        '',
        '<enrich>',
        'hours: "Mon-Sat 9am-5pm; closed Sundays"',
        'website: "https://example.com"',
        'phone: "(555) 123-4567"',
        '</enrich>',
      ].join('\n'),
    },
  ];
}

/**
 * Enrich each visible stop candidate with hours/website/phone.
 *
 * @param {string} slug
 * @param {object} [opts]
 * @param {AbortSignal} [opts.signal]
 * @param {boolean} [opts.force]  — when true, ignore the "all three set" skip
 * @returns {Promise<{ attempted: number, enriched: number, failed: number, skipped: number, tokens: number }>}
 */
export async function enrichCandidatesJob(slug, opts = {}) {
  const signal = opts.signal;
  const force = opts.force === true;

  const initial = readCandidates(slug);
  if (!initial) return { attempted: 0, enriched: 0, failed: 0, skipped: 0, tokens: 0 };

  const destination = readDestination(slug);
  let attempted = 0;
  let enriched = 0;
  let failed = 0;
  let skipped = 0;
  let tokens = 0;

  // Snapshot the work list from the initial read. Re-read on each iteration
  // so concurrent edits land in the final write.
  const work = [];
  for (const s of initial.stops ?? []) {
    if (s.hidden) { skipped++; continue; }
    const hasAll = !!(s.hours && s.website && s.phone);
    if (hasAll && !force) { skipped++; continue; }
    if (!s.id || !s.name) continue;
    work.push({ id: s.id, name: s.name });
  }

  for (const item of work) {
    if (signal?.aborted) break;
    attempted++;

    try {
      const fresh = readCandidates(slug);
      if (!fresh) break;
      const target = fresh.stops.find((c) => c.id === item.id);
      if (!target) { failed++; continue; }
      if (target.hidden) { failed--; skipped++; continue; }

      const response = await chat({
        system: 'You are a research assistant. Return one YAML block in <enrich> tags. Use the web_search tool if you are unsure. Never invent data.',
        messages: buildPrompt({
          stopName: target.name,
          address: target.address,
          destination,
        }),
        maxTokens: MAX_TOKENS['enrich-candidates'],
        tools: [searchToolDefinition()],
        onToolCall: async (toolUse) => {
          if (toolUse.name === 'web_search') {
            return await search(toolUse.input);
          }
          return null;
        },
        label: 'enrich-candidates',
        signal,
      });

      tokens += (response?.usage?.input ?? 0) + (response?.usage?.output ?? 0);

      const parsed = extractEnrichBlock(response?.text ?? '');
      if (!parsed) { failed++; continue; }

      const hours = validateField('hours', parsed.hours);
      const website = validateField('website', parsed.website);
      const phone = validateField('phone', parsed.phone);
      if (!hours && !website && !phone) { failed++; continue; }

      // Re-read again right before write, so concurrent edits in the same
      // candidate are not stomped.
      const fresh2 = readCandidates(slug);
      if (!fresh2) { failed++; continue; }
      const target2 = fresh2.stops.find((c) => c.id === item.id);
      if (!target2) { failed++; continue; }
      if (target2.hidden) { skipped++; failed--; continue; }

      if (force || !target2.hours) { if (hours) target2.hours = hours; }
      if (force || !target2.website) { if (website) target2.website = website; }
      if (force || !target2.phone) { if (phone) target2.phone = phone; }

      writeCandidates(slug, fresh2);
      enriched++;
    } catch (e) {
      if (e?.name === 'AbortError' || signal?.aborted) break;
      console.warn(`[enrich-candidates] ${slug}: failed stop "${item.name}":`, e?.message ?? e);
      failed++;
    }
  }

  if (attempted > 0 && enriched === 0) {
    throw new TraverseError('enrich_all_failed', `enrich-candidates: every attempted stop failed (${failed} of ${attempted})`);
  }

  return { attempted, enriched, failed, skipped, tokens };
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npx vitest run tests/enrich-job.test.js
```

Expected: all 7 tests PASS. If the abort test is flaky, the loop's `if (signal?.aborted) break;` check at the top of the loop may need tuning.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/enrich-job.js tests/enrich-job.test.js
git commit -m "feat(enrich-job): per-stop hours/website/phone enrichment via chat+search (#403)"
```

---

### Task 8: Add the enrich-candidates route handler

**Files:**
- Create: `src/routes/api/actions/enrich-candidates/[slug]/+server.js`
- Test: optional — only add if `tests/routes/geocode-candidates.test.js` (or similar) exists to mirror

- [ ] **Step 1: Check whether sibling routes have test coverage**

```bash
ls tests/routes/ 2>/dev/null
grep -l "geocode-candidates" tests/ -r 2>/dev/null
```

If a sibling route test exists, plan to add one for enrich-candidates following the same shape. If none, skip the route test (the job logic is covered by Task 7, and the route is thin enough that the smoke check in Task 18 will catch breakage).

- [ ] **Step 2: Implement the route handler**

Create `src/routes/api/actions/enrich-candidates/[slug]/+server.js`:

```js
// Ambient Background: enrich-candidates follow-on job (#403).
//
// Two entry points:
//   - User-triggered POST  → fill hours/website/phone gaps in candidates.yaml
//   - Geocode-job's auto-trigger via _startEnrichCandidatesJob(slug)
//
// POST body: optional `{ force?: boolean }`. When force is true, the job
// re-runs every visible stop instead of skipping ones with all three fields
// already set.
//
// DELETE cancels the in-flight job via cancelJob('enrich-candidates', slug).

import { rejectInvalidSlug } from '$lib/server/data.js';
import {
  assertNotRunning,
  startJob,
  completeJob,
  failJob,
  cancelJob,
} from '$lib/server/jobs.js';
import { enrichCandidatesJob } from '$lib/server/enrich-job.js';
import { TraverseError } from '$lib/server/errors.js';
import { HAND_DEFAULTS } from '$lib/server/promises.js';
import { isAbort } from '$lib/utils/abort.js';
import { json } from '@sveltejs/kit';
import { rateLimitResponse } from '$lib/server/rate-limit.js';
import { getFeatureAvailability } from '$lib/server/config.js';

export const _promise = HAND_DEFAULTS['enrich-candidates'];

/**
 * Fire-and-forget kickoff of the enrich-candidates job for `slug`. The
 * geocode-job calls this on successful completion so the deepen → geocode →
 * enrich chain composes automatically without UI plumbing.
 *
 * @param {string} slug
 * @param {{ force?: boolean }} [opts]
 * @returns {ReturnType<typeof startJob> | null}
 */
export function _startEnrichCandidatesJob(slug, opts = {}) {
  try {
    assertNotRunning('enrich-candidates', slug);
  } catch (err) {
    if (err instanceof TraverseError && err.code === 'already_running') {
      return null;
    }
    throw err;
  }

  const job = startJob('enrich-candidates', slug, { est_seconds: _promise.time_seconds });

  (async () => {
    try {
      const result = await enrichCandidatesJob(slug, {
        signal: job.controller.signal,
        force: opts.force === true,
      });
      try {
        completeJob('enrich-candidates', slug, { tokens: result?.tokens ?? 0 });
      } catch (e) {
        console.error(`[enrich-candidates] ${slug}: completeJob threw after success:`, e?.message ?? e);
      }
    } catch (err) {
      if (isAbort(err)) return; // cancelJob owns the failure event
      const code = err instanceof TraverseError ? err.code : 'unknown';
      console.error(`[enrich-candidates] ${slug}: failed (${code}):`, err?.message ?? err);
      const publicMessage = err instanceof TraverseError ? err.message : 'Enrichment failed — try again.';
      try {
        failJob('enrich-candidates', slug, { code, message: publicMessage });
      } catch (e) {
        console.error(`[enrich-candidates] ${slug}: failJob threw after failure:`, e?.message ?? e);
      }
    }
  })();

  return job;
}

export async function POST({ params, request, event }) {
  const invalid = rejectInvalidSlug(params.slug);
  if (invalid) return invalid;

  const rl = await rateLimitResponse({ event, endpoint: 'enrich-candidates', slugKey: params.slug });
  if (rl) return rl;

  if (!getFeatureAvailability().homeMdReady) {
    return json({ ok: false, code: 'home_not_configured' }, { status: 412 });
  }

  // Block while deepen or geocode-candidates is still running on this trip —
  // the enrich job assumes coords have been resolved.
  for (const blocker of ['deepen', 'geocode-candidates', 'enrich-candidates']) {
    try {
      assertNotRunning(blocker, params.slug);
    } catch (e) {
      if (e instanceof TraverseError && e.code === 'already_running') {
        return json({ ok: false, code: 'already_running' }, { status: 409 });
      }
      throw e;
    }
  }

  let body = {};
  try { body = await request.json(); } catch { /* empty body is fine */ }

  const job = _startEnrichCandidatesJob(params.slug, { force: body.force === true });
  if (!job) {
    return json({ ok: false, code: 'already_running' }, { status: 409 });
  }
  return json({
    ok: true,
    workflow: 'enrich-candidates',
    slug: params.slug,
    est_seconds: _promise.time_seconds,
  }, { status: 202 });
}

export async function DELETE({ params }) {
  const invalid = rejectInvalidSlug(params.slug);
  if (invalid) return invalid;
  cancelJob('enrich-candidates', params.slug);
  return new Response(null, { status: 200 });
}
```

Cross-check the imports — adjust if `event` isn't on the SvelteKit handler signature in your version (it's `RequestEvent`-style); the existing `geocode-candidates/[slug]/+server.js` already uses `rateLimitResponse({ event, ... })` so this mirrors that. If unsure, mirror exactly what `add-candidate/[slug]/+server.js` does.

- [ ] **Step 3: Smoke-test the endpoint**

Manually verify the route is mounted:

```bash
npm run dev -- --port 3456 &
DEVPID=$!
sleep 4
curl -s -X POST -H "Content-Type: application/json" http://localhost:3456/api/actions/enrich-candidates/nonexistent-slug -d '{}'
kill $DEVPID
```

Expected: 404 (slug doesn't exist) or 412 (home.md not configured). Either is fine — we're confirming the route is mounted.

- [ ] **Step 4: Commit**

```bash
git add src/routes/api/actions/enrich-candidates
git commit -m "feat(api): POST/DELETE /api/actions/enrich-candidates/[slug] (#403)"
```

---

### Task 9: Auto-trigger enrich-candidates from the geocode-job

**Files:**
- Modify: `src/routes/api/actions/geocode-candidates/[slug]/+server.js`

- [ ] **Step 1: Add the chain trigger after completeJob**

Edit `src/routes/api/actions/geocode-candidates/[slug]/+server.js`. Update the import block:

```js
import { geocodeCandidatesJob } from '$lib/server/geocode-job.js';
import { _startEnrichCandidatesJob } from '../../enrich-candidates/[slug]/+server.js';
```

Then in `_startGeocodeCandidatesJob`, inside the inner async IIFE, after `completeJob('geocode-candidates', slug);` succeeds, add the enrich kickoff:

```js
  (async () => {
    try {
      await geocodeCandidatesJob(slug, { signal: job.controller.signal });
      try {
        completeJob('geocode-candidates', slug);
        // Chain: kick off the enrich-candidates follow-on now that coords +
        // addresses are in place. Fire-and-forget; failure surfaces through
        // its own pill and frontmatter `last_run_error`.
        _startEnrichCandidatesJob(slug);
      } catch (e) {
        console.error(`[geocode-candidates] ${slug}: completeJob threw after success:`, e?.message ?? e);
      }
    } catch (err) {
      // (existing error branch unchanged)
      if (isAbort(err)) return;
      const code = err instanceof TraverseError ? err.code : 'unknown';
      console.error(`[geocode-candidates] ${slug}: failed (${code}):`, err?.message ?? err);
      const publicMessage = err instanceof TraverseError ? err.message : 'Geocoding failed — try again.';
      try {
        failJob('geocode-candidates', slug, { code, message: publicMessage });
      } catch (e) {
        console.error(`[geocode-candidates] ${slug}: failJob threw after failure:`, e?.message ?? e);
      }
    }
  })();
```

- [ ] **Step 2: Run full verify**

```bash
npm run verify
```

Expected: PASS. If anything in the geocode-job's existing tests breaks due to the new auto-trigger, the test setup likely needs to mock `_startEnrichCandidatesJob` (use `vi.mock`).

- [ ] **Step 3: Commit**

```bash
git add src/routes/api/actions/geocode-candidates/[slug]/+server.js
git commit -m "feat(geocode): auto-trigger enrich-candidates after geocoding completes (#403)"
```

---

## Phase 4 — UI surfaces

### Task 10: Register the workflow label in jobs UI maps

**Files:**
- Modify: `src/lib/utils/jobLabels.js`
- Modify: `src/lib/components/BackgroundJobsIndicator.svelte`

- [ ] **Step 1: Edit `jobLabels.js`**

Add to the `WORKFLOW_LABELS` object (around line 7–15):

```js
  'enrich-candidates': 'Enriching candidates…',
```

- [ ] **Step 2: Edit `BackgroundJobsIndicator.svelte`**

Find the local `WORKFLOW_LABELS` map (line 22) and add:

```js
    'enrich-candidates': 'Enrich',
```

Find the duration map (line 57) and add:

```js
    'enrich-candidates': 90,
```

- [ ] **Step 3: Verify**

```bash
npx svelte-check --fail-on-warnings
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/utils/jobLabels.js src/lib/components/BackgroundJobsIndicator.svelte
git commit -m "ui(jobs): label enrich-candidates workflow (#403)"
```

---

### Task 11: Create `src/lib/utils/links.js`

**Files:**
- Create: `src/lib/utils/links.js`
- Test: `tests/links.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/links.test.js`:

```js
import { describe, test, expect } from 'vitest';
import { mapsHref, telHref, websiteHref, hostLabel } from '../src/lib/utils/links.js';

describe('mapsHref', () => {
  test('encodes the address into a Google Maps search URL', () => {
    expect(mapsHref('123 Main St, Empire, MI 49630'))
      .toBe('https://www.google.com/maps/search/?api=1&query=123%20Main%20St%2C%20Empire%2C%20MI%2049630');
  });
  test('returns null for empty input', () => {
    expect(mapsHref('')).toBeNull();
    expect(mapsHref(null)).toBeNull();
  });
});

describe('telHref', () => {
  test('strips non-digit chars but keeps a leading +', () => {
    expect(telHref('(555) 123-4567')).toBe('tel:5551234567');
    expect(telHref('+1 555 123 4567')).toBe('tel:+15551234567');
  });
  test('returns null when no digits', () => {
    expect(telHref('call us')).toBeNull();
    expect(telHref('')).toBeNull();
  });
});

describe('websiteHref', () => {
  test('returns the URL when it starts with http/https', () => {
    expect(websiteHref('https://example.com')).toBe('https://example.com');
    expect(websiteHref('http://example.com/path')).toBe('http://example.com/path');
  });
  test('returns null otherwise', () => {
    expect(websiteHref('example.com')).toBeNull();
    expect(websiteHref('')).toBeNull();
    expect(websiteHref(null)).toBeNull();
  });
});

describe('hostLabel', () => {
  test('extracts the hostname without www', () => {
    expect(hostLabel('https://www.example.com/path')).toBe('example.com');
    expect(hostLabel('http://example.com')).toBe('example.com');
  });
  test('returns the input back when not a parseable URL', () => {
    expect(hostLabel('whatever')).toBe('whatever');
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npx vitest run tests/links.test.js
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

Create `src/lib/utils/links.js`:

```js
// Link helpers for per-stop metadata fields. Pure functions — no platform
// sniffing, no SSR detection. URL builders only.

const HTTP_RE = /^https?:\/\//i;

export function mapsHref(address) {
  if (!address || typeof address !== 'string') return null;
  const trimmed = address.trim();
  if (!trimmed) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(trimmed)}`;
}

export function telHref(phone) {
  if (!phone || typeof phone !== 'string') return null;
  const hasPlus = phone.trim().startsWith('+');
  const digits = phone.replace(/\D/g, '');
  if (!digits) return null;
  return `tel:${hasPlus ? '+' : ''}${digits}`;
}

export function websiteHref(url) {
  if (!url || typeof url !== 'string') return null;
  return HTTP_RE.test(url) ? url : null;
}

export function hostLabel(url) {
  if (!url || typeof url !== 'string') return url;
  try {
    const u = new URL(url);
    return u.host.replace(/^www\./i, '');
  } catch {
    return url;
  }
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npx vitest run tests/links.test.js
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/utils/links.js tests/links.test.js
git commit -m "feat(utils): add link helpers for maps/tel/website (#403)"
```

---

### Task 12: Extend `deriveBrochure` to project new fields

**Files:**
- Modify: `src/lib/server/derive-brochure.js` (lines 74–80)
- Test: `tests/derive-brochure.test.js` (extend)

- [ ] **Step 1: Write the failing test**

Append to `tests/derive-brochure.test.js`:

```js
test('projects address/hours/website/phone onto brochure stops', async () => {
  await withTmpDir(async (root) => {
    const slug = 'brochure-meta';
    await seedPlanningTripWithCandidates(root, slug, {
      stops: [{
        id: 'a',
        name: 'A',
        category: 'misc',
        description: 'desc',
        coords: { lat: 1, lng: 2 },
        address: '1 Main St',
        hours: '9-5',
        website: 'https://a.example',
        phone: '555',
      }],
      lodging: [],
    });
    await seedPlanDays(root, slug, [{ number: 1, stops: ['a'] }]);

    const brochure = deriveBrochure(slug);
    const stop = brochure.days[0].stops[0];
    expect(stop.address).toBe('1 Main St');
    expect(stop.hours).toBe('9-5');
    expect(stop.website).toBe('https://a.example');
    expect(stop.phone).toBe('555');
  });
});
```

(Adapt to the existing helpers in the test file — likely there's already a `seedPlanningTripWithCandidates` or similar.)

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npx vitest run tests/derive-brochure.test.js -t "metadata"
```

Expected: FAIL (`stop.address` is undefined because `deriveBrochure` doesn't project it).

- [ ] **Step 3: Implement**

Edit `src/lib/server/derive-brochure.js` lines 74–80 (the `.map((c) => ({ ... }))` candidate projection). Add the four new fields:

```js
      .map((c) => ({
        name: c.name,
        category: c.category,
        description: c.description,
        notes: c.description,           // legacy alias for the print view
        coords: normalizeCoords(c.coords),
        address: c.address,
        hours: c.hours,
        website: c.website,
        phone: c.phone,
      }));
```

Also update the equivalent projection in the flat-list fallback further down (if there is one — search for `brochure.stops` to find it).

- [ ] **Step 4: Run tests — expect PASS**

```bash
npx vitest run tests/derive-brochure.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/derive-brochure.js tests/derive-brochure.test.js
git commit -m "feat(brochure): project address/hours/website/phone to brochure shape (#403)"
```

---

### Task 13: Render `website` and `phone` in `Brochure.svelte`

**Files:**
- Modify: `src/lib/components/Brochure.svelte` (lines 248–250 and 271–273, plus CSS at line ~909)

- [ ] **Step 1: Add the new guarded slots**

Edit `src/lib/components/Brochure.svelte`. Find the two existing slot blocks (lines 248–250 and 271–273) and extend each:

```svelte
                      {#if stop.hours}<div class="stop-hours">{stop.hours}</div>{/if}
                      {#if stop.address}<div class="stop-addr">{stop.address}</div>{/if}
                      {#if stop.website}<div class="stop-website">{stop.website}</div>{/if}
                      {#if stop.phone}<div class="stop-phone">{stop.phone}</div>{/if}
                      {#if stop.notes}<p class="stop-notes">{stop.notes}</p>{/if}
```

Same change in both spots. Print-optimized: plain text, no `<a href>` wrapping (clickability is meaningless on paper).

- [ ] **Step 2: Add CSS rules**

Find the existing `.stop-hours, .stop-addr` styling block (around line 909). Extend the selector list:

```css
  .stop-hours,
  .stop-addr,
  .stop-website,
  .stop-phone {
```

(Whatever the existing block declared remains — we're just adding two more class names to the same selector list so they pick up the same italic-caption style.)

- [ ] **Step 3: Verify in the browser**

```bash
npm run dev -- --port 3456 &
DEVPID=$!
sleep 4
```

Pick a planning trip with metadata (run Research first if needed; if no existing trip has it, just verify the field-absent fallback renders normally). Navigate to `/trips/<slug>/brochure` and Cmd-P print preview. Verify hours/address/website/phone all render as plain text with the same italic styling. `kill $DEVPID` when done.

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/Brochure.svelte
git commit -m "ui(brochure): render website and phone slots on stops (#403)"
```

---

### Task 14: Add metadata row to `StopCard.svelte`

**Files:**
- Modify: `src/lib/components/StopCard.svelte`

The component handles two layouts: **non-compact** (Candidates section) and **compact** (inside Plan day cards). Both need metadata, but with different presentations per the spec. Non-compact: chip row below the summary. Compact: vertical stack below the head (collapses out when no metadata).

- [ ] **Step 1: Add imports + derived helpers**

In the `<script>` block (line 1–70 currently), add the link-helper import at the top:

```js
  import { mapsHref, telHref, websiteHref, hostLabel } from '$lib/utils/links.js';
```

And after the `glyph` derived (around line 48), add:

```js
  // Show the metadata row when any of the four optional fields are present.
  const hasMeta = $derived(!!(stop.address || stop.hours || stop.website || stop.phone));
  const mapsUrl = $derived(mapsHref(stop.address));
  const telUrl = $derived(telHref(stop.phone));
  const webUrl = $derived(websiteHref(stop.website));
  const webLabel = $derived(stop.website ? hostLabel(stop.website) : '');
```

- [ ] **Step 2: Add the markup**

In the `<article>` body, after the `<p class="summary">` block (line 98–100) and before `<footer>` (line 102), add the meta row block:

```svelte
  {#if hasMeta && !compact}
    <div class="meta-row" aria-label="Stop details">
      {#if stop.address}
        {#if mapsUrl}
          <a class="meta-chip meta-chip--addr" href={mapsUrl} target="_blank" rel="noopener" aria-label="Open in maps: {stop.address}" onclick={(e) => e.stopPropagation()}>
            <span class="meta-icon" aria-hidden="true">📍</span>{stop.address}
          </a>
        {:else}
          <span class="meta-chip meta-chip--addr"><span class="meta-icon" aria-hidden="true">📍</span>{stop.address}</span>
        {/if}
      {/if}
      {#if stop.hours}
        <span class="meta-chip meta-chip--hours" title={stop.hours}>
          <span class="meta-icon" aria-hidden="true">⏰</span>{stop.hours}
        </span>
      {/if}
      {#if webUrl}
        <a class="meta-chip meta-chip--web" href={webUrl} target="_blank" rel="noopener" aria-label="Website: {webLabel}" onclick={(e) => e.stopPropagation()}>
          <span class="meta-icon" aria-hidden="true">🌐</span>{webLabel}
        </a>
      {/if}
      {#if telUrl}
        <a class="meta-chip meta-chip--phone" href={telUrl} aria-label="Call {stop.phone}" onclick={(e) => e.stopPropagation()}>
          <span class="meta-icon" aria-hidden="true">☎</span>{stop.phone}
        </a>
      {/if}
    </div>
  {/if}

  {#if hasMeta && compact}
    <div class="meta-stack" aria-label="Stop details">
      {#if stop.address}
        <div class="meta-line meta-line--addr">
          {#if mapsUrl}
            <a class="meta-link meta-link--primary" href={mapsUrl} target="_blank" rel="noopener" onclick={(e) => e.stopPropagation()}>
              {stop.address} <span class="meta-cta">→ Maps</span>
            </a>
          {:else}
            <span>{stop.address}</span>
          {/if}
        </div>
      {/if}
      {#if stop.hours}<div class="meta-line meta-line--hours">{stop.hours}</div>{/if}
      {#if webUrl || telUrl}
        <div class="meta-line meta-line--contact">
          {#if webUrl}<a class="meta-link" href={webUrl} target="_blank" rel="noopener" onclick={(e) => e.stopPropagation()}>{webLabel} ↗</a>{/if}
          {#if telUrl}<a class="meta-link" href={telUrl} onclick={(e) => e.stopPropagation()}>{stop.phone} ↗</a>{/if}
        </div>
      {/if}
    </div>
  {/if}
```

Note on emoji glyphs: the surrounding component already uses literal Unicode characters for category glyphs (`◉`, `◐`, etc., see line 36–46). Stick with the same approach for the meta icons (📍 ⏰ 🌐 ☎) — no need to import an icon library. If `svelte-check --fail-on-warnings` flags anything, that's the signal to switch; otherwise this matches the existing style.

- [ ] **Step 3: Add CSS rules**

In the `<style>` block, after the `.summary` block (line 319) and before `footer` (line 321), add:

```css
  .meta-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    margin-top: 0.15rem;
  }
  .meta-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.74rem;
    line-height: 1.2;
    color: var(--text-secondary);
    background: var(--surface-sunken);
    padding: 0.18rem 0.45rem;
    border-radius: 999px;
    max-width: 18rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    text-decoration: none;
    border: 0.5px solid transparent;
    transition: background-color 0.12s, color 0.12s, border-color 0.12s;
  }
  a.meta-chip { cursor: pointer; }
  a.meta-chip:hover {
    background: var(--surface-raised);
    color: var(--accent-text);
    border-color: var(--border-default);
  }
  .meta-icon {
    font-size: 0.7rem;
    line-height: 1;
    flex-shrink: 0;
  }

  /* Compact mode (inside Plan day cards) — vertical stack, larger touch
     targets, address gets primary visual weight. */
  .meta-stack {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    margin-top: 0.25rem;
    font-size: 0.82rem;
    line-height: 1.4;
    width: 100%;
  }
  .meta-line { color: var(--text-secondary); }
  .meta-line--addr { font-weight: 500; }
  .meta-line--hours { color: var(--text-tertiary); font-style: italic; }
  .meta-line--contact { display: flex; gap: 0.8rem; flex-wrap: wrap; }
  .meta-link {
    color: var(--accent-text);
    text-decoration: none;
    border-bottom: 1px dotted color-mix(in oklab, var(--accent-text) 50%, transparent);
  }
  .meta-link:hover { border-bottom-style: solid; }
  .meta-link--primary {
    color: var(--text-primary);
    border-bottom-color: color-mix(in oklab, var(--text-primary) 35%, transparent);
  }
  .meta-cta {
    color: var(--accent-text);
    margin-left: 0.25rem;
  }
  @media (pointer: coarse) {
    .meta-line--addr a { min-height: var(--tap-min); display: inline-flex; align-items: center; }
    .meta-link { min-height: var(--tap-min); display: inline-flex; align-items: center; padding: 0.2rem 0; }
  }
```

Note: the compact-mode StopCard CSS earlier disables `.summary` rendering implicitly through the `!compact` guard on the markup. The new `.meta-stack` only renders when `compact && hasMeta`, so it shows precisely when desired. The compact-card's single-line constraint (`flex-wrap: nowrap`) on `.head` is unaffected.

In the compact-card style block (around line 196), the existing layout uses `display: flex; align-items: center;` which forces children onto a single row. The `.meta-stack` needs to break out of that. Add to the compact block:

```css
  .stop-card.compact {
    flex-wrap: wrap;  /* allow meta-stack to drop below head */
  }
  .stop-card.compact .meta-stack {
    flex-basis: 100%;
    padding-left: calc(18px + 0.5rem); /* indent under the badge */
  }
```

- [ ] **Step 4: svelte-check + manual UI verify**

```bash
npx svelte-check --fail-on-warnings
```

Expected: PASS.

```bash
npm run dev -- --port 3456 &
DEVPID=$!
sleep 4
```

Manually exercise:
1. Open a planning trip. The Candidates section should show meta chips on stops that have metadata; cards without metadata look unchanged.
2. In the Plan section, day cards should expand vertically when a stop has metadata; the address line is the prominent one.
3. Hover and click each chip: address opens Google Maps in a new tab; website opens the site; phone triggers a tel: link (browsers may show a dialog or do nothing depending on platform — that's fine).
4. Verify a stop with NO metadata in the Plan view collapses back to today's compact single-line form.

`kill $DEVPID` when done.

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/StopCard.svelte
git commit -m "ui(stop-card): meta row in candidates view, expanded stack in plan day cards (#403)"
```

---

### Task 15: Refresh metadata button in `CandidatesSection.svelte`

**Files:**
- Modify: `src/lib/components/CandidatesSection.svelte`

- [ ] **Step 1: Locate the section header**

```bash
grep -n "tab\|Stops\|Lodging\|header" src/lib/components/CandidatesSection.svelte | head -30
```

Find where the Stops / Lodging tab toggles live (probably in a `<header>` or `<div class="tabs">` at the top of the component). The Refresh button + kebab go in the same row, right-aligned.

- [ ] **Step 2: Add the button + kebab**

Add to the script block (top of file):

```js
  let refreshing = $state(false);
  let kebabOpen = $state(false);
  let refreshError = $state(null);

  async function refreshMetadata({ force = false } = {}) {
    if (refreshing) return;
    kebabOpen = false;
    refreshing = true;
    refreshError = null;
    try {
      const res = await fetch(`/api/actions/enrich-candidates/${slug}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force }),
      });
      if (!res.ok && res.status !== 202) {
        const data = await res.json().catch(() => ({}));
        refreshError = data.code || `http_${res.status}`;
      }
    } catch (e) {
      refreshError = 'network_error';
    } finally {
      refreshing = false;
    }
  }
```

(Use whatever variable name the component already uses for `slug` — search for `slug` near the top.)

Then add a property check for blocking jobs. The component likely already has access to `data.jobs` or polls — find where the Stops/Lodging tab is rendered and look for any disable logic.

In the template, render the button on the Stops tab only:

```svelte
{#if activeTab === 'stops' && !readonly && (cands?.stops?.length ?? 0) > 0}
  <div class="refresh-controls">
    <button
      type="button"
      class="btn-inline refresh-btn"
      disabled={refreshing || anyJobRunningForTrip}
      onclick={() => refreshMetadata({ force: false })}
      title="Fetch hours/website/phone for stops that are missing them"
    >
      {#if refreshing}Refreshing…{:else}↻ Refresh metadata{/if}
    </button>
    <button
      type="button"
      class="btn-inline kebab-btn"
      disabled={refreshing || anyJobRunningForTrip}
      onclick={() => (kebabOpen = !kebabOpen)}
      aria-label="More refresh options"
      aria-expanded={kebabOpen}
    >⌄</button>
    {#if kebabOpen}
      <div class="kebab-menu" role="menu">
        <button
          type="button"
          role="menuitem"
          class="kebab-item"
          onclick={() => refreshMetadata({ force: true })}
        >Re-fetch all (force overwrite)</button>
      </div>
    {/if}
  </div>
{/if}
```

`anyJobRunningForTrip` is a `$derived` that reads from the existing job-poll data passed to the component. Match whatever the parent already provides. If the component receives `jobs: Job[]` as a prop, derive:

```js
  const anyJobRunningForTrip = $derived(
    (jobs ?? []).some((j) => j.slug === slug && ['deepen', 'geocode-candidates', 'enrich-candidates'].includes(j.workflow.replace(/:.*$/, '')))
  );
```

If the parent doesn't pass jobs in, that's a wiring task — pass them through from `+page.svelte` (the planning trip detail page). Check what `BackgroundJobsIndicator` reads from and mirror that.

- [ ] **Step 3: Add minimal CSS**

```css
  .refresh-controls {
    position: relative;
    display: flex;
    align-items: center;
    gap: 0.25rem;
    margin-left: auto; /* push to right side of the tab row */
  }
  .refresh-btn { white-space: nowrap; }
  .kebab-btn {
    padding: 0.2rem 0.4rem;
    font-size: 0.9rem;
  }
  .kebab-menu {
    position: absolute;
    top: 100%;
    right: 0;
    margin-top: 0.25rem;
    background: var(--surface-raised);
    border: 0.5px solid var(--border-default);
    border-radius: 4px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
    z-index: 10;
    min-width: 12rem;
  }
  .kebab-item {
    display: block;
    width: 100%;
    text-align: left;
    background: transparent;
    border: 0;
    padding: 0.45rem 0.7rem;
    font-size: 0.84rem;
    color: var(--text-primary);
    cursor: pointer;
  }
  .kebab-item:hover { background: var(--surface-sunken); }
```

- [ ] **Step 4: Hide on completed trips (readonly)**

The component already supports a `readonly` prop (check the file header). The `{#if activeTab === 'stops' && !readonly && ...}` guard handles this — verify the prop name matches.

- [ ] **Step 5: svelte-check + manual UI verify**

```bash
npx svelte-check --fail-on-warnings
```

Then:

```bash
npm run dev -- --port 3456 &
DEVPID=$!
sleep 4
```

On a planning trip:
1. Refresh metadata button appears on the Stops tab, right-aligned in the header
2. Click it → button disables, shows "Refreshing…" → after job kicks off, the background pill appears with the Enrich label
3. Open kebab → "Re-fetch all (force overwrite)" item visible → click it → same behavior with force=true
4. While deepen or geocode-candidates is running, both buttons are disabled
5. On the Lodging tab, the buttons are absent
6. On a completed trip, the buttons are absent (whole section is readonly)

`kill $DEVPID`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/components/CandidatesSection.svelte
git commit -m "ui(candidates): refresh metadata button + force-overwrite kebab (#403)"
```

---

## Phase 5 — Prompt, docs, verify

### Task 16: Allow LLM to emit new fields in the deepen `<candidates>` envelope

**Files:**
- Modify: `src/routes/api/actions/deepen/[slug]/+server.js`

Optional hint to the LLM: if it already knows hours/website/phone from web_search, it can include them in the initial deepen YAML and the enrich-candidates job will skip those entries (idempotent). This avoids redundant search.

- [ ] **Step 1: Update the prompt envelope**

In `src/routes/api/actions/deepen/[slug]/+server.js`, find the `<candidates>` template (around line 248). Update the `stops:` example to include the four new optional fields:

```
stops:
  - name: "Place name"
    category: historic
    description: "One sentence describing the place"
    why_recommended: "One sentence linking to trip vibe / home preferences"
    source_url: "best source url if any"
    # Optional — include only when you have high-confidence values from web_search.
    # The follow-on enrich-candidates job will fill these for any stop where
    # they are omitted, so don't guess.
    address: "street, city, state postcode (if known with high confidence)"
    hours: "Mon-Sat 9am-5pm (if known)"
    website: "https://example.com (if known)"
    phone: "(555) 123-4567 (if known)"
```

Keep the existing "Skip 'id' and 'coords'" hint — those are derived. The four new fields are explicitly opt-in.

- [ ] **Step 2: Smoke-test**

```bash
npm run smoke
```

Expected: PASS. The deepen prompt is now larger; smoke covers the chat() round-trip per provider.

- [ ] **Step 3: Commit**

```bash
git add src/routes/api/actions/deepen/[slug]/+server.js
git commit -m "feat(deepen): allow LLM to emit address/hours/website/phone in candidates YAML (#403)"
```

---

### Task 17: Update the candidates schema spec

**Files:**
- Modify: `docs/superpowers/specs/2026-05-22-planning-plan-and-candidates-design.md`

- [ ] **Step 1: Locate the candidates schema section**

```bash
grep -n "stops:\|candidates schema\|user_added\|description" docs/superpowers/specs/2026-05-22-planning-plan-and-candidates-design.md | head -20
```

- [ ] **Step 2: Add a note about the four new optional fields**

Inline-edit the candidates schema section to document `address`, `hours`, `website`, `phone` as optional top-level fields on each stop. Mirror the spec language. Keep it concise:

> Per stop, four additional optional fields populated by the post-deepen follow-on jobs (see [`2026-05-27-per-stop-metadata-design.md`](2026-05-27-per-stop-metadata-design.md)):
> - `address` — written by `geocode-candidates` from Nominatim's reverse lookup
> - `hours`, `website`, `phone` — written by `enrich-candidates`

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-05-22-planning-plan-and-candidates-design.md
git commit -m "docs(spec): note per-stop metadata fields in candidates schema (#403)"
```

---

### Task 18: CHANGELOG entry

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Add an Unreleased v0.1.2 section if none exists, with the per-stop metadata entry**

```markdown
## [Unreleased] — v0.1.2

### Added
- **Per-stop metadata** (#403). Every stop candidate can now carry `hours`,
  `address`, `website`, and `phone`. Address is captured for free as a
  byproduct of the existing geocode-candidates job (Nominatim reverse
  lookup). Hours/website/phone are filled by a new `enrich-candidates`
  follow-on job that runs automatically after geocoding, or on demand via
  the new **Refresh metadata** button in the Candidates section header.
  Re-fetching all metadata triggers ~1 chat() call per stop with web search
  — small but non-zero token cost.
- Metadata renders as a chip row on candidate cards (Candidates section)
  and as an expanded info stack on stops promoted into a day (Plan section,
  the in-trip companion view). The print brochure now renders all four
  fields when present.
```

- [ ] **Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs(changelog): per-stop metadata (#403)"
```

---

### Task 19: Manual verification + final verify

- [ ] **Step 1: Run the full verify**

```bash
npm run verify
```

Expected: all green.

- [ ] **Step 2: Smoke-check the provider round-trip**

```bash
npm run smoke
```

Expected: PASS for every configured provider.

- [ ] **Step 3: Manual end-to-end exercise**

```bash
npm run dev -- --port 3456 &
DEVPID=$!
sleep 4
```

Walk through:

1. **Fresh idea → Research:** create a new idea, click Research →. Watch the three pills cascade: `Researching… → Research complete ✓ → Geocoding… → Geocoding complete ✓ → Enriching… → Enrich complete ✓`.
2. **Candidates view:** the Stops tab shows cards with the new chip row (address + hours + website + phone) for stops that got enriched. Cards that didn't get every field show partial chips.
3. **Plan view:** drag a stop into a day. The day card now shows the stop as an expanded stack with address on its own line as the most prominent link.
4. **Refresh metadata:** click `↻ Refresh metadata` on the Stops tab → button disables, "Refreshing…" label, enrich pill appears, completes. No-op if everything's already set.
5. **Re-fetch all:** click the `⌄` next to refresh → "Re-fetch all (force overwrite)" → confirm it re-runs every stop regardless of existing data.
6. **Cancel mid-enrich:** start enrich-candidates, open the jobs drawer, click Cancel. Partial writes persist; trip header shows `last_run_error: interrupted` banner.
7. **Brochure view:** click `↗ View brochure (for print)` → Cmd-P print preview. Verify all four fields render as plain text under each stop. Address has no link styling.
8. **Mobile sanity:** open the same trip on a phone (or use Chrome's mobile emulation). Plan day card metadata stack should have larger tap targets; `tel:` link should offer to call.
9. **Mark trip completed:** verify the Candidates section becomes readonly. Refresh metadata button absent. Existing metadata still renders.
10. **Manually-added candidate:** add a stop via "Add candidate". After the add, the new stop has no metadata. Click Refresh metadata. Enrich runs, fills the gaps for the new stop.

`kill $DEVPID` when done.

- [ ] **Step 4: Final commit (only if you found and fixed any UI bugs during step 3)**

If everything is clean, no commit needed. If you patched anything, commit each fix with a clear message.

- [ ] **Step 5: Push the branch and open a PR**

```bash
git push -u origin <branch-name>
gh pr create --title "Per-stop metadata: hours, address, website, phone (#403)" --body "$(cat <<'EOF'
## Summary
- Adds four optional fields (`address`, `hours`, `website`, `phone`) to every stop candidate
- New `enrich-candidates` follow-on job calls `chat()` + `search()` once per stop to fill hours/website/phone
- Extended `geocode-candidates` to also capture `address` via Nominatim reverse geocoding (single extra HTTP per stop, throttled)
- Refresh metadata button in the Candidates section header (with kebab "Re-fetch all" override)
- Metadata renders across all three surfaces: candidate cards (chip row), Plan day-cards (expanded stack with prominent address link), brochure (plain-text slots)

Implements [`docs/superpowers/specs/2026-05-27-per-stop-metadata-design.md`](docs/superpowers/specs/2026-05-27-per-stop-metadata-design.md). Closes #403.

## Test plan
- [ ] `npm run verify` (svelte-check + tests + build)
- [ ] `npm run smoke` (per-provider round-trip)
- [ ] Fresh idea → Research → observe three sequential pills (research → geocode → enrich)
- [ ] Candidate cards show chip row for enriched stops
- [ ] Plan day cards show expanded stack with Maps link
- [ ] Refresh metadata (default + Re-fetch all) works
- [ ] Cancel mid-enrich leaves partial writes
- [ ] Brochure print preview renders all four fields without link styling
- [ ] Mobile: tel:/geo: links work; tap targets meet `--tap-min`
- [ ] Completed trip: Candidates section readonly, Refresh button absent

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review of this plan

(Run before handing to executor.)

**Spec coverage check** — does each section of the spec map to a task above?

| Spec section | Implementing tasks |
|---|---|
| Data model (4 flat optional fields) | Task 1 (round-trip), Task 2 (realize-plan pass-through) |
| Sourcing: geocode-candidates extended | Task 3 (reverseGeocode), Task 4 (geocode-job address write) |
| Sourcing: new enrich-candidates job | Tasks 5–9 |
| Refresh UX (button + kebab + states) | Task 15 |
| Rendering: candidates cards (chip row) | Task 14 (StopCard non-compact branch) |
| Rendering: Plan day-cards (expanded stack) | Task 14 (StopCard compact branch) |
| Rendering: brochure | Task 12 (deriveBrochure projection), Task 13 (Brochure.svelte slots) |
| Cross-cutting link helper | Task 11 |
| Testing | Tasks 1, 2, 3, 4, 7, 11, 12 each include test coverage; Task 19 is the manual verification gate |
| Open implementation questions | All resolved inline per the spec's "lean" recommendations: cleaned-vs-display_name (cleaned with fallback, Task 3); kebab vs shift-click (kebab, Task 15); icon library (none — match StopCard's existing glyph convention, Task 14); log-and-drop validation (Task 7); `est_seconds: 90` (Task 6); no-coords candidates (Task 7 — uses destination context); no auto-backfill on existing trips (covered by the auto-trigger only running post-geocode, not on page load); Plan day-card layout depth (kept in scope, Task 14); cost framing (Task 18 CHANGELOG) |

No gaps.

**Placeholder scan** — searched for "TBD", "TODO", "fill in details", "add appropriate", "handle edge cases". None found in this plan body. All code blocks are complete, all commands have expected output described.

**Type consistency** — `enrichCandidatesJob` is referenced consistently across Tasks 7, 8, 9. `_startEnrichCandidatesJob` consistent. `reverseGeocode` consistent. `mapsHref` / `telHref` / `websiteHref` / `hostLabel` consistent between Task 11 (define) and Task 14 (use). The `force` flag is consistent across the route handler (Task 8), job loop (Task 7), and the kebab "Re-fetch all" item (Task 15).

One soft spot to watch during implementation: the `anyJobRunningForTrip` derivation in Task 15 assumes the component receives a `jobs` prop. If the parent doesn't already pass one, that's a 2-line wiring change in `src/routes/trips/[slug]/+page.svelte` or the layout — flagged as a sub-step inside Task 15 but not its own task.

---

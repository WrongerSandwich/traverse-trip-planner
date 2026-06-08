# Offline Support — Static Today-View Bundle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Save for offline" action that downloads a single self-contained HTML file of a trip's Today view, working with zero connectivity to the home server.

**Architecture:** A pure server-side renderer (`renderOfflineToday`) turns the existing `deriveBrochure()` data into one self-contained HTML document (inlined CSS, an inline vanilla-JS day switcher, `geo:`/`tel:` links). A new `GET /trips/[slug]/today/offline` endpoint serves it as a file download. Two UI affordances (Today header + detail ⋯ menu) link to the endpoint. No service worker — the deploy is plain-HTTP-on-LAN, which can't register one (see spec).

**Tech Stack:** SvelteKit (adapter-node), Svelte 5 runes, Vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-06-07-offline-support-design.md`

---

## File Structure

- **Create** `src/lib/server/render-offline-today.js` — pure `renderOfflineToday(viewModel)` → HTML string. Owns the standalone document template, inlined stylesheet, inline switcher script, and HTML-escaping. The one place the offline markup lives.
- **Create** `src/routes/trips/[slug]/today/offline/+server.js` — `GET` endpoint: validate slug → `deriveBrochure` → build view-model → `renderOfflineToday` → file-download `Response`.
- **Modify** `src/lib/today.js` — add `geoHref()` and extract the coord-normalization helpers (`arrayToObjCoords`, `normalizeStopCoords`, `normalizeDayCoords`) so both the Today route and the offline endpoint share them (DRY, anti-drift).
- **Modify** `src/routes/trips/[slug]/today/+page.server.js` — import the extracted normalization helpers instead of defining them inline (no behavior change).
- **Modify** `src/routes/trips/[slug]/today/+page.svelte` — add a "⤓ Save for offline" link in the header.
- **Modify** `src/routes/trips/[slug]/+page.svelte` — add a "📥 Save offline copy" item to the ⋯-menu Output group.
- **Create** `tests/today-offline-helpers.test.js` — unit tests for `geoHref` + normalization helpers.
- **Create** `tests/render-offline-today.test.js` — renderer content, escaping, edge cases, and the no-external-subresources invariant.
- **Create** `tests/offline-endpoint.test.js` — endpoint headers/filename/404 (mocking `deriveBrochure`).

**Styling note (token exception):** The standalone file cannot reference `src/app.css`, so its `<style>` block inlines literal color values (light-theme tokens). This is the one sanctioned exception to the "tokens not literals" rule — it applies only to this generated export artifact. The bundle uses a simplified single-accent palette (forest accent, bone surfaces), not the full per-category color matrix.

**No-image rule:** The bundle renders a text "Traverse" wordmark — no `<img>`, no logo data-URI — keeping the no-external-subresources invariant trivially clean.

---

## Task 1: Shared helpers in `today.js` (`geoHref` + coord normalization)

**Files:**
- Modify: `src/lib/today.js`
- Test: `tests/today-offline-helpers.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/today-offline-helpers.test.js`:

```js
import { describe, it, expect } from 'vitest';
import {
  geoHref,
  arrayToObjCoords,
  normalizeStopCoords,
  normalizeDayCoords,
} from '../src/lib/today.js';

describe('geoHref', () => {
  it('builds a geo: URI with a pin label from {lat,lng}', () => {
    expect(geoHref({ lat: 42.4168, lng: -90.4287 }, 'Main Street')).toBe(
      'geo:42.4168,-90.4287?q=42.4168,-90.4287(Main%20Street)',
    );
  });

  it('omits the query when no label is given', () => {
    expect(geoHref({ lat: 1, lng: 2 })).toBe('geo:1,2');
  });

  it('returns null for missing coords', () => {
    expect(geoHref(null, 'X')).toBe(null);
    expect(geoHref(undefined)).toBe(null);
  });
});

describe('coord normalization', () => {
  it('arrayToObjCoords converts [lat,lng] to {lat,lng}', () => {
    expect(arrayToObjCoords([42.4, -90.4])).toEqual({ lat: 42.4, lng: -90.4 });
  });

  it('arrayToObjCoords passes through null and existing objects', () => {
    expect(arrayToObjCoords(null)).toBe(null);
    expect(arrayToObjCoords({ lat: 1, lng: 2 })).toEqual({ lat: 1, lng: 2 });
  });

  it('normalizeStopCoords normalizes a stop’s coords array', () => {
    const out = normalizeStopCoords({ name: 'A', coords: [1, 2] });
    expect(out).toEqual({ name: 'A', coords: { lat: 1, lng: 2 } });
  });

  it('normalizeDayCoords normalizes stops and lodging', () => {
    const day = {
      n: 1,
      stops: [{ name: 'A', coords: [1, 2] }],
      lodging: { name: 'Inn', coords: [3, 4] },
    };
    const out = normalizeDayCoords(day);
    expect(out.stops[0].coords).toEqual({ lat: 1, lng: 2 });
    expect(out.lodging.coords).toEqual({ lat: 3, lng: 4 });
  });

  it('normalizeDayCoords leaves null lodging as null', () => {
    const out = normalizeDayCoords({ n: 1, stops: [], lodging: null });
    expect(out.lodging).toBe(null);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- today-offline-helpers`
Expected: FAIL — `geoHref`/`arrayToObjCoords`/etc. are not exported.

- [ ] **Step 3: Add the helpers to `src/lib/today.js`**

Append to `src/lib/today.js` (after `telHref`):

```js
/**
 * Build a `geo:` URI for a coordinate, with an optional pin label.
 * `geo:` opens the device's default maps app and works offline when that
 * app has offline maps; degrades harmlessly otherwise.
 *
 * @param {{lat: number, lng: number}|null|undefined} coords
 * @param {string} [label]
 * @returns {string|null}
 */
export function geoHref(coords, label) {
  if (!coords) return null;
  const { lat, lng } = coords;
  const q = label ? `?q=${lat},${lng}(${encodeURIComponent(label)})` : '';
  return `geo:${lat},${lng}${q}`;
}

/**
 * Normalize a coordinate to {lat, lng} object form.
 * deriveBrochure emits [lat, lng] arrays; the Today view + offline renderer
 * expect {lat, lng} so navUrl()/geoHref() can read .lat/.lng.
 *
 * @param {[number, number]|{lat:number,lng:number}|null} coords
 * @returns {{lat:number,lng:number}|null}
 */
export function arrayToObjCoords(coords) {
  if (!coords) return null;
  if (Array.isArray(coords) && coords.length === 2) {
    const [lat, lng] = coords;
    return { lat, lng };
  }
  return coords;
}

/** @param {object} stop */
export function normalizeStopCoords(stop) {
  return { ...stop, coords: arrayToObjCoords(stop.coords) };
}

/** @param {object} day */
export function normalizeDayCoords(day) {
  if (!day) return day;
  return {
    ...day,
    stops: (day.stops ?? []).map(normalizeStopCoords),
    lodging: day.lodging
      ? { ...day.lodging, coords: arrayToObjCoords(day.lodging.coords) }
      : null,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- today-offline-helpers`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/today.js tests/today-offline-helpers.test.js
git commit -m "feat(today): add geoHref + shared coord-normalization helpers"
```

---

## Task 2: Use the shared normalization helpers in the Today route

**Files:**
- Modify: `src/routes/trips/[slug]/today/+page.server.js`

This is a pure refactor — remove the inline `arrayToObjCoords`/`normalizeStopCoords`/`normalizeDayCoords` definitions and import them. Existing Today behavior is unchanged; the full test suite guards it.

- [ ] **Step 1: Replace the inline definitions with an import**

In `src/routes/trips/[slug]/today/+page.server.js`, change the imports at the top:

```js
import { error } from '@sveltejs/kit';
import { enrichTrips, isValidSlug } from '$lib/server/data.js';
import { deriveBrochure } from '$lib/server/derive-brochure.js';
import { resolveCurrentDay, normalizeDayCoords } from '$lib/today.js';
```

Then **delete** the now-duplicated local function block (the `arrayToObjCoords`, `normalizeStopCoords`, and `normalizeDayCoords` definitions plus their doc-comments — the block spanning the original lines 9–32). Leave `computeStartsInDays` and the rest of the file intact. `normalizeDayCoords` is now the imported one and is still called at the original call site.

- [ ] **Step 2: Run the Today suite to verify no regression**

Run: `npm test -- today`
Expected: PASS — existing Today route/helper tests still green.

- [ ] **Step 3: Commit**

```bash
git add src/routes/trips/[slug]/today/+page.server.js
git commit -m "refactor(today): consume shared coord-normalization helpers"
```

---

## Task 3: The offline renderer (`renderOfflineToday`)

**Files:**
- Create: `src/lib/server/render-offline-today.js`
- Test: `tests/render-offline-today.test.js`

The renderer takes a view-model and returns a complete self-contained HTML string.

**View-model shape** (built by the endpoint in Task 4):
```
{
  title: string,
  destination: string,
  generatedAt: Date,
  defaultDay: number,                 // 1-based, generation-time resolved
  days: Array<{
    n: number,
    date: string|null,
    stops: Array<{ name, category, description, hours, address,
                   website, phone, coords:{lat,lng}|null,
                   tips: string[], todos: Array<{text, done}> }>,
    lodging: { name, coords:{lat,lng}|null, booking_url:string|null }|null,
  }>,
  fieldGuideNotes: string[],
  gotchas: string[],
}
```

- [ ] **Step 1: Write the failing tests**

Create `tests/render-offline-today.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { renderOfflineToday } from '../src/lib/server/render-offline-today.js';

function sampleVM(overrides = {}) {
  return {
    title: 'Galena Driftless Weekend',
    destination: 'Galena, IL',
    generatedAt: new Date('2026-06-07T15:30:00Z'),
    defaultDay: 1,
    days: [
      {
        n: 1,
        date: '2026-08-14',
        stops: [
          {
            name: 'Main Street',
            category: 'historic',
            description: 'Preserved storefronts.',
            hours: 'Daily',
            address: 'Main St, Galena, IL',
            website: null,
            phone: null,
            coords: { lat: 42.4168, lng: -90.4287 },
            tips: ['Come early.'],
            todos: [],
          },
          {
            name: 'Galena History Museum',
            category: 'cultural',
            description: '',
            hours: '9am–4:30pm',
            address: '211 S Bench St',
            website: 'https://galenahistory.org',
            phone: '815-555-0142',
            coords: { lat: 42.4153, lng: -90.427 },
            tips: [],
            todos: [{ text: 'Buy tickets', done: false }],
          },
        ],
        lodging: {
          name: 'DeSoto House Hotel',
          coords: { lat: 42.4166, lng: -90.4286 },
          booking_url: 'https://desotohouse.com',
        },
      },
      {
        n: 2,
        date: '2026-08-15',
        stops: [],
        lodging: null,
      },
    ],
    fieldGuideNotes: ['Parking fills by midday.'],
    gotchas: ['Grant Home closed Mon–Tue.'],
    ...overrides,
  };
}

describe('renderOfflineToday', () => {
  it('produces a complete standalone HTML document', () => {
    const html = renderOfflineToday(sampleVM());
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('<style>');
    expect(html).toContain('</html>');
  });

  it('renders the trip title and a synced-as-of banner', () => {
    const html = renderOfflineToday(sampleVM());
    expect(html).toContain('Galena Driftless Weekend');
    expect(html).toMatch(/synced/i);
    expect(html).toContain('2026'); // the generation date appears
  });

  it('renders every day and all stops', () => {
    const html = renderOfflineToday(sampleVM());
    expect(html).toContain('Main Street');
    expect(html).toContain('Galena History Museum');
    expect(html).toContain('data-day="1"');
    expect(html).toContain('data-day="2"');
  });

  it('includes tel:, geo:, Maps, website, and booking links', () => {
    const html = renderOfflineToday(sampleVM());
    expect(html).toContain('tel:8155550142');
    expect(html).toContain('geo:42.4168,-90.4287');
    expect(html).toContain('https://www.google.com/maps/dir/?api=1&destination=42.4168,-90.4287');
    expect(html).toContain('https://galenahistory.org');
    expect(html).toContain('https://desotohouse.com');
  });

  it('omits the Tonight section on a day with no lodging', () => {
    const html = renderOfflineToday(sampleVM());
    // Day 2 has no lodging — exactly one lodging block in the doc (day 1).
    const matches = html.match(/class="lodging-card"/g) || [];
    expect(matches.length).toBe(1);
  });

  it('renders field guide notes and gotchas', () => {
    const html = renderOfflineToday(sampleVM());
    expect(html).toContain('Parking fills by midday.');
    expect(html).toContain('Grant Home closed Mon–Tue.');
  });

  it('escapes HTML in trip-derived content', () => {
    const vm = sampleVM();
    vm.days[0].stops[0].name = 'Tom & Jerry <script>alert(1)</script>';
    const html = renderOfflineToday(vm);
    expect(html).toContain('Tom &amp; Jerry &lt;script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
  });

  it('embeds the default day for the switcher', () => {
    const html = renderOfflineToday(sampleVM({ defaultDay: 2 }));
    expect(html).toContain('data-default-day="2"');
  });

  // The offline invariant: no subresource the browser would fetch on load.
  it('contains no external subresource references', () => {
    const html = renderOfflineToday(sampleVM());
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<link');
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect(html).not.toContain('@import');
    expect(html).not.toMatch(/url\(\s*['"]?https?:/);
    // https:// only ever appears inside <a href="..."> navigation links.
    const httpsCount = (html.match(/https:\/\//g) || []).length;
    const hrefHttpsCount = (html.match(/href="https:\/\//g) || []).length;
    expect(httpsCount).toBe(hrefHttpsCount);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- render-offline-today`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the renderer**

Create `src/lib/server/render-offline-today.js`:

```js
// Pure renderer for the offline Today-view bundle. Returns one self-contained
// HTML document — inlined CSS, inline vanilla-JS day switcher, geo:/tel: links,
// no external subresources. Mirrors the live Today view's content; see
// docs/superpowers/specs/2026-06-07-offline-support-design.md.
//
// Token exception: this generated artifact cannot reference app.css, so it
// inlines literal light-theme color values (simplified single-accent palette).

import { navUrl, telHref, geoHref } from '../today.js';

/** Escape the five HTML-significant characters. */
function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Format a YYYY-MM-DD string as "Weekday, Month D"; '' when missing/invalid. */
function formatDayHeading(dateStr) {
  if (!dateStr) return '';
  const d = new Date(`${dateStr}T00:00:00`);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

/** Format a YYYY-MM-DD string as "Mon D"; '' when missing/invalid. */
function formatShortDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(`${dateStr}T00:00:00`);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function renderStop(stop, destination, index) {
  const number = index + 1;
  const isFirst = index === 0;
  const navHref = navUrl(stop, destination);
  const geo = geoHref(stop.coords, stop.name);
  const callHref = stop.phone ? telHref(stop.phone) : null;

  const meta = [];
  if (stop.hours) {
    meta.push(`<div class="meta-row"><span class="meta-icon">◷</span><span class="meta-value muted">${esc(stop.hours)}</span></div>`);
  }
  if (stop.address) {
    meta.push(`<div class="meta-row"><span class="meta-icon">◎</span><span class="meta-value">${esc(stop.address)}</span></div>`);
  }

  const actions = [
    `<a class="action-btn primary" href="${esc(navHref)}">↗ Navigate</a>`,
  ];
  if (geo) actions.push(`<a class="action-btn" href="${esc(geo)}">⊚ Maps app</a>`);
  if (callHref) actions.push(`<a class="action-btn" href="${esc(callHref)}">☎ Call</a>`);
  if (stop.website) actions.push(`<a class="action-btn" href="${esc(stop.website)}">⤴ Site</a>`);

  const tips = (stop.tips ?? []).map((t) => `<li>${esc(t)}</li>`).join('');
  const todos = (stop.todos ?? [])
    .map((td) => `<li class="${td.done ? 'done' : ''}"><span class="todo-box">${td.done ? '✓' : ''}</span><span>${esc(td.text)}</span></li>`)
    .join('');
  let disclosure = '';
  if (tips || todos) {
    disclosure =
      `<details class="disclosure"><summary>Tips &amp; to-dos</summary>` +
      (tips ? `<ul class="tip-list">${tips}</ul>` : '') +
      (todos ? `<ul class="todo-list">${todos}</ul>` : '') +
      `</details>`;
  }

  return (
    `<article class="stop-card${isFirst ? ' first' : ''}">` +
    `<div class="stop-head"><div class="num${isFirst ? ' num-first' : ''}">${number}</div>` +
    `<div class="stop-title"><h3>${esc(stop.name)}</h3>` +
    `<span class="cat-chip">${esc(stop.category || 'misc')}</span></div></div>` +
    (isFirst ? `<div class="start-here">Start here</div>` : '') +
    (stop.description ? `<p class="description">${esc(stop.description)}</p>` : '') +
    (meta.length ? `<div class="meta">${meta.join('')}</div>` : '') +
    `<div class="actions">${actions.join('')}</div>` +
    disclosure +
    `</article>`
  );
}

function renderLodging(lodging, destination) {
  const navHref = navUrl({ name: lodging.name, coords: lodging.coords ?? null }, destination);
  const booking = lodging.booking_url
    ? `<a class="action-btn" href="${esc(lodging.booking_url)}">⤴ Booking</a>`
    : '';
  return (
    `<div class="section-label">Tonight</div>` +
    `<section class="lodging-card"><span class="moon">☾</span>` +
    `<div class="lodging-body"><p class="lodging-name">${esc(lodging.name)}</p>` +
    `<div class="actions"><a class="action-btn primary" href="${esc(navHref)}">↗ Navigate</a>${booking}</div>` +
    `</div></section>`
  );
}

function renderDay(day, destination) {
  const heading = day.date ? formatDayHeading(day.date) : `Day ${day.n}`;
  const stops = day.stops?.length
    ? `<div class="section-label">Stops</div>` +
      day.stops.map((s, i) => renderStop(s, destination, i)).join('')
    : `<p class="empty-day">No stops planned for this day.</p>`;
  const lodging = day.lodging ? renderLodging(day.lodging, destination) : '';
  return (
    `<section class="day" data-day="${day.n}" data-date="${esc(day.date ?? '')}">` +
    `<div class="day-heading"><h1>${esc(heading)}</h1>` +
    `<p class="day-sub">Day ${day.n} · ${esc(destination)}</p></div>` +
    stops + lodging +
    `</section>`
  );
}

function renderFieldGuide(notes, gotchas) {
  if (!notes.length && !gotchas.length) return '';
  const noteList = notes.length
    ? `<p class="fg-label">Notes</p><ul class="fg-list">${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>`
    : '';
  const gotchaList = gotchas.length
    ? `<p class="fg-label gotcha">Gotchas</p><ul class="fg-list gotcha">${gotchas.map((g) => `<li>${esc(g)}</li>`).join('')}</ul>`
    : '';
  return `<details class="field-guide"><summary>Field guide &amp; gotchas</summary>${noteList}${gotchaList}</details>`;
}

const STYLE = `
:root{color-scheme:light}
*{box-sizing:border-box}
body{margin:0;background:#FCFAF5;color:#112619;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.45}
.wrap{max-width:540px;margin:0 auto;padding:0 16px 48px}
header{padding:14px 16px 8px;max-width:540px;margin:0 auto;border-bottom:1px solid #DCD2BC}
.eyebrow{font-size:11px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:#D87B3F}
.trip-title{font-size:15px;font-weight:600;color:#2D5840;margin:2px 0 0}
.banner{font-size:12.5px;color:#5F5341;background:#F6F1E5;border:1px solid #DCD2BC;border-radius:10px;padding:8px 12px;margin:12px 0}
.day-picker{display:flex;gap:8px;overflow-x:auto;padding:10px 16px;max-width:540px;margin:0 auto}
.day-pill{flex:0 0 auto;min-height:44px;padding:8px 14px;border:1px solid #C9B695;border-radius:999px;background:#F6F1E5;color:#2D5840;font-size:13px;font-weight:600;cursor:pointer}
.day-pill.active{background:#1F4332;border-color:#1F4332;color:#FCFAF5}
.day[hidden]{display:none}
.day-heading{margin:16px 0 4px}
.day-heading h1{font-size:26px;font-weight:600;margin:0 0 4px;line-height:1.2}
.day-sub{font-size:12px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:#5F5341;margin:0}
.section-label{font-size:11px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:#5F5341;margin:22px 0 10px 2px}
.empty-day{color:#5F5341;font-style:italic;margin:22px 0 12px}
.stop-card{background:#F6F1E5;border:1px solid #DCD2BC;border-radius:16px;padding:14px;margin-bottom:12px}
.stop-card.first{border-color:#2D5840;box-shadow:0 0 0 1px #2D5840}
.stop-head{display:flex;gap:12px;align-items:flex-start;margin-bottom:8px}
.num{flex:0 0 auto;width:30px;height:30px;border-radius:50%;background:#EBE0C9;color:#5F5341;font-size:14px;font-weight:600;line-height:30px;text-align:center}
.num-first{background:#2D5840;color:#FCFAF5}
.stop-title{flex:1;min-width:0;display:flex;flex-direction:column;gap:6px}
.stop-title h3{margin:0;font-size:19px;font-weight:600;line-height:1.2}
.cat-chip{align-self:flex-start;font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#5F5341;background:#EBE0C9;padding:4px 8px;border-radius:6px}
.start-here{display:inline-block;margin-bottom:8px;font-size:10px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:#FCFAF5;background:#2D5840;padding:4px 8px;border-radius:999px}
.description{margin:0 0 10px;font-size:14px;color:#2D5840}
.meta{display:grid;gap:6px;margin-bottom:12px}
.meta-row{display:flex;gap:9px;font-size:14px;align-items:flex-start}
.meta-icon{flex:0 0 auto;width:18px;text-align:center;color:#5F5341;font-size:13px}
.meta-value.muted{color:#5F5341;font-style:italic}
.actions{display:flex;gap:8px;flex-wrap:wrap}
.action-btn{flex:1;min-width:96px;display:flex;align-items:center;justify-content:center;gap:5px;min-height:46px;border-radius:11px;border:1px solid #C9B695;background:#F6F1E5;color:#112619;font-size:14px;font-weight:600;text-decoration:none}
.action-btn.primary{background:#2D5840;border-color:#2D5840;color:#FCFAF5}
.lodging-card{background:#F6F1E5;border:1px solid #DCD2BC;border-radius:16px;padding:14px;display:flex;gap:12px;align-items:flex-start;margin-bottom:12px}
.moon{flex:0 0 auto;font-size:20px}
.lodging-body{flex:1;min-width:0}
.lodging-name{font-size:17px;font-weight:600;margin:0 0 10px}
details{background:#F6F1E5;border:1px solid #DCD2BC;border-radius:16px;padding:14px;margin-top:12px}
.stop-card details{background:transparent;border:none;border-top:1px dashed #DCD2BC;border-radius:0;padding:10px 0 0;margin-top:12px}
summary{cursor:pointer;font-weight:600;min-height:44px;display:flex;align-items:center}
.tip-list,.todo-list,.fg-list{margin:10px 0 2px;padding-left:18px;display:grid;gap:8px}
.todo-list{list-style:none;padding-left:0}
.todo-list li{display:flex;gap:9px;align-items:flex-start}
.todo-list li.done span:last-child{color:#5F5341;text-decoration:line-through}
.todo-box{flex:0 0 auto;width:17px;height:17px;border:1.5px solid #9A8A6F;border-radius:5px;text-align:center;line-height:15px;font-size:12px;color:#FCFAF5}
.todo-list li.done .todo-box{background:#2D5840;border-color:#2D5840}
.tip-list li,.fg-list li{font-size:13.5px;color:#2D5840}
.fg-label{font-size:11px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:#5F5341;margin:16px 0 8px}
.fg-label.gotcha,.fg-list.gotcha li{color:#8D4C24}
footer{text-align:center;font-size:12px;color:#5F5341;margin-top:24px}
`;

// Inline switcher: pills toggle .day visibility; on load, resolve the current
// day against the device clock (mirrors resolveCurrentDay), else default-day.
const SCRIPT = `
(function(){
  var root=document.getElementById('app');
  var days=[].slice.call(document.querySelectorAll('.day'));
  var pills=[].slice.call(document.querySelectorAll('.day-pill'));
  function show(n){
    days.forEach(function(d){ d.hidden = d.getAttribute('data-day')!==String(n); });
    pills.forEach(function(p){ p.classList.toggle('active', p.getAttribute('data-day')===String(n)); });
  }
  pills.forEach(function(p){ p.addEventListener('click', function(){ show(p.getAttribute('data-day')); }); });
  function todayStr(){ var d=new Date(); var m=String(d.getMonth()+1).padStart(2,'0'); var dd=String(d.getDate()).padStart(2,'0'); return d.getFullYear()+'-'+m+'-'+dd; }
  function resolve(){
    var t=todayStr();
    var dated=days.map(function(d){return d.getAttribute('data-date');}).filter(Boolean).sort();
    for(var i=0;i<days.length;i++){ if(days[i].getAttribute('data-date')===t) return days[i].getAttribute('data-day'); }
    if(dated.length){ if(t>dated[dated.length-1]) return days[days.length-1].getAttribute('data-day'); }
    return root.getAttribute('data-default-day');
  }
  show(resolve());
})();
`;

/**
 * Render the offline Today bundle as a self-contained HTML document.
 * @param {object} vm  View-model (see plan / spec).
 * @returns {string}
 */
export function renderOfflineToday(vm) {
  const synced = vm.generatedAt.toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
  const pills = vm.days
    .map((d) => {
      const short = formatShortDate(d.date);
      const label = short ? `Day ${d.n} · ${esc(short)}` : `Day ${d.n}`;
      return `<button class="day-pill" data-day="${d.n}">${label}</button>`;
    })
    .join('');
  const dayHtml = vm.days.map((d) => renderDay(d, vm.destination)).join('');
  const fg = renderFieldGuide(vm.fieldGuideNotes ?? [], vm.gotchas ?? []);

  return (
    `<!doctype html>\n<html lang="en">\n<head>` +
    `<meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>Today — ${esc(vm.title)} · Traverse (offline)</title>` +
    `<style>${STYLE}</style></head>` +
    `<body><div id="app" data-default-day="${vm.defaultDay}">` +
    `<header><div class="eyebrow">Traverse · Today</div>` +
    `<p class="trip-title">${esc(vm.title)}</p></header>` +
    `<nav class="day-picker">${pills}</nav>` +
    `<div class="wrap">` +
    `<p class="banner">Offline copy · synced ${esc(synced)} — re-download if you change the plan.</p>` +
    dayHtml + fg +
    `<footer>Read-only offline snapshot · Traverse</footer>` +
    `</div></div>` +
    `<script>${SCRIPT}</script></body></html>`
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- render-offline-today`
Expected: PASS (all cases, including the no-external-subresources invariant).

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/render-offline-today.js tests/render-offline-today.test.js
git commit -m "feat(offline): add self-contained Today-view HTML renderer"
```

---

## Task 4: The download endpoint

**Files:**
- Create: `src/routes/trips/[slug]/today/offline/+server.js`
- Test: `tests/offline-endpoint.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/offline-endpoint.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the data layer so no filesystem is needed.
vi.mock('../src/lib/server/data.js', () => ({
  rejectInvalidSlug: (slug) =>
    /^[a-z0-9-]+$/.test(slug) ? null : new Response('bad', { status: 400 }),
}));

const deriveBrochure = vi.fn();
vi.mock('../src/lib/server/derive-brochure.js', () => ({
  deriveBrochure: (slug) => deriveBrochure(slug),
}));

import { GET } from '../src/routes/trips/[slug]/today/offline/+server.js';

function brochure() {
  return {
    title: 'Galena Driftless Weekend',
    destination: 'Galena, IL',
    field_guide_notes: ['note'],
    gotchas: ['gotcha'],
    days: [
      { n: 1, date: '2026-08-14', stops: [
        { name: 'Main Street', category: 'historic', description: '', hours: '', address: 'Main St',
          website: null, phone: null, coords: [42.4, -90.4], tips: [], todos: [] },
      ], lodging: null },
    ],
  };
}

beforeEach(() => deriveBrochure.mockReset());

describe('GET /trips/[slug]/today/offline', () => {
  it('returns an HTML attachment with a slug-based filename', async () => {
    deriveBrochure.mockReturnValue(brochure());
    const res = await GET({ params: { slug: 'galena-illinois' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    expect(res.headers.get('content-disposition')).toBe(
      'attachment; filename="galena-illinois-today.html"',
    );
    const body = await res.text();
    expect(body).toMatch(/^<!doctype html>/i);
    expect(body).toContain('Main Street');
  });

  it('404s when the trip has no plan', async () => {
    deriveBrochure.mockReturnValue(null);
    const res = await GET({ params: { slug: 'no-plan' } });
    expect(res.status).toBe(404);
  });

  it('rejects an invalid slug before deriving', async () => {
    const res = await GET({ params: { slug: 'Bad Slug!' } });
    expect(res.status).toBe(400);
    expect(deriveBrochure).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- offline-endpoint`
Expected: FAIL — endpoint module does not exist.

- [ ] **Step 3: Implement the endpoint**

Create `src/routes/trips/[slug]/today/offline/+server.js`:

```js
import { rejectInvalidSlug } from '$lib/server/data.js';
import { deriveBrochure } from '$lib/server/derive-brochure.js';
import { renderOfflineToday } from '$lib/server/render-offline-today.js';
import { resolveCurrentDay, normalizeDayCoords } from '$lib/today.js';

export async function GET({ params }) {
  const invalid = rejectInvalidSlug(params.slug);
  if (invalid) return invalid;

  const brochure = deriveBrochure(params.slug);
  if (!brochure) return new Response('No plan to take offline', { status: 404 });

  const days = brochure.days.map(normalizeDayCoords);
  const defaultDay = resolveCurrentDay(days, new Date());

  const html = renderOfflineToday({
    title: brochure.title,
    destination: brochure.destination ?? '',
    generatedAt: new Date(),
    defaultDay,
    days,
    fieldGuideNotes: brochure.field_guide_notes ?? [],
    gotchas: brochure.gotchas ?? [],
  });

  return new Response(html, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'content-disposition': `attachment; filename="${params.slug}-today.html"`,
    },
  });
}
```

Note: `params.slug` is already validated by `rejectInvalidSlug` to the `[a-z0-9-]` set, so it is safe in the filename without further sanitization.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- offline-endpoint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/trips/[slug]/today/offline/+server.js tests/offline-endpoint.test.js
git commit -m "feat(offline): add Today-view download endpoint"
```

---

## Task 5: "Save for offline" button in the Today header

**Files:**
- Modify: `src/routes/trips/[slug]/today/+page.svelte`

- [ ] **Step 1: Add the link to the header**

In `src/routes/trips/[slug]/today/+page.svelte`, inside `.header-top` (after the `.header-title-block` `</div>`, before the closing `</div>` of `.header-top`), add:

```svelte
        <a
          class="offline-btn"
          href="/trips/{data.trip._slug}/today/offline"
          download
          aria-label="Save this trip's Today view for offline use"
        >⤓ Save offline</a>
```

- [ ] **Step 2: Add styles**

In the `<style>` block, after the `.header-title-block` rules, add (the header is a flex row — push the button to the right with `margin-left:auto`):

```css
  .offline-btn {
    margin-left: auto;
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    min-height: 44px;
    padding: 0 12px;
    border: 1px solid var(--border-default);
    border-radius: 999px;
    background: var(--surface-raised);
    color: var(--text-secondary);
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 600;
    text-decoration: none;
    white-space: nowrap;
  }

  .offline-btn:hover,
  .offline-btn:focus-visible {
    background: var(--surface-sunken);
    border-color: var(--border-strong);
  }

  .offline-btn:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }
```

- [ ] **Step 3: Verify with svelte-check**

Run: `npm run check`
Expected: 0 errors, 0 warnings.

- [ ] **Step 4: Commit**

```bash
git add src/routes/trips/[slug]/today/+page.svelte
git commit -m "feat(offline): add Save-for-offline button to Today header"
```

---

## Task 6: "Save offline copy" entry in the detail ⋯ menu

**Files:**
- Modify: `src/routes/trips/[slug]/+page.svelte`

- [ ] **Step 1: Add the menu item**

In `src/routes/trips/[slug]/+page.svelte`, in the Output-group construction, the Today-view item is pushed under `if (data.plan?.days?.length)`. Immediately after that `outputItems.push({... '📍 Today view' ...})` block (after its closing `});`, still inside the same `if`), add a second push:

```js
      outputItems.push({
        type: 'link',
        label: '📥 Save offline copy',
        href: `/trips/${encodeURIComponent(slug)}/today/offline`,
        download: true,
      });
```

- [ ] **Step 2: Confirm the menu renders the `download` attribute**

Check how link items render in the menu markup (search this file for where `outputItems`/`groups` are iterated and `item.href` is bound). If the link element does not already pass through a `download` attribute, add `download={item.download}` to that `<a>` so the attribute is emitted when present. (Svelte omits the attribute when the value is falsy/undefined, so existing items are unaffected.)

- [ ] **Step 3: Verify with svelte-check**

Run: `npm run check`
Expected: 0 errors, 0 warnings.

- [ ] **Step 4: Commit**

```bash
git add src/routes/trips/[slug]/+page.svelte
git commit -m "feat(offline): add Save-offline-copy item to detail menu"
```

---

## Task 7: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full go/no-go**

Run: `npm run verify`
Expected: svelte-check 0/0, all tests pass (including the three new suites), build succeeds.

- [ ] **Step 2: Manual smoke (optional but recommended)**

Start the dev server on a free port and download the bundle for a seeded trip:

```bash
npm run dev -- --port 3458 &
sleep 3
curl -sS -D - http://localhost:3458/trips/galena-illinois/today/offline -o /tmp/galena-today.html | grep -i 'content-disposition'
grep -c 'data-day=' /tmp/galena-today.html   # expect the day count
grep -ci 'https://' /tmp/galena-today.html    # all should be inside <a href>
```

Open `/tmp/galena-today.html` in a browser with the network disabled to confirm it renders and the day switcher works.

- [ ] **Step 3: Commit any fixes, then finish the branch**

Use superpowers:finishing-a-development-branch to open the PR.

---

## Self-Review

**Spec coverage:**
- One self-contained `.html` per trip, all days → Task 3 (`renderDay` over `vm.days`) + Task 4. ✓
- Zero external references (enforced) → Task 3 invariant test. ✓
- In-file day switcher, default-day resolved against device clock → Task 3 `SCRIPT` + `data-default-day`. ✓
- Synced-as-of banner → Task 3 (`.banner`). ✓
- Content mirrors Today view (stops/meta/tips/todos, lodging+booking, field guide) → Task 3. ✓
- `tel:` + Maps + **`geo:`** + website links → Task 1 (`geoHref`) + Task 3 actions. ✓
- Addresses/phones as selectable text → rendered in `.meta` / visible link text. ✓
- `renderOfflineToday(brochureData,{generatedAt})` pure renderer → Task 3. ✓
- `GET /trips/[slug]/today/offline` with attachment + filename + 404 on no-plan → Task 4. ✓
- Two affordances (Today header + ⋯ menu) → Tasks 5, 6. ✓
- Drift control via shared `deriveBrochure` + no-external-refs snapshot → Tasks 2/3. ✓
- Edge cases (no lodging, no phone/website, escaping, filename safety) → Task 3 + Task 4 tests. ✓
- PWA deferred → documented in spec; no task (correct). ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code. ✓

**Type/name consistency:** `renderOfflineToday(vm)` view-model fields (`title`, `destination`, `generatedAt`, `defaultDay`, `days`, `fieldGuideNotes`, `gotchas`) match between Task 3 and the Task 4 endpoint builder. `normalizeDayCoords`/`resolveCurrentDay`/`geoHref`/`navUrl`/`telHref` names match across Tasks 1–4. ✓

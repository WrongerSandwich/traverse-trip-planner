# Test patterns

The vitest suite is the authoritative spec for several modules (see CLAUDE.md "the test suite is authoritative"). This doc captures the conventions a route-handler test follows so new tests don't reinvent shape every time.

## Route handler tests — the pattern

A SvelteKit route handler is just a function: `GET({ url, params, request })`, `POST({ params, request })`, etc. Tests construct synthetic event objects and call the handler directly — no HTTP layer, no `fetch`, no SvelteKit runtime.

### 1. Stub `@sveltejs/kit`

Replace `json()` and `error()` so we can inspect response shapes synchronously:

```js
vi.mock('@sveltejs/kit', () => ({
  json: (body, init = {}) => ({ _body: body, _status: init.status ?? 200 }),
  error: (status, msg) => { throw Object.assign(new Error(msg), { status }); },
}));
```

When a handler returns a raw `Response` (e.g. ICS, 404 strings), don't stub — let it through and read `res.status` / `await res.text()` instead.

### 2. Mock filesystem with `vi.hoisted`

```js
const { mockExistsSync, mockReadFileSync } = vi.hoisted(() => ({
  mockExistsSync: vi.fn(),
  mockReadFileSync: vi.fn(),
}));

vi.mock('node:fs', () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
  writeFileSync: vi.fn(),
  // …whatever else the handler uses
}));

// Mirror the mock under 'fs' too — some files use bare 'fs'.
vi.mock('fs', () => ({ existsSync: mockExistsSync, readFileSync: mockReadFileSync, /* … */ }));
```

The `vi.hoisted` block hoists alongside `vi.mock`, so the mock fns exist when the module under test is loaded.

### 3. Mock `$lib/server/*` selectively

Only mock the parts your handler touches. Examples:

```js
vi.mock('$lib/server/data.js', () => ({
  ROOT: '/test-root',
  findTripLocation: vi.fn(),
  parseFrontmatter: vi.fn(),
  // …
}));

vi.mock('$lib/server/jobs.js', () => ({
  listJobs: vi.fn(() => []),
  listRecentEvents: vi.fn(() => []),
}));
```

Real data.js, jobs.js, etc. are well-tested elsewhere — your route test should focus on the handler's wiring, not their internals.

### 4. Import the handler **after** the mocks

`vi.mock` is hoisted, so a top-of-file `import` is fine. If the handler uses top-level side effects that conflict, switch to dynamic import:

```js
const { POST } = await import('../src/routes/api/.../+server.js');
```

### 5. Build synthetic events

```js
function makeEvent({ params = {}, url = new URLSearchParams(), body } = {}) {
  return {
    params,
    url: { searchParams: url instanceof URLSearchParams ? url : new URLSearchParams(url) },
    request: { json: async () => body },
  };
}
```

Inline this helper per-file rather than sharing it — different handlers want different event shapes (form data, headers, etc.) and a shared helper grows warts.

### 6. Reset between tests

```js
beforeEach(() => {
  vi.clearAllMocks();
  // re-seed any default-state mocks here
});
```

Standardize on `vi.clearAllMocks()` over per-mock `mockReset()` — clearer intent, fewer escape hatches.

## What every route test should cover

At minimum, three cases per handler:

1. **Happy path** — valid inputs, downstream returns expected shape, handler returns 200/202 with the documented body.
2. **Validation failure** — required input missing or malformed → 400 (or whatever the handler documents). Confirm downstream is **not** called.
3. **Downstream failure** — the data/jobs/AI dependency throws or returns null → handler maps to the right status (404 / 409 / 5xx) and **does not** leak the raw error to the client.

For handlers that mutate state (POST, PUT, DELETE), also test:

4. **Idempotence** if the documented contract claims it.
5. **Side-effect assertions** — confirm `writeFileSync` / `renameSync` / `startJob` was called with the expected arguments.

## Cache-touching tests

The disk-backed caches (`.geocode-cache.json`, `.image-cache.json`, `.route-cache.json`, `.workflow-stats.json`) write to the cwd. Tests that exercise the real cache module must either:

- Mock the cache module (`vi.mock('$lib/server/data.js', () => ({ ... }))`), OR
- Write to a per-test temp dir (`fs.mkdtempSync` + `process.chdir` in `beforeEach`, restore in `afterEach`).

Don't let two parallel tests touch the same cache file.

## Patterns to avoid

- **Don't `import` the real `chat()`** — it makes network calls. Mock `$lib/server/ai.js` and return canned `{ text, usage }` objects.
- **Don't rely on global `fetch`** — if a handler uses `fetch`, mock `globalThis.fetch` and restore it in `afterEach`.
- **Don't assert on log output** — `console.warn` / `console.error` calls aren't part of the contract.
- **Don't share module-level state** between tests — fresh mocks per `beforeEach`.

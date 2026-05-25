# Jobs source of truth

> **Status: shipped.** All five follow-up tickets landed (#375, #376, #377, #378, #379 — see `git log --grep="(#375|#376|#377|#378|#379)"`). This doc stays in place as the architectural reference for the registry; the source comments under `src/lib/server/jobs.js`, `src/hooks.server.js`, and the deepen routes link back here. Treat the **Current behavior**, **Decision space**, and **Migration sketch** sections as historical; the **Implications for related work** and **Open questions** sections describe what's now live.

Design doc for [#355](https://github.com/WrongerSandwich/traverse-trip-planner/issues/355) — picking one source of truth for in-flight Ambient Background job state.

## Current behavior

`src/lib/server/jobs.js` maintains two parallel representations of job state:

1. **In-memory `Map`** (`jobs.js:62`), keyed `${workflow}:${slug}`. Each entry holds `{ workflow, slug, startedAt, controller: AbortController, opts }`. Authoritative for live state.
2. **Per-trip frontmatter `running:` flag** (written by `writeRunningFlag()`, `jobs.js:121–129`; cleared by `clearRunningFlag()`, `jobs.js:131–147`). Written on every `startJob` / `completeJob` / `failJob` via an `atomicWrite()` rewrite of `overview.md`.

On boot, `sweepStaleJobs()` (`jobs.js:346–406`) scans every trip's frontmatter for a `running:` flag whose containing file is older than 10 minutes (`maxAgeMinutes`). For each match it removes the flag and writes `last_run_aborted: true` + `last_run_aborted_at: <iso>` to the frontmatter. Wired in `src/hooks.server.js:168` via `setImmediate(() => sweepStaleJobs())`.

## The unexpected readership picture

Tracing every consumer of the disk side:

| Field | Written by | Read by |
|---|---|---|
| `jobs` Map | `startJob`, `completeJob`, `failJob` (`jobs.js:165, 184, 223`) | `listJobs()` → `/api/jobs` GET → `BackgroundJobsIndicator` + `TripJobBadge` (10s poll on the home page, `+page.svelte:135`); `assertNotRunning()`; `cancelJob()` |
| frontmatter `running:` | every `startJob` / `completeJob` / `failJob` | **`sweepStaleJobs()` only**, at boot |
| frontmatter `last_run_aborted` / `last_run_aborted_at` | `sweepStaleJobs()` only | **nobody** (verified by `git grep last_run_aborted` — only its own writer and tests assert on the disk shape) |
| frontmatter `last_run_error` / `last_run_error_at` / `last_run_message` | `failJob` | `lastRunFailed` derived store on the trip detail page (`+page.svelte:240–253`) drives the "last background job failed" banner |
| frontmatter `last_run_success_at` / `last_run_tokens` | `completeJob` | currently informational only; clears stale failure context |

The disk side of the duplication is **write-only in normal operation**. Every job transition costs one atomic rewrite of `overview.md` to maintain a flag whose only reader runs once per boot. And the field that reader writes (`last_run_aborted`) is itself never consumed by any UI surface — despite `docs/ai-workflow-ux.md:319` documenting it as the post-restart recovery signal ("The UI shows these as failed jobs with code `cancelled`"). The contract is half-implemented: the disk write happens, the UI wiring doesn't.

So the "10-minute disk lie" the ticket worries about is invisible to users — no surface consults the lying flag. The drift is real but harmless because the drifted value isn't read.

## Decision space

The original ticket's three options were framed around the assumption that the disk side is consulted in normal operation. Once you account for the readership picture, the option space narrows and shifts:

### Option A — Frontmatter-as-truth (original ticket Option 1)

Reduce in-memory state to `Map<key, AbortController>` for the cancel path; everything else reads disk. Survives restarts cleanly, no sweep needed.

**Rejected.** The 10s poll path (`listJobs()`) would have to read N frontmatter files per call instead of one in-memory iteration. For a personal-scale tool with 5–20 trips this is bounded, but it's still a permanent perf tax to solve a problem the current architecture doesn't actually have (no UI consumes the lying flag). Also: `assertNotRunning` would become a disk read on every action click — a tiny per-click overhead but a new failure mode (file read errors mid-decision).

### Option B — Status quo with the gap honestly named

Keep the dual representation. Document that `last_run_aborted` is dead-letter state, accept the per-transition write tax as the cost of the recovery hint. No code changes.

**Rejected.** This leaves the codebase in a state where the most-touched code path (every action route) carries dead weight. New contributors reading `jobs.js` and the ticket-mentioned "10-minute lie" rightly worry about it; the design is unprincipled.

### Option C — Recommended: central `.jobs.json` + promote `last_run_aborted` to a real signal

Three coordinated changes:

1. **Delete the per-trip `running:` flag.** `startJob` / `completeJob` / `failJob` stop touching trip frontmatter for the running-state purpose. They keep writing `last_run_error*` / `last_run_success_at` / `last_run_tokens` since those *are* consumed by the trip detail page.
2. **Persist the registry to `.cache/.jobs.json`** as a single file. Same schema as `listJobs()` returns today: `[{ workflow, slug, startedAt, est_seconds? }, ...]`. Written via `atomicWrite()` (the existing helper) on every `startJob` / `completeJob` / `failJob`. Lives under `.cache/` alongside the other disk-backed state for the same Docker bind-mount reason (`CLAUDE.md` "Frontend" section).
3. **Promote `last_run_aborted` into a real banner signal.** On boot, the sweep reads `.cache/.jobs.json`, marks each listed trip with `last_run_error: 'interrupted'` + `last_run_error_at: <jobs.json's startedAt or now>` + `last_run_message: 'Server restarted mid-job.'`, then deletes `.cache/.jobs.json`. The existing `lastRunFailed` derived store + banner picks this up with zero new UI — only a new error-registry entry for the `interrupted` code.

Why this combo:

- **One write target per transition** instead of one per trip. Same number of writes as today (~2 per job lifecycle), but to a single file. No `invalidateEnrichCache()` needed since `.jobs.json` isn't part of trip data.
- **`listJobs()` stays in-memory** — no perf regression on the 10s poll.
- **The recovery signal becomes user-visible.** The half-finished contract from `docs/ai-workflow-ux.md` is completed: a restart-aborted job surfaces in the same banner as any other failure, with a sentence that names the cause.
- **Clean separation of concerns.** Trip frontmatter carries historical state about the trip (errors that happened, last successful run); the central file carries the registry of what was in flight when the process died. Two different lifetimes, two different stores.

### Option D — Delete the disk side entirely

Drop `running:`, drop `sweepStaleJobs()`, drop `last_run_aborted` — no recovery story. After a restart, the in-memory map is empty, the badge disappears silently, the user retries if they notice.

**Considered, rejected.** Marginally simpler than (C) but loses the half-built signal `ai-workflow-ux.md` already documents. Given the cost of (C) is one new file and one new error-registry entry, the user-visible benefit (a banner explains the gap rather than gaslighting them) is worth it.

## Migration sketch

`.cache/.jobs.json` is a new file. The migration concern is trips that have a `running:` flag in frontmatter from before this change lands — those flags will sit on disk indefinitely without the sweep that currently clears them.

**One-time legacy sweep at boot.** Keep `sweepStaleJobs()`'s scan logic, but limit it to: scan trip frontmatter for `running:`, remove the flag, write `last_run_error: 'interrupted'` (same path as the new `.jobs.json`-based recovery). After one boot post-deploy on a given install, no more `running:` flags exist anywhere; the legacy scan does nothing on subsequent boots but stays in place as a safety net for at least one release cycle.

The age-threshold guard (`maxAgeMinutes`, 10 minutes default) can go — its purpose was to avoid clobbering in-progress writes from another process, but a single-instance Node server can't race itself, and the sweep runs before any request is served (`setImmediate` after `printConfigBanner()` in `hooks.server.js`).

**`clearStaleResearchingFlags()` in `hooks.server.js:142–157`** is independent and can be retired in the same change. The migration to `startJob` for deepen is complete (per the test at `tests/api-deepen.test.js:203–208` asserting deepen never writes `researching:`); the function exists only to clean legacy flags from old installs and is now in the same category as the legacy `running:` sweep.

## Implications for related work

- **`sweepStaleJobs()` doesn't go away — it changes shape.** New role: read `.cache/.jobs.json`, mark those trips' frontmatter, delete the file. Plus the one-release-cycle legacy frontmatter scan. The 10-minute threshold disappears.
- **`recentEvents` ring buffer (`jobs.js:73`)** stays in memory. It's already documented as transient and the indicator UI tolerates losing it across restarts.
- **No interaction with [#354](https://github.com/WrongerSandwich/traverse-trip-planner/issues/354)** (cache unification) anymore — `.jobs.json` joins the `.cache/` directory but is structurally different from the cache files (volatile state, not a memoization layer). If #354 lands post-launch and chooses SQLite, `.jobs.json` could fold into a `jobs` table at that time; until then it stays a one-purpose file with its own atomic write.
- **Errors registry** gets one new entry (`interrupted`) for the post-restart sentence. Wording proposal: *"A previous research job was interrupted by a server restart. Try re-running it."*

## Follow-up implementation tickets

1. **Implement central `.jobs.json` registry.** Modify `startJob` / `completeJob` / `failJob` in `jobs.js` to persist to `.cache/.jobs.json` instead of per-trip frontmatter. Update tests in `tests/jobs.test.js`. This is the bulk of the work.
2. **Rewire `sweepStaleJobs()` for the new shape.** Read `.jobs.json`, write `last_run_error: 'interrupted'` to listed trips, delete the file. Keep a legacy scan for one release to drain `running:` flags from old installs. Update `tests/jobs.test.js:463–506`.
3. **Add `interrupted` to the errors registry** with the recovery sentence. Confirm the existing `lastRunFailed` derived store + banner surface it correctly.
4. **Retire `clearStaleResearchingFlags()`** in `hooks.server.js:142–157` and its associated boot log. Independent of the above but natural to bundle.
5. **Update `docs/ai-workflow-ux.md:319`** to match the implemented behavior (currently aspirational).

Each ticket should be small enough to land independently; ordering matters only for (2) which depends on (1) being deployed first to populate `.jobs.json`.

## Open questions

- **Error code name.** `'interrupted'` reads cleanly; `'server_restart'` is more specific but more technical. The banner already uses sentence-case prose so the code is mostly internal. Picking `'interrupted'` in this doc — easy to change in implementation if the prose suggests otherwise.
- **Should the `interrupted` banner persist after the user runs a new (successful) job?** The existing `completeJob` already clears `last_run_error*` on success (`jobs.js:207`), so yes — same semantics as any other failure. No new code.
- **`.jobs.json` location.** Picked `.cache/` for the bind-mount consistency, but it's semantically not a cache — it's volatile registry state. The alternative is a sibling location like `.runtime/`. Sticking with `.cache/` for now: one directory to mount, one mental model. Revisit if the directory accumulates more not-actually-caches.

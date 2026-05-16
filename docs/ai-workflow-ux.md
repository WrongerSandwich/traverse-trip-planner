# AI Workflow UX — rubric

This document defines the UX rules every AI-driven workflow in Traverse follows. It exists because today's workflows accreted ticket-by-ticket: Seed and Add use an ActionPanel, Deepen is fire-and-forget with a 4s poll, Chat is inline, Retro is a modal, Brochure prep is another ActionPanel. Each made local sense; together they have no rules.

The rubric defines four **archetypes**, the **promise/cost** the user sees before triggering, the **failure recovery** they see after, and the **background-status surface** that survives navigation. New AI workflows pick an archetype; existing workflows migrate to one. Deviations are allowed but must be written down here.

---

## 1. The four archetypes

| Archetype | Wall-clock | Result location | User attention |
|---|---|---|---|
| **Instant Inline** | <15s | At the trigger | User waits at trigger |
| **In-Page Stream** | 15–60s | Streamed into page body | User watches it materialize |
| **Ambient Background** | 20s–2min+ | New artifact or in-place edit | User free to navigate away |
| **Conversational / Modal** | Multi-turn | At end of flow | User drives the pace |

The axis is **result location + attention model**, not wall-clock alone. Wall-clock matters but is a soft signal: Brochure prepare (30–60s) and Deepen (60–120s) both belong to Ambient Background because the user shouldn't be blocked at a screen for either.

### When to pick which

- **Instant Inline** if the user *expects an immediate result* (chat reply, idea cards appearing, a regeocode pass). Failure means trying again right there.
- **In-Page Stream** if the *materialization is part of the value* (e.g. a future "Generate prose introduction" action where watching the output materialize is the experience). The user being present to watch is intentional, not incidental.
- **Ambient Background** if the action takes long enough that staring at it would be tedious *and* the produced artifact is fine to discover later (Brochure prep, Deepen-section, Deepen). The user can leave and come back; the global indicator tells them when it's done.
- **Conversational / Modal** if the *user produces input across multiple steps* (Retro's questionnaire; a future "Plan a trip from scratch" wizard). One AI call per step or per turn; the structure is the wizard, not the AI.

Workflows close to a boundary go to the *longer/more-tolerant* archetype. A 12-second action whose result is a separate doc is better as Ambient Background than as Instant Inline — the user gains the ability to navigate at the cost of slightly more ceremony.

---

## 2. Per-archetype UX spec

Each archetype has a fixed in-progress, success, and failure envelope. Workflows can override individual properties with a stated reason in the inventory mapping (§7), not silently.

### 2.1 Instant Inline

| State | Surface |
|---|---|
| **Trigger** | Button with a tooltip showing the [short promise](#3-the-promise-sentence). |
| **In-progress** | The trigger button itself becomes the spinner — disabled, label switches to the verb's *-ing* form ("Generating ideas…"). No global indicator. No corner panel. |
| **Power-user details** | A collapsed `<details>` disclosure below the trigger reveals the SSE event log. Closed by default. |
| **Success** | Result appears in place — new cards animate in, modal closes, etc. A transient toast confirms what happened ("✓ 5 ideas added"); auto-dismisses after ~4s. |
| **Failure** | Inline error envelope by the trigger: bold sentence (from the [failure recovery contract](#5-failure-recovery-contract)) + recovery affordance buttons. Trigger re-enabled. |
| **Cancel** | Not standard. Actions are short; cancel adds clutter for little gain. |

### 2.2 In-Page Stream

| State | Surface |
|---|---|
| **Trigger** | Button + confirm modal (the long promise lives in the modal body). |
| **In-progress** | A header banner appears at the top of the page section being produced (amber accent). Banner contains: title ("Generating…"), estimated time remaining, **Cancel** button. The body below streams text as it arrives. Body is read-only while streaming. |
| **Success** | Banner switches to green ("✓ Generated · 12.4k tokens"). Body retains the produced content. Action transitions to the produced state (Regenerate affordance now available). |
| **Failure** | Banner switches to red with the failure sentence. Partial stream is discarded — the user's existing content is untouched. Recovery affordances appear in the banner. |
| **Cancel** | Always available during in-progress. Cancelled = same state as failure but with code `cancelled` and "Dismiss" as the only affordance. |

### 2.3 Ambient Background

The defining archetype: **the user starts something and can navigate away.** Progress survives page transitions, tab close, and (with caveats — see §8) server restart.

| State | Surface |
|---|---|
| **Trigger** | Button + confirm modal with the long promise. The confirm explicitly tells the user "you can navigate away while this runs." |
| **In-progress** | Three places, all sourced from server state: (a) **global pill** in the top app-bar shows job count; click to open the **jobs drawer**; (b) **per-trip badge** on the trip card (home page) and trip detail header — "Preparing brochure…" or similar; (c) the trigger button is disabled with hover text "Already running — see indicator". |
| **Success** | A toast appears (top-right, near the global pill) — "✓ Brochure ready · Hannibal Mississippi · [Open]". Per-trip badge and pill clear. If the user is on the affected trip's page, the new artifact appears in-place with a brief highlight. |
| **Failure** | The pill turns red with a *sticky* "1 failed" state; clears only when the user dismisses the failure or opens the relevant trip. Failure toast appears with recovery affordances from the contract. |
| **Cancel** | Available in the jobs drawer (per-job cancel button). Cancellation is server-side — the route's `AbortController` aborts the in-flight model call. |

#### The jobs drawer

Click the global pill to open. Each in-flight job has a row showing:

- Trip name + workflow type (e.g. "Hannibal · Brochure")
- Elapsed time + estimated remaining
- Cancel button

Empty state: drawer doesn't open from the pill if there are no jobs. When the last job finishes, the pill returns to idle (or hidden, see §6).

### 2.4 Conversational / Modal

For multi-step user-driven flows (Retro today; future wizards).

Conversational uses a bespoke per-flow modal shell; no shared primitive —
`RetroModal.svelte` is the reference implementation. If a second
Conversational workflow surfaces, evaluate then whether the shared shape is
worth extracting.

| State | Surface |
|---|---|
| **Trigger** | Button opens a modal that takes over the screen. Step indicator at top (5 segments for Retro). |
| **In-progress** | Each step has its own loading state — the *step* shows a spinner if a model call is happening. The modal doesn't show a global progress for the whole flow. |
| **Success** | Final step completes; modal closes; the produced state appears on the underlying page. |
| **Failure** | Per-step error envelope inside the modal. Recovery: either retry the step or close the modal entirely (with a confirmation if mid-flow). |
| **Cancel** | Closing the modal mid-flow = abandon. Confirmation if work has been entered. |

---

## 3. The promise sentence

Every AI trigger declares upfront **what it produces, how long it takes, and roughly what it costs**.

### Two surfaces

**Short form — tooltip on the trigger button** (required on every AI trigger):
```
{verb} · ~{time} · ~{tokens}
```
Example: `Prepare brochure · ~45s · 2–4k tokens`

**Long form — confirm modal body** (rendered inside the existing `src/lib/components/ConfirmModal.svelte`) or an info-icon popover next to the trigger (where no confirm exists):
```
{What it produces in one sentence}. ~{time}. ~{tokens}.
```
Example:
> Prepare brochure will analyze your planning sections and produce a structured brochure draft — stops, lodging, field guide notes, and gotchas — that you can review before saving.
>
> Typically ~45s · 2–4k tokens.

### Source of truth

Each action route exports a `_promise` object: `{ verb, produces, time_seconds, tokens_range }`. The hand-tuned defaults live in `src/lib/server/promises.js` (keyed by `chat()` label) and each route re-exports its slot as `_promise`. The UI consumes the resolved shape; the prose template lives once in `src/lib/components/PromiseTooltip.svelte` (short form) / `src/lib/components/PromiseBody.svelte` (long form).

**Telemetry-driven calibration.** `chat()` in `src/lib/server/ai.js` records start/end timestamps + token totals against the call's `label` on every invocation. `src/lib/server/workflow-stats.js` aggregates the rolling window (max 50 samples per label, 14-day retention) and computes p10/p50/p90. At page-load time, `src/routes/+layout.server.js` calls `getResolvedPromises()` which overlays telemetry on the hand defaults and ships `data.promises` to the client.

Fallback rules — telemetry is ignored and the hand default passes through when:

- Fewer than 10 samples have been recorded for that label (`MIN_SAMPLES`).
- The rolling p50 deviates more than 2x from the hand default in either direction (`DRIFT_RATIO`) — drift this large is a signal that the prompt / model / tool loop changed and the hand default needs a human re-tune. A `[workflow-stats] drift: ...` warning is logged.

Persistence: `.workflow-stats.json` at the repo root, debounced flush on every record, loaded on first call after restart.

Debug view: `GET /api/workflow-stats` returns the current aggregated per-label stats plus the active configuration constants.

---

## 4. Cost transparency

Three moments, **tokens not dollars**. Tokens are the honest unit; dollars require currency selection, pricing per provider, and budgeting UI that we don't want to build right now.

| Moment | Surface | Example |
|---|---|---|
| **Before** | Promise sentence (above) | `~2–4k tokens` |
| **During** | Hidden | Live token count would be noise. SSE log behind a details disclosure for power users. |
| **After** | Success toast / banner | `✓ Brochure ready · 3.2k tokens` |

For **multi-turn workflows** (Conversational / Modal), tokens are aggregated across the flow and shown once on the closing success state. Per-step costs are not surfaced — they'd be noise.

**Out of scope** for this design: cumulative usage view, dollar conversions, budgeting alerts, per-provider breakdowns. File a separate ticket if/when wanted.

---

## 5. Failure recovery contract

Every `TraverseError` code maps to a **(user sentence, recovery affordances)** pair. The mapping lives in `src/lib/server/errors.js` alongside the `TraverseError` class. UI components import and render from the registry — no inline catch sentences anywhere.

### The registry

```js
// src/lib/server/errors.js
export const ERROR_REGISTRY = {
  empty_model_output: {
    sentence: 'The model returned no usable output. Try again, or switch providers if it keeps happening.',
    affordances: ['retry', 'switch_provider'],
  },
  geocode_quota: {
    sentence: 'Geocoding is rate-limited right now. Try again in a minute.',
    affordances: ['retry', 'dismiss'],
  },
  provider_error: {
    sentence: '{provider} returned an error: {summary}. Retry, or switch providers.',
    affordances: ['retry', 'switch_provider'],
    interpolate: ['provider', 'summary'],
  },
  timeout: {
    sentence: 'This took longer than expected and was cancelled. Retry, or try a faster model.',
    affordances: ['retry', 'switch_provider'],
  },
  invalid_input: {
    sentence: '{reason}. Edit the trip and try again.',
    affordances: ['edit'],
    interpolate: ['reason'],
  },
  file_conflict: {
    sentence: '{artifact} already exists. Delete or rename it to redo.',
    affordances: ['open_file', 'dismiss'],
    interpolate: ['artifact'],
  },
  cancelled: {
    sentence: 'Cancelled.',
    affordances: ['dismiss'],
  },
  network_error: {
    sentence: "Couldn't reach the model. Check your connection and retry.",
    affordances: ['retry'],
  },
};

export const AFFORDANCES = ['retry', 'switch_provider', 'edit', 'dismiss', 'open_file'];
```

### Affordance semantics

| Affordance | Behavior |
|---|---|
| `retry` | Re-trigger the same action with the same inputs. |
| `switch_provider` | Open the settings provider selector with the relevant context pre-loaded. After switching, returns to where the user was. |
| `edit` | Navigate to the underlying editable surface (planning page section, frontmatter file, etc.). |
| `dismiss` | Clear the error state. No retry. |
| `open_file` | Open the filesystem path mentioned in the error (e.g. the conflicting `notes.md`). |

### Testability

The registry is a pure JS object. A single unit test asserts:

1. Every `TraverseError` code thrown anywhere in `src/` has an entry.
2. Every affordance referenced is in the `AFFORDANCES` enum.
3. Every `interpolate:` key is referenced by `{name}` in the sentence template.

This is the failure-recovery pattern's "independently testable" hook called out in the source ticket.

---

## 6. Background-status surface

The home for Ambient Background's progress signal. Three components:

### 6.1 Global pill — top app-bar

Lives in the site header on every page. States:

- **Hidden** when no jobs are running and no recent failures. (No idle pill — keeps the chrome quiet.)
- **Amber, pulsing** with job count when ≥1 job is running. Click toggles the jobs drawer.
- **Red, sticky** with failed count when ≥1 job has failed since the last navigation. Clears when the user dismisses the failure or opens the affected trip.

### 6.2 Per-trip badge

On the trip card (home page) and the trip detail header, when a job is running *for that specific trip*:

- Small inline label: "Preparing brochure…" / "Researching…" / "Deepening Stops…"
- Clears when the job completes.
- Multiple jobs for one trip = stacked badges.

### 6.3 Jobs drawer

Opens from the global pill. One row per in-flight job:

- Trip name + workflow type
- Elapsed / estimated remaining
- Per-job cancel button (per §2.3)

Drawer auto-closes when the last job finishes.

### Server-state convergence

The pill, badges, and drawer all read from the same server-state source: an in-memory job registry on the SvelteKit server, mirrored to frontmatter flags (e.g. `running: 'brochure'`) for survival across server restart (see §8). The frontend polls on a slow interval (10s) and on navigation; SSE updates from a running job push state synchronously when the user has the relevant page open.

### 6.4 Job-key convention (multi-instance workflows)

The in-memory registry in `src/lib/server/jobs.js` keys live jobs as `${workflow}:${slug}`. Both args are opaque — the only invariant is that the pair is unique per concurrent job. Two patterns:

**Single-instance** (one job of this type per trip at a time):

```js
// Brochure prepare — at most one in flight per trip.
startJob('brochure', slug);                      // key: 'brochure:<slug>'
assertNotRunning('brochure', slug);
```

**Multi-instance** (multiple concurrent jobs of this type per trip):

Encode the discriminator in the **workflow** arg as `'<workflow>:<discriminator>'`. Leave the slug arg clean. Example: deepen-section runs one job per section, so route, stops, and logistics for one trip can stream simultaneously.

```js
// Deepen-section — one job per (trip, section) tuple.
const workflow = `deepen-section:${section}`;    // e.g. 'deepen-section:stops'
startJob(workflow, slug);                        // key: 'deepen-section:stops:<slug>'
assertNotRunning(workflow, slug);
```

**Why discriminator-in-workflow, not in-slug:**

- `TripJobBadge`'s filter (`filterJobsForSlug` in `src/lib/utils/jobLabels.js`) does an exact `j.slug === slug` match. Keeping the slug clean means the per-trip badge surfaces every concurrent job for a trip without prefix-handling.
- The frontmatter `running:` flag carries the full workflow string (e.g. `running: 'deepen-section:stops'`), which the restart sweep and out-of-band debugging can read directly.
- `/api/jobs` and `/api/jobs/cancel` accept the composite workflow string without API changes.

**Label rendering** in `jobLabel()` (`src/lib/utils/jobLabels.js`) and `BackgroundJobsIndicator`'s `WORKFLOW_LABELS` strip a `:<discriminator>` suffix before lookup, so `'deepen-section:stops'` resolves to the same label and time estimate as `'deepen-section'`. New multi-instance workflows register their bare-workflow label once.

The discriminator format is the caller's choice (section name, stop index, etc.); pick something stable and human-readable so the frontmatter `running:` flag and any debug logs stay legible. **Do not** invert this and pack the discriminator into the slug arg — that would break `filterJobsForSlug` silently.

---

## 7. Inventory mapping

Every existing workflow is assigned an archetype. **Deviations** from the archetype defaults are listed explicitly with the reason.

| Workflow | Archetype | Deviations |
|---|---|---|
| **Seed** | Instant Inline | — |
| **Add destination** | Instant Inline | — |
| **Chat turn** | Instant Inline | Lives in a sidebar instead of a button-as-spinner. *Reason:* Chat is a sustained interaction surface, not a one-shot trigger; the sidebar is the persistent UI. The per-turn loading state still follows Instant Inline (input disabled, spinner inline). |
| **Brochure regeocode** | Instant Inline | — |
| **Brochure prepare** | Ambient Background | Currently uses ActionPanel; migrating drops it onto the global indicator. The confirm modal stays — it carries the long promise. |
| **Deepen-section** | Ambient Background | Currently uses ActionPanel; same migration as Brochure prepare. |
| **Deepen** | Ambient Background | Already navigable. Migration replaces the ad-hoc 4s home-page poll + frontmatter `researching:` flag with the unified global indicator + standard job state. |
| **Retro** | Conversational / Modal | — |
| **Receipts** | Instant Inline | Multimodal upload action on completed trips; today uses local `$state` for `idle / uploading / done / error`. Alignment work: consume the failure recovery registry, add the promise sentence, fold inline parsed-lines output into the success state. |

Notable migration: **the current `ActionPanel` (bottom-right corner log) has no home in the rubric and is retired.** Its only legitimate use today is the power-user SSE log, which becomes an opt-in details disclosure inside whichever archetype the workflow lives in.

---

## 8. Edge cases

| Edge case | Handling |
|---|---|
| **Already running, second start attempted** | Trigger button is disabled with hover text "Already running — see global indicator". Server-side, the action route returns **409 Conflict** if a job of the same type for the same trip is already in flight. Source of truth: server state (frontmatter `running:` flag for ambient jobs; in-memory map keyed by `<workflow>:<slug>` for short ones). |
| **Tab close mid-action** | *Ambient Background:* job continues server-side; resume on next page load via server state. *In-Page Stream / Instant Inline / Conversational:* SSE disconnect aborts the in-flight model call via `AbortController`; partial output is discarded. |
| **Multi-tab simultaneous starts** | Tab B sees Tab A's running job because the global indicator pulls from server state on each navigation/poll. If Tab B attempts to start a duplicate, it hits the same 409. No special cross-tab coordination needed beyond server-state convergence. |
| **Server restart mid-job** | On boot, a sweep scans frontmatter for `running:` flags older than N minutes (default: 10) and clears them, recording `last_run_aborted: true` with timestamp. The UI shows these as failed jobs with code `cancelled` and "Retry" as the recovery affordance. In-memory short-action state is lost on restart but those actions are short enough that the user almost certainly already saw success or failure. |
| **Provider switched mid-job** | The in-flight job uses the provider it was started with — the `chat()` call has already locked into that adapter. The promise sentence shown at trigger time reflected that provider's typical timing/cost. Subsequent jobs use the new provider. No special handling needed; documented as expected behavior. |

---

## 9. Followup implementation tickets

Each is independently shippable. Recommended order is roughly top-to-bottom but most can parallelize after the foundation tickets land.

### Foundation

1. **Failure recovery registry** — Add `ERROR_REGISTRY` + `AFFORDANCES` to `src/lib/server/errors.js`. Add new codes (`provider_error`, `timeout`, `invalid_input`, `file_conflict`, `cancelled`, `network_error`). Unit test asserts no orphaned codes or affordances.
2. **WorkflowStatus primitive** — A shared Svelte component that takes `{ state, sentence, affordances }` and renders the appropriate envelope. Consumed by every archetype.
3. **Global indicator + jobs drawer** — `src/lib/components/BackgroundJobsIndicator.svelte` + drawer. Top-app-bar mount. Backed by `/api/jobs` returning server-state.
4. **Per-trip badge** — `src/lib/components/TripJobBadge.svelte`. Renders on trip cards and detail headers when a job exists for the trip.
5. **Server-side job registry** — In-memory map keyed by `<workflow>:<slug>` + frontmatter `running:` flag mirror. Includes the server-restart sweep.

### Per-workflow migrations

6. **Migrate Seed to Instant Inline** — Retire ActionPanel for Seed. Button-as-spinner. Toast on success.
7. **Migrate Add destination to Instant Inline** — Same shape as Seed.
8. **Migrate Chat to Instant Inline** — Deviation captured in §7. Minimal changes; ensure spinner placement is consistent.
9. **Migrate Brochure regeocode to Instant Inline** — Retire its ActionPanel usage.
10. **Migrate Brochure prepare to Ambient Background** — Biggest change. Introduce server-state job tracking. Move from ActionPanel to global indicator + per-trip badge. The confirm modal stays; long promise goes in its body.
11. **Migrate Deepen-section to Ambient Background** — Same shape as Brochure prepare.
12. **Migrate Deepen to Ambient Background** — Replace 4s poll + `researching:` flag with unified indicator integration. The fire-and-forget shape is preserved; the surface changes.
13. **Align Retro with Conversational archetype** — Mostly already aligned. Audit step error handling and ensure cancel-mid-flow confirmation exists.

### Cross-cutting

14. **Promise sentence integration** — Add `promise` export to every action route. Tooltip + confirm-modal-body component. Hand-calibrated initial estimates.
15. **Cost transparency surfacing** — Token cost on success toast / banner across all archetypes. Drop dollar conversions.
16. **Retire ActionPanel** — Once all workflows have migrated, delete `src/lib/components/ActionPanel.svelte` and the SSE log helpers it owns. The power-user details disclosure moves into per-archetype components.
17. **CLAUDE.md update** — Update the "In-browser actions" section to reflect the new archetypes and the global indicator. New AI workflows reference this rubric.

---

## Success criteria

- A new agent picking up any of the implementation tickets can answer "what archetype does this belong to?" by reading §1 and §7 of this doc, without asking.
- Disagreements during implementation are resolved by re-reading the rubric, not by re-litigating the design.
- The failure recovery contract has a unit test that passes.
- After all migrations land, the four archetypes are the only AI workflow shapes in the codebase — no remaining ad-hoc patterns.

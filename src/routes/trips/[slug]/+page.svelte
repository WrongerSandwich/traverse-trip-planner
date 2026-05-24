<script>
  import { renderMarkdown } from '$lib/sanitize.js';
  import { untrack } from 'svelte';
  import { invalidateAll, goto, beforeNavigate } from '$app/navigation';
  import { onMount } from 'svelte';
  import TripMap from '$lib/components/TripMap.svelte';
  import RetroModal from '$lib/components/RetroModal.svelte';
  import ConfirmModal from '$lib/components/ConfirmModal.svelte';
  import PromiseTooltip from '$lib/components/PromiseTooltip.svelte';
  import AffordanceButtons from '$lib/workflow-status/AffordanceButtons.svelte';
  import { failureSentence, ERROR_REGISTRY } from '$lib/errors-registry.js';
  import { formatTokens } from '$lib/utils/formatTokens.js';
  import TripJobBadge from '$lib/components/TripJobBadge.svelte';
  import { receiptsErrorFromStatus } from '$lib/utils/receiptsErrors.js';
  import { tripColor } from '$lib/utils/colors.js';
  import { focusTrap } from '$lib/actions/focusTrap.js';
  import { filterJobsForSlug } from '$lib/utils/jobLabels.js';
  import { isSectionsDirty } from '$lib/utils/sectionDirty.js';
  import { browser } from '$app/environment';
  import KebabMenu from '$lib/components/KebabMenu.svelte';
  import CoverPhotoModal from '$lib/components/CoverPhotoModal.svelte';
  import FieldGuidePalette from '$lib/components/FieldGuidePalette.svelte';
  import SectionDiffOverlay from '$lib/components/SectionDiffOverlay.svelte';
  import CandidatesSection from '$lib/components/CandidatesSection.svelte';
  import PlanSection from '$lib/components/PlanSection.svelte';

  let { data } = $props();

  // ── Background jobs polling (10s interval) for the per-trip badge ──
  let allJobs = $state([]);

  $effect(() => {
    if (!browser) return;
    let cancelled = false;
    async function fetchJobs() {
      try {
        const res = await fetch('/api/jobs');
        if (!cancelled && res.ok) {
          const body = await res.json();
          allJobs = body.jobs ?? [];
        }
      } catch { /* network blip — keep stale state */ }
    }
    fetchJobs();
    const timer = setInterval(fetchJobs, 10_000);
    return () => { cancelled = true; clearInterval(timer); };
  });

  const tripJobs = $derived(filterJobsForSlug(allJobs, trip?._slug ?? ''));

  const SECTION_LABELS = {
    overview: 'Overview',
    route: 'Route',
    stops: 'Stops',
    logistics: 'Logistics',
    plan: 'Plan',
    candidates: 'Candidates',
    itinerary: 'Itinerary',
    notes: 'Notes',
  };

  // Sections render under an H2 set by the page chrome; strip any leading H1
  // (e.g. `# Stops`) from the markdown body so the heading isn't shown twice.
  // Only strips single-# H1 — leaves ## H2 and deeper intact.
  function stripLeadingH1(md) {
    return (md || '').replace(/^\s*#(?!#)\s+[^\n]*\n+/, '');
  }

  // Canonical section sets per stage (itinerary handled separately above the list).
  // Completed trips include plan + candidates so the user can still see what they
  // built — the components render read-only via the `readonly` prop below.
  //
  // `stops` is no longer in planning's canonical list: Research stopped writing
  // stops.md once plan.md + candidates.md took over, and the prose blob became
  // redundant alongside the structured Plan/Candidates surfaces. Legacy stops.md
  // files are still rendered for planning trips, but as a collapsed disclosure
  // below the canonical sections — see the `legacy-stops` block in the template.
  //
  // Order: Plan and Candidates sit adjacent because they're a single workflow
  // (drag from Candidates onto a Plan day; the day picker references Plan
  // structure). Logistics sits at the end as reference material — the user
  // reads it before/during the trip, not while building the plan.
  const STAGE_SECTIONS = {
    planning:  ['overview', 'route', 'plan', 'candidates', 'logistics'],
    completed: ['overview', 'route', 'stops', 'plan', 'candidates', 'logistics', 'notes'],
  };

  const trip = $derived(data.trip);
  const stage = $derived(data.stage);
  const isPlanning = $derived(stage === 'planning');
  const isCompleted = $derived(stage === 'completed');
  const planExtractionFailed = $derived(data.planExtractionFailed ?? false);

  // Local section content state, seeded from server load. Edits live here
  // until saved — intentionally initial-only (don't re-sync on every load),
  // so untrack() to silence the "captures initial value" lint.
  let sections = $state(untrack(() => ({ ...data.files })));

  // Per-section UI state
  let editing = $state({});      // { route: true, ... }
  let drafts  = $state({});      // staging textareas while editing
  let saving  = $state({});
  let completing = $state(false);

  // True when any open draft differs from the saved section content.
  // Cancel explicitly resets the draft to the saved value before exiting,
  // so this returns false after a clean cancel.
  const isDirty = $derived(isSectionsDirty(drafts, sections));

  // ── Navigation guard (dirty draft protection) ──
  let navGuardOpen    = $state(false);
  let pendingNav      = $state(/** @type {null | (() => void)} */ (null));
  let skipNavGuardOnce = $state(false);

  beforeNavigate((nav) => {
    if (skipNavGuardOnce) {
      skipNavGuardOnce = false;
      return;
    }
    if (!isDirty) return;
    nav.cancel();
    pendingNav = () => {
      skipNavGuardOnce = true;
      nav.to?.url ? goto(nav.to.url) : history.back();
    };
    navGuardOpen = true;
  });

  function confirmNavDiscard() {
    const fn = pendingNav;
    pendingNav = null;
    navGuardOpen = false;
    fn?.();
  }
  function cancelNavDiscard() {
    pendingNav = null;
    navGuardOpen = false;
  }

  // beforeunload guard: fires on page refresh, tab close, or true exits.
  // Browsers require a synchronous return value — no async confirm possible.
  // Only registers the handler while a draft is actually dirty.
  $effect(() => {
    if (!browser) return;
    if (!isDirty) return;
    function handleBeforeUnload(e) {
      e.preventDefault();
      // Modern browsers ignore the string but require returnValue to be set.
      e.returnValue = 'You have unsaved section edits. Leave anyway?';
      return e.returnValue;
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  });

  // ── Confirm modal ──
  let confirmOpen  = $state(false);
  let confirmOpts  = $state({});
  let confirmResolve = null;

  function showConfirm(opts) {
    if (confirmResolve) confirmResolve(false); // resolve any stranded caller
    return new Promise(resolve => {
      confirmResolve = resolve;
      confirmOpts    = opts;
      confirmOpen    = true;
    });
  }

  // ── Section research (deepen-section) — Ambient Background archetype ──
  // The route returns 202 immediately; global indicator + per-trip badge
  // surface progress. The confirm modal carries the long-form promise.

  // Refresh sections when nav causes a new load (rarely, but safe).
  $effect(() => { sections = { ...data.files }; });

  const markerColor = $derived(tripColor(trip));

  const driveLabel = $derived(
    trip?._drive_hours != null
      ? `${trip._drive_hours % 1 === 0 ? trip._drive_hours : trip._drive_hours.toFixed(1)} hr`
      : null
  );

  const canonicalSections = $derived(STAGE_SECTIONS[stage] ?? STAGE_SECTIONS.planning);

  // Overview soft cap (Phase 5 task 5.1). Prompt-side instructs the model to
  // keep overview prose to ~3 sentences, but legacy overviews on disk can be
  // far longer. Soft-cap the rendered view at the first paragraph when the
  // raw text exceeds ~500 chars; the file on disk is never truncated.
  let overviewExpanded = $state(false);
  const overviewRaw = $derived(sections.overview ?? '');
  const overviewIsLong = $derived(overviewRaw.length > 500);
  const overviewDisplay = $derived(
    overviewExpanded || !overviewIsLong
      ? overviewRaw
      : overviewRaw.split(/\n\n+/)[0]
  );

  // Route soft cap. The page-level map is the primary visual element for
  // the route; the prose below is editorial annotation only — the deepen
  // prompts ask for ≤2 sentences scenic-only notes, so new routes won't
  // trip this cap. The cap remains as a graceful fallback for legacy
  // routes (turn-by-turn writeups from earlier prompt versions), which
  // collapse to their first paragraph until the user re-researches.
  let routeExpanded = $state(false);
  const routeRaw = $derived(sections.route ?? '');
  const routeIsLong = $derived(routeRaw.length > 300);
  const routeDisplay = $derived(
    routeExpanded || !routeIsLong
      ? routeRaw
      : routeRaw.split(/\n\n+/)[0]
  );

  // Referential-integrity check: plan.md may reference candidate ids that
  // no longer exist in candidates.md (e.g. after a direct file edit). The
  // server load computes the dangling set; render a banner near the top of
  // the page so the user knows to resolve them manually.
  const danglingMessages = $derived(
    (data.dangling ?? []).map((id) =>
      ERROR_REGISTRY.dangling_candidate_id.sentence.replace('{candidate_id}', id)
    )
  );

  // Surface a failed background run that wasn't followed by a success. The
  // jobs module clears these fields on next successful run, so seeing them
  // here means the last completed job for this trip failed and the user
  // never got a visible signal — the dropped EACCES / provider_error etc.
  // is the classic "silent error" surface this banner exists to fix.
  const lastRunFailed = $derived.by(() => {
    const code = trip?.last_run_error;
    if (!code) return null;
    const failedAt = trip?.last_run_error_at;
    const succeededAt = trip?.last_run_success_at;
    if (failedAt && succeededAt && failedAt < succeededAt) return null;
    return {
      code,
      at: failedAt ?? null,
      message: trip?.last_run_message ?? null,
    };
  });
  const lastRunFailedSentence = $derived(
    lastRunFailed ? failureSentence(lastRunFailed.code, {}) : ''
  );
  /** Human-relative timestamp ("3 minutes ago", "2 days ago"). */
  function relativeTime(iso) {
    if (!iso) return '';
    const ms = Date.now() - new Date(iso).getTime();
    if (!Number.isFinite(ms) || ms < 0) return '';
    const sec = Math.floor(ms / 1000);
    if (sec < 60) return `${sec}s ago`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const day = Math.floor(hr / 24);
    return `${day}d ago`;
  }

  // Show the "Research this section →" button when the feature is enabled,
  // the trip is in planning, and the section is a researchable type.
  // (stops is intentionally absent — see STAGE_SECTIONS comment above.)
  const RESEARCHABLE = new Set(['route', 'logistics']);
  const canResearchSection = $derived(
    stage === 'planning' &&
    Boolean(data.features?.deepen) &&
    data.features?.homeMdReady !== false
  );

  // Mirror of src/routes/api/actions/deepen-section/.../+server.js _promise
  // export, used as a synchronous fallback when `data.promises` isn't
  // populated. Telemetry-resolved values come from
  // `data.promises['deepen-section']` (see src/lib/server/promises.js).
  const DEEPEN_SECTION_FALLBACK = {
    verb: 'Research section',
    produces: 'One trip section (route, stops, or logistics) written from web-searched current information. You can navigate away while it runs.',
    time_seconds: 60,
    tokens_range: [2000, 4000],
  };
  const DEEPEN_SECTION_PROMISE = $derived(
    data.promises?.['deepen-section'] ?? DEEPEN_SECTION_FALLBACK,
  );

  // True when any deepen-section job is running for this trip (any section).
  const deepenSectionRunning = $derived(
    tripJobs.some(j => j.workflow?.startsWith('deepen-section:')),
  );

  // Trigger invalidateAll() when a tripJobs entry disappears between polls —
  // that means an Ambient Background job for this trip (deepen-section)
  // finished or failed and its file was written. Without this the user has
  // to manually refresh to see the new section content.
  // The set comparison handles the multi-job case (one finishes while another
  // is still running) without firing on job starts.
  let prevJobKeys = new Set();
  $effect(() => {
    const currKeys = new Set(tripJobs.map(j => j.workflow));
    for (const k of prevJobKeys) {
      if (!currKeys.has(k)) {
        invalidateAll();
        break;
      }
    }
    prevJobKeys = currKeys;
  });

  let deepenSectionError = $state(/** @type {{code: string, ctx?: object}|null} */ (null));

  // Generic action-error banner for handlers that don't own a per-section
  // surface (section save, mark completed, share enable/disable, archive).
  // Shape: { code: string, ctx?: object } or null. Routes through
  // failureSentence() per the project convention (no inline catch strings).
  let actionError = $state(/** @type {null | {code: string, ctx?: object}} */ (null));
  function dismissActionError() { actionError = null; }

  async function researchSection(section) {
    if (deepenSectionRunning) return;
    const ok = await showConfirm({
      title: `Research ${section} section?`,
      promise: DEEPEN_SECTION_PROMISE,
      confirmLabel: 'Research in background',
    });
    if (!ok) return;
    deepenSectionError = null;
    try {
      const res = await fetch(
        `/api/actions/deepen-section/${encodeURIComponent(trip._slug)}/${encodeURIComponent(section)}`,
        { method: 'POST' },
      );
      if (res.status === 409) {
        deepenSectionError = { code: 'already_running' };
        return;
      }
      if (!res.ok && res.status !== 202) {
        deepenSectionError = { code: 'action_failed' };
        return;
      }
      // 202 Accepted — refresh jobs poll immediately so the per-trip badge appears.
      try {
        const jobsRes = await fetch('/api/jobs');
        if (jobsRes.ok) {
          const body = await jobsRes.json();
          allJobs = body.jobs ?? [];
        }
      } catch { /* the 10s poll will pick it up */ }
    } catch {
      deepenSectionError = { code: 'network_error' };
    }
  }

  function startEdit(section) {
    drafts[section] = sections[section] ?? '';
    editing[section] = true;
  }

  function cancelEdit(section) {
    // Reset to saved value before deleting so isDirty goes false cleanly,
    // preventing the beforeNavigate guard from firing after an explicit cancel.
    drafts[section] = sections[section] ?? '';
    editing[section] = false;
    delete drafts[section];
  }

  async function saveEdit(section) {
    saving[section] = true;
    try {
      const res = await fetch(
        `/api/trip/${encodeURIComponent(trip._slug)}/${encodeURIComponent(section)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: drafts[section] }),
        }
      );
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      sections[section] = drafts[section];
      editing[section] = false;
      delete drafts[section];
    } catch (err) {
      console.error(err);
      actionError = { code: 'save_failed' };
    } finally {
      saving[section] = false;
    }
  }

  // ── Field guide palette ──
  // Cmd-K opens the palette; per-section Ask buttons also target it. Send
  // routes to /api/trip/[slug]/chat and edits land as in-section
  // SectionDiffOverlay banners on the affected sections (commit 4 of the
  // chat → palette migration retired the side-panel chat for good).
  let paletteOpen = $state(false);
  let paletteScope = $state(/** @type {{ kind: 'trip' } | { kind: 'section', section: string }} */ ({ kind: 'trip' }));
  let paletteBusy = $state(false);
  let paletteErrorSentence = $state(/** @type {string | null} */ (null));
  /** Abort controller for the in-flight palette request, mirroring the chat
   *  pattern — lets Cancel actually interrupt the server-side write. */
  let paletteAbort = $state(/** @type {AbortController | null} */ (null));
  /** Conversation history for Refine across turns. Cleared when the user
   *  dismisses the post-edit chip. */
  let paletteThread = $state(/** @type {{ role: 'user' | 'assistant', content: string }[]} */ ([]));

  /** Per-section pending edit: { before, after, reply, turnAt, outOfDate }.
   *  Sections with an entry render via SectionDiffOverlay instead of the
   *  normal markdown body until the user clicks Accept or Revert. In-memory
   *  only — the model writes the new content to disk at the API call;
   *  Revert is a window of opportunity that closes on page reload. */
  let pendingEdits = $state(/** @type {Record<string, { before: string, after: string, reply: string, turnAt: number, outOfDate: boolean }>} */ ({}));

  function openPalette(section = null) {
    if (!isPlanning) return;
    paletteScope = section ? { kind: 'section', section } : autoScopeForViewport();
    paletteErrorSentence = null;
    paletteOpen = true;
  }
  function closePalette() {
    paletteOpen = false;
    paletteErrorSentence = null;
  }
  function widenPaletteScope() {
    paletteScope = { kind: 'trip' };
  }

  // Pick whichever section is most-centered in the viewport at Cmd-K time.
  // Trip-wide fallback when no section header is in view.
  function autoScopeForViewport() {
    if (!browser) return { kind: 'trip' };
    const viewH = window.innerHeight;
    let best = null;
    let bestDist = Infinity;
    for (const section of canonicalSections) {
      const el = document.getElementById(`section-${section}`);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      // Skip sections entirely off-screen.
      if (rect.bottom < 0 || rect.top > viewH) continue;
      const center = rect.top + rect.height / 2;
      const dist = Math.abs(center - viewH / 2);
      if (dist < bestDist) {
        bestDist = dist;
        best = section;
      }
    }
    return best ? { kind: 'section', section: best } : { kind: 'trip' };
  }

  async function handlePaletteSubmit(value) {
    if (paletteBusy) return;
    paletteErrorSentence = null;
    // Append the user turn to the running thread (Refine carries history
    // forward across turns until the post-edit chip is dismissed).
    paletteThread = [...paletteThread, { role: 'user', content: value }];

    paletteBusy = true;
    const controller = new AbortController();
    paletteAbort = controller;

    try {
      const res = await fetch(
        `/api/trip/${encodeURIComponent(trip._slug)}/chat`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: paletteThread }),
          signal: controller.signal,
        }
      );
      const body = await res.json().catch(() => ({}));

      // User cancelled mid-flight — drop the optimistic user turn so the
      // thread doesn't carry a question that never got an answer.
      if (res.status === 499 || body?.error === 'cancelled') {
        paletteThread = paletteThread.slice(0, -1);
        return;
      }

      if (!res.ok) {
        paletteErrorSentence = failureSentence(body.error || 'network_error', body.context || {});
        // Roll back the optimistic turn since the model never answered it,
        // otherwise a Retry would send the question twice.
        paletteThread = paletteThread.slice(0, -1);
        return;
      }

      const reply = body.reply || '(no reply)';
      const updates = body.updates || {};
      const turnAt = Date.now();

      // Record per-section pending edits BEFORE mutating local sections so
      // the "before" snapshot is the pre-turn content. If a section already
      // has a pending edit from a previous turn, mark the old one as
      // out-of-date (its snapshot now predates the current on-disk state
      // by more than one turn — reverting would clobber intermediate work).
      const nextPending = { ...pendingEdits };
      for (const [section, after] of Object.entries(updates)) {
        for (const [k, v] of Object.entries(nextPending)) {
          if (k === section && !v.outOfDate) nextPending[k] = { ...v, outOfDate: true };
        }
        nextPending[section] = {
          before: sections[section] ?? '',
          after,
          reply,
          turnAt,
          outOfDate: false,
        };
      }
      pendingEdits = nextPending;

      // Apply the writes locally so the in-section overlay can diff against
      // the new content. The server already wrote to disk; this just keeps
      // the page in sync without a full invalidateAll() round-trip.
      for (const [section, content] of Object.entries(updates)) {
        sections[section] = content;
        if (editing[section]) {
          editing[section] = false;
          delete drafts[section];
        }
      }
      // Refresh server-loaded data (frontmatter waypoints, drive hours, etc.)
      // so the trip card meta and map reflect any overview-frontmatter edits.
      if (Object.keys(updates).length > 0) await invalidateAll();

      paletteThread = [...paletteThread, { role: 'assistant', content: reply }];

      if (Object.keys(updates).length > 0) {
        // Edit landed — close the palette; the post-edit chip + section
        // banners carry the rest of the flow.
        paletteOpen = false;
      } else {
        // Conversational reply only — keep the palette open with the reply
        // surfaced so the user can Refine or Esc out.
        // (Reply surface is rendered inside FieldGuidePalette via lastReply.)
      }
    } catch (err) {
      if (err?.name === 'AbortError') {
        paletteThread = paletteThread.slice(0, -1);
        return;
      }
      paletteErrorSentence = failureSentence('network_error');
      paletteThread = paletteThread.slice(0, -1);
    } finally {
      paletteBusy = false;
      paletteAbort = null;
    }
  }
  function handlePaletteCancel() {
    paletteAbort?.abort();
  }

  // Most recent assistant reply for the conversational-only path. Surfaced
  // inside the palette below the input when no <update> blocks landed.
  const paletteLastReply = $derived.by(() => {
    if (paletteThread.length === 0) return null;
    const last = paletteThread[paletteThread.length - 1];
    return last.role === 'assistant' ? last.content : null;
  });

  // ── Pending-edit chip + Accept / Revert ──────────────────────────────────
  const pendingSections = $derived(Object.keys(pendingEdits));
  const pendingHasFresh = $derived(pendingSections.some(s => !pendingEdits[s].outOfDate));
  /** The most recent turn's reply (for the post-edit chip label). */
  const pendingChipReply = $derived.by(() => {
    let mostRecent = null;
    for (const s of pendingSections) {
      const p = pendingEdits[s];
      if (!mostRecent || p.turnAt > mostRecent.turnAt) mostRecent = p;
    }
    return mostRecent?.reply ?? '';
  });

  function acceptEdit(section) {
    const next = { ...pendingEdits };
    delete next[section];
    pendingEdits = next;
  }
  async function revertEdit(section) {
    const pending = pendingEdits[section];
    if (!pending) return;
    try {
      const res = await fetch(
        `/api/trip/${encodeURIComponent(trip._slug)}/${encodeURIComponent(section)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: pending.before }),
        }
      );
      if (!res.ok) {
        // Surface inside the section banner via a transient error sentence —
        // for now, leave the pending edit so the user can retry.
        actionError = { code: 'revert_failed' };
        return;
      }
      sections[section] = pending.before;
      const next = { ...pendingEdits };
      delete next[section];
      pendingEdits = next;
      // Drop the now-stale palette thread so a Refine doesn't reference
      // the reverted turn.
      paletteThread = [];
      await invalidateAll();
    } catch {
      actionError = { code: 'revert_failed' };
    }
  }

  function refineFromChip() {
    // Re-open palette in trip-wide scope (the previous edit might span
    // multiple sections; scope is conversational from here on).
    paletteScope = { kind: 'trip' };
    paletteErrorSentence = null;
    paletteOpen = true;
  }
  function dismissChip() {
    // Accept any still-pending edits and clear the thread. Edits the user
    // already explicitly accepted are gone; this is the "I'm done with this
    // turn, my edits stand" sweep.
    pendingEdits = {};
    paletteThread = [];
  }

  function scrollToFirstPending() {
    if (!browser || pendingSections.length === 0) return;
    const el = document.getElementById(`section-${pendingSections[0]}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Cmd-K (Mac) / Ctrl-K (Win/Linux) opens the palette from anywhere on a
  // planning trip detail page. Respects text-input focus so the shortcut
  // doesn't fight section editors.
  $effect(() => {
    if (!browser || !isPlanning) return;
    function onKey(e) {
      const isModK = (e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K');
      if (!isModK) return;
      // Don't hijack Cmd-K when a textarea has focus (section editing).
      const t = e.target;
      if (t instanceof HTMLTextAreaElement) return;
      e.preventDefault();
      if (paletteOpen) closePalette();
      else openPalette();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  // One-shot cleanup of the old chat-panel localStorage history — the panel
  // is gone now (commit 4 of the chat → palette migration); leaving the
  // stale blob around just gradually eats per-domain storage. Safe to
  // remove this cleanup later once the rollout is well in the past.
  $effect(() => {
    if (!browser || !trip?._slug) return;
    try { localStorage.removeItem(`traverse-chat-${trip._slug}`); } catch { /* ignore */ }
  });

  // ── Complete ──
  async function completeTrip() {
    if (!trip || completing) return;
    const label = trip.title || trip._slug;
    const ok = await showConfirm({
      title:        `Mark "${label}" as completed?`,
      body:         "It'll move out of planning into the completed archive.",
      confirmLabel: 'Mark as completed',
      danger:       false,
    });
    if (!ok) return;
    completing = true;
    try {
      const res = await fetch(`/api/complete/${encodeURIComponent(trip._slug)}`, { method: 'POST' });
      if (!res.ok) throw new Error(`Complete failed: ${res.status}`);
      // Stay on the trip page (now in completed/) so the retro prompt can fire.
      await goto(`/trips/${encodeURIComponent(trip._slug)}?just-completed=1`, { invalidateAll: true });
    } catch (err) {
      console.error(err);
      actionError = { code: 'action_failed', ctx: { action: 'mark the trip as completed' } };
    } finally {
      completing = false;
    }
  }

  // ── Re-research ──
  // Ambient Background archetype: fires the deepen endpoint on an already-
  // promoted planning trip. The handler accepts two 409 shapes:
  //   plan_prose_present → show destructive confirm; retry with ?force=true
  //   already_running    → surface as actionError
  let reResearching = $state(false);

  // Mirror of the deepen _promise for the confirm-modal tooltip.
  const DEEPEN_FALLBACK = {
    verb: 'Re-research trip',
    produces: 'Researches the trip again from scratch and re-extracts plan and candidates. Runs in the background; you can navigate away.',
    time_seconds: 150,
    tokens_range: [8000, 16000],
  };
  const DEEPEN_PROMISE = $derived(data.promises?.deepen ?? DEEPEN_FALLBACK);

  async function reResearch({ force = false } = {}) {
    if (!trip || reResearching) return;

    if (!force) {
      const ok = await showConfirm({
        title:        `Re-research "${trip.title || trip._slug}"?`,
        body:         'Researches the trip again and re-extracts plan and candidates. Runs in the background.',
        promise:      DEEPEN_PROMISE,
        confirmLabel: 'Re-research in background',
        danger:       false,
      });
      if (!ok) return;
    }

    reResearching = true;
    try {
      const url = `/api/actions/deepen/${encodeURIComponent(trip._slug)}${force ? '?force=true' : ''}`;
      const res = await fetch(url, { method: 'POST' });

      if (res.status === 409) {
        let body = null;
        try { body = await res.json(); } catch { /* tolerate parse failures */ }
        if (body?.code === 'plan_prose_present') {
          const ok2 = await showConfirm({
            title:        'Re-research will overwrite plan prose',
            body:         body.message ?? 'This trip has field guide notes / gotchas. Re-research will overwrite them.',
            confirmLabel: 'Re-research anyway',
            danger:       true,
          });
          if (ok2) await reResearch({ force: true });
          return;
        }
        // already_running or other 409
        actionError = { code: 'already_running' };
        return;
      }

      if (!res.ok && res.status !== 202) {
        actionError = { code: 'action_failed', ctx: { action: 're-research this trip' } };
        return;
      }

      // 202 Accepted — refresh jobs poll immediately so the per-trip badge appears.
      try {
        const jobsRes = await fetch('/api/jobs');
        if (jobsRes.ok) {
          const body2 = await jobsRes.json();
          allJobs = body2.jobs ?? [];
        }
      } catch { /* the 10s poll will pick it up */ }
    } catch {
      actionError = { code: 'network_error' };
    } finally {
      reResearching = false;
    }
  }

  // ── Extract-only retry (recovery banner) ──
  // Fired when planning trip has overview.md but no plan.md: the research leg
  // succeeded but the extract leg failed. The deepen endpoint detects this
  // state automatically and skips re-research. No confirm needed — the retry
  // is cheap (extract-only) and non-destructive.
  let retryingExtraction = $state(false);

  async function retryExtraction() {
    if (!trip || retryingExtraction) return;
    retryingExtraction = true;
    try {
      const res = await fetch(`/api/actions/deepen/${encodeURIComponent(trip._slug)}`, { method: 'POST' });

      if (res.status === 409) {
        let body = null;
        try { body = await res.json(); } catch { /* tolerate parse failures */ }
        if (body?.code === 'already_running') {
          actionError = { code: 'already_running' };
        } else {
          actionError = { code: 'action_failed', ctx: { action: 'retry plan extraction' } };
        }
        return;
      }

      if (!res.ok && res.status !== 202) {
        actionError = { code: 'action_failed', ctx: { action: 'retry plan extraction' } };
        return;
      }

      // 202 Accepted — refresh jobs poll immediately so the per-trip badge appears.
      try {
        const jobsRes = await fetch('/api/jobs');
        if (jobsRes.ok) {
          const body2 = await jobsRes.json();
          allJobs = body2.jobs ?? [];
        }
      } catch { /* the 10s poll will pick it up */ }
    } catch {
      actionError = { code: 'network_error' };
    } finally {
      retryingExtraction = false;
    }
  }

  // ── Retro ──
  let retroOpen = $state(false);
  const hasNotes = $derived(typeof sections.notes === 'string' && sections.notes.trim().length > 0);

  // The home page sets :global(html, body) { height: 100%; overflow: hidden }
  // in its route stylesheet so its grid layout can fill the viewport.
  // SvelteKit doesn't reliably unload route stylesheets on client nav, so a
  // CSS-only :global reset here loses the cascade fight. Settings already
  // hit this and solved it with inline styles in onMount — same fix here.
  // Without this, the sticky header doesn't compute against a scrolling
  // container and the page reads as fixed-height instead.
  onMount(() => {
    const html = document.documentElement;
    const body = document.body;
    const prev = {
      htmlOverflow: html.style.overflow,
      htmlHeight: html.style.height,
      bodyOverflow: body.style.overflow,
      bodyHeight: body.style.height,
    };
    html.style.overflow = 'auto';
    html.style.height = 'auto';
    body.style.overflow = 'auto';
    body.style.height = 'auto';
    return () => {
      html.style.overflow = prev.htmlOverflow;
      html.style.height = prev.htmlHeight;
      body.style.overflow = prev.bodyOverflow;
      body.style.height = prev.bodyHeight;
    };
  });

  onMount(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get('just-completed') === '1' && isCompleted && !hasNotes) {
      retroOpen = true;
      // Clear the param so a refresh doesn't re-trigger the modal.
      url.searchParams.delete('just-completed');
      history.replaceState(history.state, '', url.toString());
    }
  });

  async function onRetroSaved() {
    retroOpen = false;
    await invalidateAll();
  }

  // ── Receipts ──
  let receiptsInput = $state(null);
  let receiptsStatus = $state('idle'); // 'idle' | 'uploading' | 'done' | 'error'
  let receiptsLines = $state([]);
  let receiptsErrorCode = $state(/** @type {string|null} */ (null));
  let receiptsErrorCtx = $state(/** @type {Record<string,string>} */ ({}));
  let receiptsTokens = $state(/** @type {number|null} */ (null));
  let receiptsSuccessVisible = $state(false);
  let receiptsSuccessTimer = /** @type {ReturnType<typeof setTimeout>|null} */ (null);

  function openReceiptPicker() {
    receiptsInput?.click();
  }

  async function uploadReceipts(e) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    // Clear previous state
    receiptsStatus = 'uploading';
    receiptsErrorCode = null;
    receiptsErrorCtx = {};
    receiptsLines = [];
    receiptsTokens = null;
    receiptsSuccessVisible = false;
    if (receiptsSuccessTimer) { clearTimeout(receiptsSuccessTimer); receiptsSuccessTimer = null; }

    const fd = new FormData();
    for (const f of files) fd.append('image', f);
    try {
      const res = await fetch(`/api/actions/receipts/${encodeURIComponent(trip._slug)}`, {
        method: 'POST', body: fd,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        const { code, ctx } = receiptsErrorFromStatus(res.status, body);
        receiptsErrorCode = code;
        receiptsErrorCtx = ctx;
        receiptsStatus = 'error';
        return;
      }
      const json = await res.json();
      receiptsLines = json.lines || [];
      receiptsTokens = json.tokens ?? null;
      receiptsStatus = 'done';
      receiptsSuccessVisible = true;
      await invalidateAll();
      // Auto-dismiss the success headline after 4s; parsed lines remain.
      receiptsSuccessTimer = setTimeout(() => {
        receiptsSuccessVisible = false;
        receiptsSuccessTimer = null;
      }, 4000);
    } catch {
      receiptsErrorCode = 'network_error';
      receiptsErrorCtx = {};
      receiptsStatus = 'error';
    } finally {
      // Reset the file input so the same file can be re-selected after an error.
      if (receiptsInput) receiptsInput.value = '';
    }
  }

  function dismissReceiptsError() {
    receiptsStatus = 'idle';
    receiptsErrorCode = null;
    receiptsErrorCtx = {};
  }

  function retryReceipts() {
    dismissReceiptsError();
    receiptsInput?.click();
  }

  /** Affordances for a given receipts error code. */
  function receiptsAffordances(code) {
    if (!code) return [];
    if (code === 'trip_not_found') return ['dismiss'];
    if (code === 'empty_model_output' || code === 'network_error' || code === 'provider_error') return ['retry', 'dismiss'];
    if (code === 'invalid_input') return ['dismiss'];
    return ['retry', 'dismiss'];
  }

  // ── Cover photo ──
  let coverPhotoOpen = $state(false);

  // ── Receipts promise (mirrors _promise from the receipts route) ──
  // Telemetry-resolved values come from `data.promises.receipts`.
  const RECEIPTS_FALLBACK = {
    verb: 'Parse receipts',
    produces: 'Structured expense lines (date · merchant · amount · category) appended to your trip notes.',
    time_seconds: 10,
    tokens_range: [400, 900],
  };
  const RECEIPTS_PROMISE = $derived(data.promises?.receipts ?? RECEIPTS_FALLBACK);

  // ── Archive ──
  async function archiveTrip() {
    if (!trip) return;
    const label = trip.title || trip._slug;
    const ok = await showConfirm({
      title:        `Archive "${label}"?`,
      body:         "It'll vanish from view but stay on disk, so the seeder won't suggest it again.",
      confirmLabel: 'Archive',
      danger:       true,
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/archive/${encodeURIComponent(trip._slug)}`, { method: 'POST' });
      if (!res.ok) throw new Error(`Archive failed: ${res.status}`);
      await goto('/', { invalidateAll: true });
    } catch (err) {
      console.error(err);
      actionError = { code: 'action_failed', ctx: { action: 'archive this trip' } };
    }
  }

  // ── ⋯ menu groups (computed from stage + feature flags + share state) ──
  const kebabGroups = $derived.by(() => {
    const slug = trip?._slug ?? '';
    const brochureHref = `/trips/${encodeURIComponent(slug)}/brochure`;

    // Output group — always present
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

    const groups = [{ label: 'Output', items: outputItems }];

    // Mobile-only trip-wide entry for the Field guide palette. On desktop
    // the page-header Ask button + Cmd-K cover this; mobile has neither,
    // so the kebab is the discoverable trip-wide path.
    if (isPlanning && data.features?.chat && data.features?.homeMdReady !== false) {
      groups.push({
        label: data.assistantName,
        items: [
          {
            type: 'button',
            label: `Ask ${data.assistantName}`,
            onclick: () => { openPalette(); },
          },
        ],
      });
    }

    if (isCompleted) {
      // Activity group (completed trips only) — only render when at least one applies
      const activityItems = [];
      if (!hasNotes && data.features?.retro && data.features?.homeMdReady !== false) {
        activityItems.push({
          type: 'button',
          label: '📝 Add retro',
          onclick: () => { retroOpen = true; },
        });
      }
      if (data.features?.receipts) {
        activityItems.push({
          type: 'button',
          label: receiptsStatus === 'uploading' ? 'Parsing receipts…' : '🧾 Add receipts',
          onclick: openReceiptPicker,
          disabled: receiptsStatus === 'uploading',
        });
      }
      if (activityItems.length > 0) {
        groups.push({ label: 'Activity', items: activityItems });
      }
    }

    // Lifecycle group. Re-research has its own header button on planning
    // trips (creative do-over, mid-planning action); the kebab keeps the
    // less-frequent archival/output entries so it doesn't compete with the
    // primary in-page workflow.
    const lifecycleItems = [];
    if (isPlanning) {
      lifecycleItems.push({
        type: 'button',
        label: completing ? 'Completing…' : '✓ Mark as completed',
        onclick: completeTrip,
        disabled: completing,
      });
    }
    lifecycleItems.push({
      type: 'button',
      label: '🗑 Archive',
      onclick: archiveTrip,
      danger: true,
    });

    groups.push({ label: 'Lifecycle', items: lifecycleItems });

    return groups;
  });

  // Re-research is the canonical mid-planning action (cf. Mark-as-completed
  // and Archive, which are end-of-life). Showing it in the same row as the
  // Ask palette anchors both AI-driven workflows in the header chrome.
  const canReResearch = $derived(
    isPlanning && data.features?.deepen && data.features?.homeMdReady !== false,
  );
</script>

<svelte:head>
  <title>{trip?.title || trip?._slug} · Traverse</title>
</svelte:head>

<div class="page">
  <header>
    <button class="header-pill back" onclick={() => goto('/')} aria-label="Back to all trips">← All trips</button>
    <span class="stage-pill">{stage || 'planning'}</span>
    <h1>{trip?.title || trip?._slug}</h1>
    <div class="meta">
      {#if trip?.destination}<span>{trip.destination}</span>{/if}
      {#if driveLabel}
        <span class="mode drive">{driveLabel}</span>
      {/if}
      {#if trip?._cost}<span class="cost">{trip._cost}</span>{/if}
    </div>
    {#if tripJobs.length > 0}
      <div class="header-job-badge">
        <TripJobBadge
          jobs={tripJobs}
          oncancel={(workflow, slug) => {
            // Optimistic: drop the canceled job from allJobs immediately so the
            // badge collapses without waiting for the 10s poll. The watcher
            // effect (see prevJobKeys) then triggers invalidateAll() once the
            // last job disappears, refreshing any partial section files.
            allJobs = allJobs.filter(j => !(j.workflow === workflow && j.slug === slug));
          }}
        />
      </div>
    {/if}
    {#if isPlanning && data.features?.chat && data.features?.homeMdReady !== false}
      <button
        class="header-pill header-ask"
        onclick={() => openPalette()}
        title="Open the {data.assistantName} palette"
        aria-label="Open {data.assistantName}"
      >
        Ask <kbd class="header-ask-kbd" aria-hidden="true">⌘K</kbd>
      </button>
    {/if}
    {#if canReResearch}
      <PromiseTooltip promise={DEEPEN_PROMISE}>
        <button
          class="header-pill header-rerun"
          onclick={() => reResearch()}
          disabled={reResearching}
          aria-label="Re-research this trip in the background"
        >
          <span class="header-rerun-glyph" aria-hidden="true">↺</span>
          {reResearching ? 'Starting…' : 'Re-research'}
        </button>
      </PromiseTooltip>
    {/if}
    <KebabMenu groups={kebabGroups} triggerLabel="Trip actions" />
  </header>

  {#if trip?._image}
    <div class="hero">
      <img
        src={trip._image.large2x || trip._image.large || trip._image.medium}
        srcset={[
          trip._image.medium && `${trip._image.medium} 350w`,
          trip._image.large && `${trip._image.large} 940w`,
          trip._image.large2x && `${trip._image.large2x} 1880w`,
        ].filter(Boolean).join(', ')}
        sizes="100vw"
        alt={trip.title || ''}
      />
      {#if trip.vibe}<span class="vibe">{trip.vibe}</span>{/if}
    </div>
  {/if}

  <div class="layout">
    <main class="content">
      {#if danglingMessages.length}
        <aside class="dangling-banner" role="alert" aria-label="Plan integrity warning">
          <h4>Plan references missing candidates</h4>
          {#each danglingMessages as msg}
            <p>{msg}</p>
          {/each}
        </aside>
      {/if}

      {#if lastRunFailed}
        <aside class="last-run-banner" role="status" aria-label="Last background job failed">
          <div class="last-run-body">
            <strong>The last background job failed{lastRunFailed.at ? ` (${relativeTime(lastRunFailed.at)})` : ''}.</strong>
            <span class="last-run-sentence">{lastRunFailedSentence}</span>
            {#if lastRunFailed.message}
              <span class="last-run-detail" title={lastRunFailed.message}>{lastRunFailed.message}</span>
            {/if}
          </div>
        </aside>
      {/if}

      {#if isCompleted}
        <div class="callout completed-callout">
          <strong>Completed.</strong>
          This trip is done. All sections are preserved below.
          {#if receiptsSuccessVisible && receiptsStatus === 'done'}
            <div class="receipts-success" role="status">
              ✓ Parsed {receiptsLines.length} receipt{receiptsLines.length === 1 ? '' : 's'}{receiptsTokens ? ` · ${formatTokens(receiptsTokens)}` : ''}
            </div>
          {/if}
          {#if receiptsStatus === 'done' && receiptsLines.length}
            <ul class="receipts-lines">
              {#each receiptsLines as line}
                <li>{line}</li>
              {/each}
            </ul>
          {/if}
          {#if receiptsStatus === 'error' && receiptsErrorCode}
            <div class="receipts-error-envelope" role="alert">
              <p class="receipts-error-sentence">{failureSentence(receiptsErrorCode, receiptsErrorCtx)}</p>
              <AffordanceButtons
                affordances={receiptsAffordances(receiptsErrorCode)}
                size="sm"
                onretry={retryReceipts}
                ondismiss={dismissReceiptsError}
              />
            </div>
          {/if}
        </div>
        <input
          bind:this={receiptsInput}
          type="file"
          accept="image/*"
          multiple
          style="display:none"
          onchange={uploadReceipts}
        />
      {:else if !isPlanning}
        <div class="callout warn">
          <strong>Idea.</strong> Click <em>Research →</em> on the card to flesh this out into a planning trip with route, stops, and logistics.
        </div>
      {/if}

      {#if Array.isArray(trip?._coords)}
        <div class="map-section">
          <TripMap
            mode="overview"
            {trip}
            home={data.home?.coords}
            color={markerColor}
            driveLabel={driveLabel}
            homeDistanceMi={trip?.home_distance_mi ?? null}
          />
        </div>
      {/if}

      {#if sections.itinerary}
        <div class="itinerary-view">
          <div class="itinerary-toolbar no-print">
            <button class="btn btn-secondary btn-compact" onclick={() => window.print()}>
              Print / Save PDF
            </button>
          </div>
          {@html renderMarkdown(sections.itinerary)}
        </div>
      {:else if data.plan?.days?.length}
        <!--
          New-flow trips (plan.md but no legacy itinerary.md) print via the
          dedicated /brochure route — the detail page itself is full of editor
          chrome that doesn't belong on paper.
        -->
        <div class="itinerary-toolbar no-print">
          <a
            class="btn btn-secondary btn-compact"
            href="/trips/{encodeURIComponent(trip._slug)}/brochure"
            target="_blank"
            rel="noopener"
          >↗ View brochure (for print)</a>
        </div>
      {/if}

      {#if planExtractionFailed}
        <aside class="extract-recovery-banner" role="alert" aria-label="Plan extraction incomplete">
          <div class="extract-recovery-body">
            <strong>Plan extraction didn't finish during research.</strong>
            The web-search leg succeeded but the extract step failed. Retry just the extract step; no need to re-run research.
          </div>
          <button
            class="btn btn-secondary btn-compact extract-recovery-btn"
            onclick={retryExtraction}
            disabled={retryingExtraction}
          >
            {retryingExtraction ? 'Starting…' : 'Retry extraction →'}
          </button>
        </aside>
      {/if}

      {#each canonicalSections as section}
        <section
          class="section"
          class:muted-section={section === 'logistics' || section === 'route'}
          id="section-{section}"
        >
          <header class="section-header">
            <h2>{SECTION_LABELS[section] || section}</h2>
            {#if isPlanning && section !== 'candidates' && section !== 'plan' && sections[section] !== undefined && !editing[section]}
              <div class="section-header-actions">
                <button class="btn-section-ask" onclick={() => openPalette(section)} title="Ask {data.assistantName} to edit this section">
                  Ask <kbd class="section-ask-kbd" aria-hidden="true">⌘K</kbd>
                </button>
                <button class="btn btn-secondary btn-compact" onclick={() => startEdit(section)}>Edit</button>
              </div>
            {/if}
          </header>

          {#if section === 'plan'}
            <PlanSection
              plan={data.plan}
              candidates={data.candidates}
              slug={data.trip._slug}
              destination={trip?._coords}
              readonly={isCompleted}
            />
          {:else if section === 'candidates'}
            <CandidatesSection
              candidates={data.candidates}
              plan={data.plan}
              slug={data.trip._slug}
              destination={trip?._coords}
              home={data.home?.coords}
              readonly={isCompleted}
            />
          {:else if sections[section] === undefined}
            <div class="section-empty-block">
              <p class="section-empty">Not yet researched.</p>
              {#if canResearchSection && RESEARCHABLE.has(section)}
                <PromiseTooltip promise={DEEPEN_SECTION_PROMISE}>
                  <button
                    type="button"
                    class="btn btn-secondary btn-compact"
                    onclick={() => researchSection(section)}
                    disabled={deepenSectionRunning}
                    title={deepenSectionRunning ? 'Already running; see indicator' : undefined}
                  >
                    {deepenSectionRunning ? 'Researching…' : 'Research this section →'}
                  </button>
                </PromiseTooltip>
              {/if}
            </div>
          {:else if editing[section]}
            <textarea
              class="editor"
              bind:value={drafts[section]}
              spellcheck="true"
              rows="14"
            ></textarea>
            <div class="editor-actions">
              <button class="btn btn-primary btn-compact" onclick={() => saveEdit(section)} disabled={saving[section]}>
                {saving[section] ? 'Saving…' : 'Save'}
              </button>
              <button class="btn btn-tertiary btn-compact" onclick={() => cancelEdit(section)} disabled={saving[section]}>
                Cancel
              </button>
            </div>
          {:else if pendingEdits[section]}
            <SectionDiffOverlay
              before={stripLeadingH1(pendingEdits[section].before)}
              after={stripLeadingH1(pendingEdits[section].after)}
              reply={pendingEdits[section].reply}
              assistantName={data.assistantName}
              outOfDate={pendingEdits[section].outOfDate}
              turnAt={pendingEdits[section].turnAt}
              sectionAnchor={`#section-${section}`}
              onaccept={() => acceptEdit(section)}
              onrevert={() => revertEdit(section)}
            />
          {:else if section === 'overview'}
            <div class="prose">{@html renderMarkdown(stripLeadingH1(overviewDisplay))}</div>
            {#if overviewIsLong && !overviewExpanded}
              <button
                type="button"
                class="overview-show-more"
                onclick={() => (overviewExpanded = true)}
              >Show more</button>
            {/if}
          {:else if section === 'route'}
            <div class="prose route-prose">{@html renderMarkdown(stripLeadingH1(routeDisplay))}</div>
            {#if routeIsLong && !routeExpanded}
              <button
                type="button"
                class="overview-show-more"
                onclick={() => (routeExpanded = true)}
              >Show more</button>
            {/if}
          {:else}
            <div class="prose">{@html renderMarkdown(stripLeadingH1(sections[section]))}</div>
          {/if}
        </section>
      {/each}

      {#if isPlanning && typeof sections.stops === 'string' && sections.stops.trim().length > 0}
        <details class="legacy-stops">
          <summary>Research notes (legacy stops.md)</summary>
          <div class="prose legacy-stops-body">{@html renderMarkdown(stripLeadingH1(sections.stops))}</div>
        </details>
      {/if}

      {#if deepenSectionError}
        <div class="deepen-section-error" role="alert">{failureSentence(deepenSectionError.code, deepenSectionError.ctx ?? {})}</div>
      {/if}

      {#if actionError}
        <div class="action-error-banner" role="alert" aria-live="polite">
          <span class="action-error-text">{failureSentence(actionError.code, actionError.ctx ?? {})}</span>
          <button class="action-error-dismiss" onclick={dismissActionError} aria-label="Dismiss">Dismiss</button>
        </div>
      {/if}

    </main>
  </div>

  {#if retroOpen}
    <RetroModal
      slug={trip._slug}
      assistantName={data.assistantName}
      onclose={() => retroOpen = false}
      onsaved={onRetroSaved}
    />
  {/if}

  <CoverPhotoModal
    bind:open={coverPhotoOpen}
    trip={trip}
    onsaved={() => invalidateAll()}
  />

  <ConfirmModal
    bind:open={navGuardOpen}
    title="Leave without saving?"
    body="You have unsaved edits in one or more sections. Leaving now will discard them."
    confirmLabel="Leave anyway"
    danger={true}
    onconfirm={confirmNavDiscard}
    oncancel={cancelNavDiscard}
  />

  <ConfirmModal
    bind:open={confirmOpen}
    title={confirmOpts.title ?? ''}
    body={confirmOpts.body ?? ''}
    promise={confirmOpts.promise ?? null}
    confirmLabel={confirmOpts.confirmLabel ?? 'Confirm'}
    danger={confirmOpts.danger ?? false}
    onconfirm={() => { confirmResolve?.(true);  confirmResolve = null; }}
    oncancel={() =>  { confirmResolve?.(false); confirmResolve = null; }}
  />

  <FieldGuidePalette
    open={paletteOpen}
    scope={paletteScope}
    sectionLabel={paletteScope.kind === 'section' ? (SECTION_LABELS[paletteScope.section] || paletteScope.section) : ''}
    assistantName={data.assistantName}
    busy={paletteBusy}
    blockedReason={deepenSectionRunning ? `Section research is running. ${data.assistantName} is paused until it finishes so the two writers can't race on the same file.` : null}
    errorSentence={paletteErrorSentence}
    lastReply={paletteLastReply}
    onsubmit={handlePaletteSubmit}
    oncancel={handlePaletteCancel}
    onclose={closePalette}
    onwidenscope={widenPaletteScope}
  />

  {#if pendingSections.length > 0 && !paletteOpen}
    <div class="palette-chip" role="status" aria-live="polite">
      <button
        type="button"
        class="palette-chip-label"
        onclick={scrollToFirstPending}
        title={pendingChipReply}
      >
        <span class="palette-chip-icon" aria-hidden="true">✎</span>
        {data.assistantName} edited
        {#if pendingSections.length === 1}
          {SECTION_LABELS[pendingSections[0]] || pendingSections[0]}
        {:else}
          {pendingSections.length} sections
        {/if}
        {#if pendingHasFresh}<span class="palette-chip-arrow" aria-hidden="true">↑</span>{/if}
      </button>
      <button type="button" class="palette-chip-btn" onclick={refineFromChip}>Refine</button>
      <button type="button" class="palette-chip-btn palette-chip-dismiss" onclick={dismissChip} title="Hide this indicator. Edits are already on disk.">Dismiss</button>
    </div>
  {/if}

</div>

<style>
  /* Grid (not flex column) so the sticky header has a clean containing
     block. position: sticky on the first child of a `display: flex;
     flex-direction: column` container with `min-height: 100vh` can fail
     to engage in some browsers — the home page solved this same problem
     with `display: grid; grid-template-rows: ...` and we follow suit.
     Track 1 is the header (auto), track 2 is everything else (auto so it
     sizes to content); the trailing `1fr` track makes .page fill the
     viewport even when content is shorter than 100vh. */
  .page {
    min-height: 100vh;
    background: var(--surface-page);
    color: var(--text-primary);
    font-family: var(--font-sans);
    display: grid;
    grid-template-rows: auto auto 1fr;
  }
  .page > header { grid-row: 1; }
  .page > .hero { grid-row: 2; }
  .page > .layout { grid-row: 3; }

  /* Sticky so the per-trip job badge, ⋯ menu, and back link stay reachable
     while scrolling through long sections — the global pill is suppressed
     for current-trip jobs (to avoid colliding with the chat FAB), so the
     in-header badge needs to remain visible. z-index sits above body
     content but below modals/confirms (which use 1000+). */
  .page > header {
    background: var(--forest-800);
    color: var(--bone-200);
    border-bottom: 1px solid var(--border-default);
    padding: 1.1rem 1.75rem;
    display: flex;
    align-items: center;
    gap: 0.9rem;
    flex-wrap: wrap;
    position: sticky;
    top: 0;
    z-index: 50;
  }

  /* Per-trip job badge inside the page header. Sits between the meta block
     (which carries margin-left: auto) and the ⋯ menu, so the running-job
     indicator is inset rather than pinned to the right edge. */
  .header-job-badge {
    display: inline-flex;
    align-items: center;
  }

  /* ── Header pill system ──
     The four chrome buttons sitting on the forest-800 sticky band (back,
     Ask, Re-research, ⋯ kebab) share a single base treatment so the row
     reads as a tokenized system rather than four hand-tuned chips. Visual
     hierarchy comes from CONTENT — the kbd keycap on Ask, the ↺ glyph on
     Re-research, the ⋯ glyph on the kebab — not from border-width drift. */
  .header-pill {
    background: transparent;
    border: 1.5px solid var(--forest-600);
    color: var(--bone-200);
    padding: 0.35rem 0.7rem;
    border-radius: 4px;
    cursor: pointer;
    font-family: var(--font-sans);
    font-size: 0.78rem;
    font-weight: 600;
    line-height: 1.2;
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    transition: background 0.12s, border-color 0.12s, color 0.12s;
  }
  .header-pill:hover:not(:disabled) {
    background: var(--forest-700);
    border-color: var(--forest-400);
    color: var(--bone-100);
  }
  .header-pill:disabled {
    opacity: 0.55;
    cursor: progress;
  }

  /* Content-specific overrides for each pill variant. Chrome (border,
     background, padding, font-size/weight) all come from .header-pill. */

  /* "Ask Field guide" — primary AI affordance. The inline keycap doubles
     as a shortcut hint so users learn ⌘K from the surface itself. */
  .header-ask-kbd {
    font-family: var(--font-mono);
    font-size: 0.7rem;
    font-weight: 500;
    line-height: 1;
    padding: 0.18rem 0.35rem;
    background: color-mix(in oklab, var(--bone-50) 10%, transparent);
    border: 1px solid color-mix(in oklab, var(--bone-50) 22%, transparent);
    border-radius: 3px;
    color: var(--bone-200);
  }

  /* "Re-research" — mid-planning do-over. Glyph stays at full opacity so
     it doesn't read as a disabled/loading state. */
  .header-rerun-glyph {
    font-size: 0.95em;
    line-height: 1;
  }

  /* KebabMenu lives inside the forest-800 page header. Its component
     defaults (warm-tan border + text-secondary dots on a light surface)
     read as near-invisible here, so we re-paint the trigger to share
     .header-pill's forest-on-bone palette. Sizing values (border 1.5px,
     padding 0.35rem 0.65rem, radius 4px) already match the component
     defaults — we only override the colors. */
  .page > header :global(.kebab-trigger) {
    border-color: var(--forest-600);
    color: var(--bone-200);
  }
  .page > header :global(.kebab-trigger:hover),
  .page > header :global(.kebab-trigger[aria-expanded="true"]) {
    background: var(--forest-700);
    border-color: var(--forest-400);
    color: var(--bone-50);
  }

  .stage-pill {
    font-size: 0.62rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    padding: 0.22rem 0.55rem;
    border-radius: 3px;
    background: var(--planning-bg);
    color: var(--planning-text);
  }
  /* Dark-mode header outline lives in app.css alongside the other
     [data-theme="dark"] overrides — Svelte's CSS scoper can't see the
     html-level data-theme attribute, so it would mark a per-component
     override as unused. */

  .page > header h1 {
    font-family: var(--font-serif);
    font-size: 1.6rem;
    font-weight: 500;
    line-height: 1.1;
    letter-spacing: 0.005em;
    margin: 0;
  }

  .meta {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 0.55rem;
    font-size: 0.78rem;
    color: var(--bone-200);
  }
  .meta .mode {
    font-size: 0.62rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    padding: 0.14rem 0.45rem;
    border-radius: 2px;
  }
  /* Mode pill sits inside the constant forest-800 page header, so its
     colors are scoped to "on dark forest" in both modes — raw refs are
     appropriate here, not the mode-adaptive state-* tokens (a "drive"
     mode is not a "success" state). */
  .meta .mode.drive { background: var(--forest-100); color: var(--forest-800); }
  .meta .cost { font-weight: 700; color: var(--bone-200); }

  .hero {
    position: relative;
    height: 280px;
    overflow: hidden;
    background: var(--surface-sunken);
  }
  .hero img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .hero .vibe {
    position: absolute;
    top: 0.9rem; left: 1.2rem;
    font-size: 0.62rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--forest-50);
    background: var(--forest-800);
    padding: 0.2rem 0.55rem;
    border-radius: 2px;
  }

  .layout {
    /* Grid row 3 with 1fr (see .page) fills remaining viewport height. */
    display: flex;
    justify-content: center;
    padding: 1.75rem 1.25rem 4rem;
  }

  .content {
    width: 100%;
    max-width: 680px;
    display: flex;
    flex-direction: column;
    gap: 1.4rem;
  }

  /* Full-border callouts; the side-stripe variant tripped the absolute ban
     and the background tint + matching border already carry the affordance.
     Drives off semantic state-* tokens so each callout flavor adapts to
     dark mode without per-mode overrides. */
  .callout {
    background: var(--state-success-surface);
    color: var(--state-success);
    border: 1px solid var(--state-success);
    border-radius: 4px;
    padding: 0.7rem 0.95rem;
    font-size: 0.84rem;
    line-height: 1.55;
  }
  .callout.warn {
    background: var(--state-warning-surface);
    color: var(--state-warning);
    border-color: var(--state-warning);
  }
  .callout.completed-callout {
    background: var(--completed-bg);
    color: var(--completed-text);
    border-color: var(--completed-text);
  }
  /* ── Receipts inline result / error ── */
  .receipts-success {
    margin-top: 0.6rem;
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--state-success);
  }
  .receipts-lines {
    margin: 0.4rem 0 0 1.1rem;
    padding: 0;
    font-size: 0.80rem;
    color: var(--text-secondary);
    line-height: 1.55;
  }
  .receipts-error-envelope {
    margin-top: 0.6rem;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    padding: 0.5rem 0.65rem;
    background: var(--state-danger-surface);
    border: 1px solid var(--state-danger);
    border-radius: 4px;
    max-width: 28rem;
  }
  .receipts-error-sentence {
    margin: 0;
    font-size: 0.82rem;
    color: var(--text-primary);
    line-height: 1.4;
  }
  /* The map carries route geometry, home + destination markers, and
     optional numbered stop pins. Claiming ~40vh on desktop gives the
     route enough room to read; the parent height clamps prevent it from
     dominating short viewports. */
  .map-section {
    /* Shrunk from 40vh / 480px to 280px per the TripMap shape brief so
       Plan + Candidates come above the fold. The map earns its smaller
       footprint by being denser (destination popup with drive meta on
       the unified TripMap, dashed-spoke tooltip explaining the
       no-route fallback). */
    height: 280px;
    border-radius: 6px;
    overflow: hidden;
    border: 1px solid var(--border-default);
    background: var(--surface-sunken);
    /* Contain Leaflet's internal z-index 1000 controls so they can't escape
       above page-level overlays like the chat panel, kebab menu, or modals. */
    isolation: isolate;
  }

  .section {
    background: var(--surface-raised);
    border: 1px solid var(--border-subtle);
    border-radius: 6px;
    padding: 1.25rem 1.4rem 1.5rem;
  }

  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.75rem;
    border-bottom: 1px solid var(--border-subtle);
    padding-bottom: 0.55rem;
  }
  .section-header h2 {
    font-size: 1.2rem;
    font-weight: 700;
    letter-spacing: -0.015em;
    color: var(--text-primary);
    margin: 0;
  }
  .section-header-actions {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
  }
  /* Quieter than .btn-secondary so the section's primary action stays Edit;
     "Ask" is the secondary AI affordance. The inline ⌘K keycap doubles
     as a discoverability hint so users learn the shortcut from any
     section header, not just a hover-only title. */
  .btn-section-ask {
    background: transparent;
    border: 0.5px solid var(--border-subtle);
    color: var(--text-tertiary);
    font-family: var(--font-sans);
    font-size: 0.78rem;
    font-weight: 600;
    padding: 0.32rem 0.5rem 0.32rem 0.6rem;
    border-radius: 4px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    transition: background 0.12s, border-color 0.12s, color 0.12s;
  }
  .btn-section-ask:hover {
    background: color-mix(in oklab, var(--accent) 8%, transparent);
    border-color: color-mix(in oklab, var(--accent) 35%, var(--border-default));
    color: var(--accent-text);
  }
  .section-ask-kbd {
    font-family: var(--font-mono);
    font-size: 0.68rem;
    font-weight: 500;
    line-height: 1;
    padding: 0.16rem 0.32rem;
    background: var(--surface-page);
    border: 1px solid var(--border-default);
    border-radius: 3px;
    color: var(--text-tertiary);
  }
  .btn-section-ask:hover .section-ask-kbd {
    border-color: color-mix(in oklab, var(--accent) 30%, var(--border-default));
    color: var(--accent-text);
  }

  .editor {
    width: 100%;
    min-height: 260px;
    font-family: var(--font-mono);
    font-size: 0.86rem;
    line-height: 1.6;
    color: var(--text-primary);
    background: var(--surface-page);
    border: 1px solid var(--border-default);
    border-radius: 4px;
    padding: 0.7rem 0.85rem;
    resize: vertical;
  }
  .editor:focus { outline: 2px solid var(--focus-ring); outline-offset: 1px; }

  .editor-actions {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.55rem;
  }

  .section-empty-block {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .section-empty {
    font-size: 0.86rem;
    color: var(--text-tertiary);
    font-style: italic;
    margin: 0;
  }

  /* Prose: 1rem body with 1.75 line-height at 680px column yields ~78-82ch,
     a touch above the 65-75 ideal but well within readable range and a
     real improvement from the previous ~94-97ch. Heading scale opens to
     ~1.1× steps so a reader can tell at a glance which level they're on. */
  .prose { font-size: 1rem; line-height: 1.75; color: var(--text-secondary); }
  .prose :global(h1), .prose :global(h2) {
    font-size: 1.1rem; font-weight: 700; margin: 1.4rem 0 0.5rem;
    color: var(--text-primary); letter-spacing: -0.015em;
  }
  .prose :global(h3) { font-size: 0.95rem; font-weight: 700; margin: 1.1rem 0 0.35rem; color: var(--text-primary); }
  .prose :global(h1:first-child),
  .prose :global(h2:first-child),
  .prose :global(h3:first-child) { margin-top: 0; }
  .prose :global(p) { margin: 0 0 0.85rem; }
  .prose :global(ul), .prose :global(ol) { margin: 0 0 0.85rem 1.3rem; }
  .prose :global(li) { margin-bottom: 0.3rem; }
  .prose :global(strong) { font-weight: 700; color: var(--text-primary); }
  .prose :global(a) { color: var(--accent-text); text-decoration: none; }
  .prose :global(a:hover) { text-decoration: underline; }
  .prose :global(table) { width: 100%; border-collapse: collapse; font-size: 0.86rem; margin: 0 0 1rem; }
  .prose :global(th) { text-align: left; font-weight: 700; padding: 0.4rem 0.6rem; border-bottom: 2px solid var(--border-default); color: var(--text-primary); }
  .prose :global(td) { padding: 0.35rem 0.6rem; border-bottom: 1px solid var(--border-subtle); vertical-align: top; }
  .prose :global(code) { font-family: monospace; font-size: 0.82em; background: var(--surface-sunken); color: var(--text-primary); padding: 0.1em 0.4em; border-radius: 3px; }

  /* Overview soft-cap "Show more" — borderless inline link styled like a
     tertiary action so it reads as a continuation cue, not a CTA. */
  .overview-show-more {
    margin-top: 0.25rem;
    padding: 0;
    background: transparent;
    border: 0;
    font: inherit;
    font-size: 0.86rem;
    color: var(--accent-text);
    cursor: pointer;
  }
  .overview-show-more:hover { text-decoration: underline; }

  /* Route prose is editorial annotation below the page-level map — short
     scenic-only notes per the current prompts (≤2 sentences). Legacy long
     routes still on disk collapse via the soft-cap above. Slight
     line-height bump + the .muted-section header treatment subordinate
     this section to Plan + Candidates without making it invisible. */
  .route-prose { font-size: 0.95rem; line-height: 1.65; }

  /* Muted-section treatment for the two auxiliary surfaces (Route and
     Logistics) — they're context for Plan + Candidates, not the work
     itself. Heading shrinks, weight drops, and the whole section dims
     slightly so the user's eye lands on the structured surfaces above
     and below. */
  .muted-section { opacity: 0.92; }
  .muted-section .section-header h2 {
    color: var(--text-tertiary);
    font-size: 1rem;
    font-weight: 500;
  }

  /* Legacy stops.md disclosure. Research stopped writing this file once the
     structured plan + candidates surfaces took over; older trips still carry
     a prose blob that we don't want to delete but also don't want to give
     prime real estate to. Collapsed by default; muted summary so it reads
     as a "look up the original notes" affordance rather than a peer section. */
  .legacy-stops {
    border-top: 1px solid var(--border-default);
    padding-top: 0.9rem;
    color: var(--text-tertiary);
  }
  .legacy-stops > summary {
    cursor: pointer;
    font-size: 0.78rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-tertiary);
    padding: 0.25rem 0;
    list-style: none;
  }
  .legacy-stops > summary::-webkit-details-marker { display: none; }
  .legacy-stops > summary::before {
    content: '▸ ';
    display: inline-block;
    transition: transform 0.12s ease-out;
  }
  .legacy-stops[open] > summary::before {
    content: '▾ ';
  }
  .legacy-stops > summary:hover {
    color: var(--text-secondary);
  }
  .legacy-stops-body {
    margin-top: 0.6rem;
    color: var(--text-secondary);
    font-size: 0.92rem;
  }

  .deepen-section-error {
    font-size: 0.78rem;
    color: var(--state-danger);
    line-height: 1.45;
    margin-top: 0.25rem;
  }

  .action-error-banner {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.55rem 0.7rem 0.55rem 0.85rem;
    background: var(--state-danger-surface);
    border: 1px solid var(--state-danger);
    border-radius: 6px;
    font-size: 0.85rem;
    color: var(--text-primary);
    margin-top: 0.5rem;
  }
  .action-error-text { flex: 1; line-height: 1.45; }
  .action-error-dismiss {
    flex-shrink: 0;
    background: transparent;
    border: 1px solid transparent;
    color: var(--state-danger);
    font-family: var(--font-sans);
    font-size: 0.74rem;
    font-weight: 600;
    letter-spacing: 0.02em;
    padding: 0.35rem 0.6rem;
    border-radius: 4px;
    cursor: pointer;
  }
  .action-error-dismiss:hover {
    background: color-mix(in oklab, var(--state-danger) 8%, transparent);
    border-color: var(--state-danger);
  }
  .action-error-dismiss:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }

  /* ── Dangling-candidate-id integrity banner ──
     Surfaces referential-integrity violations between plan.md and
     candidates.md at the top of the page. Sentence text comes from
     ERROR_REGISTRY.dangling_candidate_id; this banner is the only place
     in the app that surfaces it. */
  .dangling-banner {
    padding: 0.75rem 1rem;
    background: var(--state-danger-surface);
    color: var(--text-primary);
    border: 1px solid var(--state-danger);
    border-radius: 4px;
    margin-bottom: 0.25rem;
    font-family: var(--font-sans);
  }
  .dangling-banner h4 {
    margin: 0 0 0.5rem;
    font-size: 0.95rem;
    color: var(--state-danger);
  }
  .dangling-banner p {
    margin: 0.25rem 0;
    font-size: 0.85rem;
    line-height: 1.45;
  }

  /* ── Last-run-failed banner ──
     Surfaces a historical job failure that wasn't followed by a success.
     Warning palette (not danger) because the failure is past, not blocking
     — the user can keep planning while deciding whether to retry. Clears
     server-side on next successful run via completeJob. */
  .last-run-banner {
    padding: 0.7rem 0.95rem;
    background: var(--state-warning-surface);
    border: 1px solid var(--state-warning);
    border-radius: 4px;
    color: var(--text-primary);
    font-size: 0.84rem;
    line-height: 1.55;
    margin-bottom: 0.25rem;
  }
  .last-run-body {
    display: flex;
    flex-wrap: wrap;
    gap: 0.45rem 0.6rem;
    align-items: baseline;
  }
  .last-run-body strong {
    color: var(--state-warning);
    font-weight: 600;
  }
  .last-run-sentence { color: var(--text-primary); }
  .last-run-detail {
    width: 100%;
    color: var(--text-tertiary);
    font-family: var(--font-mono);
    font-size: 0.74rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* ── Extract-only recovery banner ──
     Surfaces when planning trip has overview.md but no plan.md (research leg
     succeeded, extract leg failed). Uses warning palette to distinguish it
     from danger (dangling) and success (completed) banners. */
  .extract-recovery-banner {
    display: flex;
    align-items: flex-start;
    gap: 1rem;
    padding: 0.75rem 0.95rem;
    background: var(--state-warning-surface);
    color: var(--state-warning);
    border: 1px solid var(--state-warning);
    border-radius: 4px;
    font-size: 0.84rem;
    line-height: 1.55;
    margin-bottom: 0.25rem;
  }
  .extract-recovery-body {
    flex: 1;
    color: var(--text-primary);
  }
  .extract-recovery-body strong {
    color: var(--state-warning);
  }
  .extract-recovery-btn {
    flex-shrink: 0;
    align-self: center;
  }

  /* ── Field guide post-edit chip ──
     Sits where the chat FAB used to live; the chat FAB is hidden while the
     chip is visible (commit 4 will retire the FAB entirely). The chip is
     the "you have pending edits" indicator + Refine/Done affordance. */
  .palette-chip {
    position: fixed;
    bottom: 1.5rem;
    right: 1.5rem;
    z-index: 940;
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.45rem 0.6rem;
    background: var(--surface-overlay);
    border: 1px solid color-mix(in oklab, var(--state-success) 35%, var(--border-default));
    border-radius: 999px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
    font-family: var(--font-sans);
    font-size: 0.78rem;
  }
  .palette-chip-label {
    background: none;
    border: none;
    color: var(--text-primary);
    font-family: inherit;
    font-size: inherit;
    font-weight: 600;
    cursor: pointer;
    padding: 0.1rem 0.35rem;
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }
  .palette-chip-label:hover { color: var(--accent-text); }
  .palette-chip-icon {
    color: var(--state-success);
    font-size: 0.85em;
    line-height: 1;
  }
  .palette-chip-arrow {
    color: var(--text-tertiary);
    font-size: 0.8em;
  }
  .palette-chip-btn {
    background: var(--surface-page);
    border: 1px solid var(--border-default);
    color: var(--text-secondary);
    font-family: var(--font-sans);
    font-size: 0.72rem;
    font-weight: 600;
    padding: 0.22rem 0.55rem;
    border-radius: 999px;
    cursor: pointer;
    transition: background 0.12s, border-color 0.12s, color 0.12s;
  }
  .palette-chip-btn:hover {
    background: var(--surface-raised);
    color: var(--text-primary);
    border-color: var(--border-strong);
  }
  .palette-chip-dismiss { color: var(--text-tertiary); }
  @media (max-width: 640px) {
    .palette-chip { bottom: 1rem; right: 1rem; }
  }

  /* ── Itinerary view ── */
  .itinerary-toolbar {
    display: flex;
    justify-content: flex-end;
  }
  .itinerary-view {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
  }
  /* Day-heading band. Background carries the day-separator affordance;
     the previous 3px sunset stripe stacked one per day and tripped the
     absolute ban. Bottom border keeps the seam visible. */
  /* Day-heading band uses the warning-surface palette. Structurally
     unambiguous (rounded top of an itinerary block, not an inline
     notice) so it doesn't collide with .callout.warn even though they
     share the warm-orange palette. */
  .itinerary-view :global(h2) {
    font-size: 1rem;
    font-weight: 800;
    letter-spacing: -0.01em;
    color: var(--text-primary);
    margin: 0;
    padding: 0.7rem 1.1rem 0.6rem;
    background: var(--state-warning-surface);
    border-radius: 4px 4px 0 0;
    border-bottom: 1px solid var(--state-warning);
  }
  .itinerary-view :global(h3) {
    font-size: 0.64rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-tertiary);
    margin: 1rem 0 0.3rem;
  }
  .itinerary-view :global(h3:first-of-type) { margin-top: 0.55rem; }
  .itinerary-view :global(p) {
    font-size: 0.9rem;
    line-height: 1.6;
    color: var(--text-secondary);
    margin: 0 0 0.4rem;
    font-weight: 700;
  }
  .itinerary-view :global(ul) { margin: 0 0 0.5rem 0; list-style: none; padding: 0; }
  .itinerary-view :global(li) {
    font-size: 0.88rem;
    line-height: 1.55;
    color: var(--text-secondary);
    padding: 0.22rem 0;
    border-bottom: 1px solid var(--border-subtle);
  }
  .itinerary-view :global(li:last-child) { border-bottom: none; }
  .itinerary-view :global(strong) { font-weight: 700; color: var(--text-primary); }

  /* ── Print styles ── */
  @media print {
    .page > header,
    .callout,
    .map-section,
    .hero,
    .palette-chip,
    .no-print { display: none !important; }

    .page { background: var(--bone-50); color: var(--bark-900); }
    .layout { padding: 0; }
    .content { max-width: 100%; }

    .itinerary-view :global(h2) {
      background: var(--bone-100);
      border-bottom-color: var(--sunset-800);
      color: var(--bark-900);
      page-break-after: avoid;
    }
    .itinerary-view :global(h3) { color: var(--bone-600); }
    .itinerary-view :global(p),
    .itinerary-view :global(li) { color: var(--bark-600); font-size: 10pt; }
    .itinerary-view { page-break-inside: avoid; }
  }

  @media (max-width: 768px) {
    .page > header { padding: 0.85rem 1rem; gap: 0.55rem; }
    .page > header h1 { font-size: 1.05rem; }
    .meta { width: 100%; margin-left: 0; }
    .hero { height: 200px; }
    .map-section { height: 220px; }
    .layout { padding: 1rem 0.85rem 6rem; }
    .section { padding: 1rem 1.1rem 1.2rem; }
  }
</style>

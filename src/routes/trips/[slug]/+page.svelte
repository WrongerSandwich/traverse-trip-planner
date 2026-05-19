<script>
  import { renderMarkdown } from '$lib/sanitize.js';
  import { untrack } from 'svelte';
  import { invalidateAll, goto, beforeNavigate } from '$app/navigation';
  import { onMount } from 'svelte';
  import TripDetailMap from '$lib/components/TripDetailMap.svelte';
  import Logo from '$lib/components/Logo.svelte';
  import RetroModal from '$lib/components/RetroModal.svelte';
  import ConfirmModal from '$lib/components/ConfirmModal.svelte';
  import PromiseTooltip from '$lib/components/PromiseTooltip.svelte';
  import AffordanceButtons from '$lib/workflow-status/AffordanceButtons.svelte';
  import { failureSentence, ERROR_REGISTRY } from '$lib/errors-registry.js';
  import { formatTokens } from '$lib/utils/formatTokens.js';
  import TripJobBadge from '$lib/components/TripJobBadge.svelte';
  import { receiptsErrorFromStatus } from '$lib/utils/receiptsErrors.js';
  import { tripColor } from '$lib/utils/colors.js';
  import { swipeClose } from '$lib/actions/swipeClose.js';
  import { filterJobsForSlug } from '$lib/utils/jobLabels.js';
  import { isSectionsDirty } from '$lib/utils/sectionDirty.js';
  import { browser } from '$app/environment';
  import BrochureDayBlocks from '$lib/components/BrochureDayBlocks.svelte';
  import KebabMenu from '$lib/components/KebabMenu.svelte';
  import EmptyItineraryCTA from '$lib/components/EmptyItineraryCTA.svelte';
  import CoverPhotoModal from '$lib/components/CoverPhotoModal.svelte';

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
    itinerary: 'Itinerary',
    notes: 'Notes',
  };

  // Sections render under an H2 set by the page chrome; strip any leading H1
  // (e.g. `# Stops`) from the markdown body so the heading isn't shown twice.
  // Only strips single-# H1 — leaves ## H2 and deeper intact.
  function stripLeadingH1(md) {
    return (md || '').replace(/^\s*#(?!#)\s+[^\n]*\n+/, '');
  }

  // Canonical section sets per stage (itinerary handled separately above the list)
  const STAGE_SECTIONS = {
    planning:  ['overview', 'route', 'stops', 'logistics'],
    completed: ['overview', 'route', 'stops', 'logistics', 'notes'],
  };

  const trip = $derived(data.trip);
  const stage = $derived(data.stage);
  const isPlanning = $derived(stage === 'planning');
  const isCompleted = $derived(stage === 'completed');

  // Local section content state, seeded from server load. Edits live here
  // until saved — intentionally initial-only (don't re-sync on every load),
  // so untrack() to silence the "captures initial value" lint.
  let sections = $state(untrack(() => ({ ...data.files })));
  // ── Read / Edit mode toggle ──
  let editMode = $state(false);

  // Per-section UI state
  let editing = $state({});      // { route: true, ... }
  let drafts  = $state({});      // staging textareas while editing
  let saving  = $state({});
  let completing = $state(false);

  const anySectionEditing = $derived(Object.values(editing).some(v => v));

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

  // Show the "Research this section →" button when the feature is enabled,
  // the trip is in planning, and the section is a researchable type. Not
  // gated to Edit mode: researching a section produces content; it isn't
  // an authoring affordance, so a casual reader who notices an empty
  // section should still have a path forward.
  const RESEARCHABLE = new Set(['route', 'stops', 'logistics']);
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

  // ── AI chat ──
  // Mirrors _promise from the chat route — consumed by PromiseTooltip on
  // the Send button. Telemetry-resolved values come from
  // `data.promises.chat` (see src/lib/server/promises.js).
  const CHAT_FALLBACK = {
    verb: 'Ask Field Guide',
    produces: 'A conversational reply and any updated planning sections written directly to disk.',
    time_seconds: 20,
    tokens_range: [2000, 6000],
  };
  const CHAT_PROMISE = $derived(data.promises?.chat ?? CHAT_FALLBACK);

  let chatOpen = $state(false);
  let chatMessages = $state([]); // [{role: 'user'|'assistant', content: '...', tokens?: number}]
  let chatInput = $state('');
  let chatBusy = $state(false);
  let chatErrorCode = $state(null);    // TraverseError code string | null
  let chatErrorContext = $state(null); // interpolation context | null
  let lastChatInput = $state('');      // preserved for retry

  const chatStorageKey = $derived(trip?._slug ? `traverse-chat-${trip._slug}` : null);

  // Load chat history when slug changes (new trip = new history).
  $effect(() => {
    if (!chatStorageKey) return;
    try {
      const stored = localStorage.getItem(chatStorageKey);
      chatMessages = stored ? JSON.parse(stored) : [];
    } catch {
      chatMessages = [];
    }
  });

  // Persist chat history on every change.
  $effect(() => {
    if (!chatStorageKey) return;
    try {
      if (chatMessages.length === 0) localStorage.removeItem(chatStorageKey);
      else localStorage.setItem(chatStorageKey, JSON.stringify(chatMessages));
    } catch { /* quota / disabled storage — silently drop */ }
  });

  function clearChat() {
    chatMessages = [];
  }

  async function sendChat(retryText = null) {
    const text = retryText ?? chatInput.trim();
    if (!text || chatBusy) return;
    chatBusy = true;
    chatErrorCode = null;
    chatErrorContext = null;
    lastChatInput = text;
    if (!retryText) {
      chatMessages = [...chatMessages, { role: 'user', content: text }];
      chatInput = '';
    }

    try {
      const res = await fetch(
        `/api/trip/${encodeURIComponent(trip._slug)}/chat`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: chatMessages }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        chatErrorCode = data.error ?? 'network_error';
        chatErrorContext = data.context ?? null;
        return;
      }
      chatMessages = [
        ...chatMessages,
        {
          role: 'assistant',
          content: data.reply || '(no reply)',
          updated: Object.keys(data.updates || {}),
          usage: data.usage,
          tokens: data.tokens ?? 0,
        },
      ];
      // Apply any updates the model wrote to disk
      if (data.updates) {
        for (const [section, content] of Object.entries(data.updates)) {
          sections[section] = content;
          // If user was editing, drop the draft so they see the AI version
          if (editing[section]) {
            editing[section] = false;
            delete drafts[section];
          }
        }
        // Re-fetch server data so trip card meta (waypoints, drive hours, etc.)
        // reflects any frontmatter changes the model wrote (e.g. updated overview).
        await invalidateAll();
      }
    } catch {
      chatErrorCode = 'network_error';
    } finally {
      chatBusy = false;
    }
  }

  function retryChatSend() {
    chatErrorCode = null;
    chatErrorContext = null;
    sendChat(lastChatInput);
  }

  function dismissChatError() {
    chatErrorCode = null;
    chatErrorContext = null;
  }

  function handleChatKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendChat();
    }
  }

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

  // ── Retro ──
  let retroOpen = $state(false);
  const hasNotes = $derived(typeof sections.notes === 'string' && sections.notes.trim().length > 0);

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

  // ── Share ──
  let shareUrl = $state('');
  let shareBusy = $state(false);

  $effect(() => {
    // Rehydrate share state when navigating between trips. $effect runs only
    // client-side, so location.origin is safe to read.
    shareUrl = trip?.shared === 'true' && trip?._shareUrl
      ? `${location.origin}${trip._shareUrl}`
      : '';
  });

  async function enableShare() {
    if (!trip || shareBusy) return;
    shareBusy = true;
    try {
      const res = await fetch(`/api/share/${encodeURIComponent(trip._slug)}`, { method: 'POST' });
      if (!res.ok) throw new Error(`Share failed: ${res.status}`);
      const data = await res.json();
      shareUrl = `${location.origin}${data.url}`;
      await invalidateAll();
    } catch (err) {
      console.error(err);
      actionError = { code: 'action_failed', ctx: { action: 'enable sharing' } };
    } finally {
      shareBusy = false;
    }
  }

  async function disableShare() {
    if (!trip || shareBusy) return;
    const ok = await showConfirm({
      title:        'Disable share link?',
      body:         'Anyone who already has the URL will lose access immediately.',
      confirmLabel: 'Disable',
      danger:       true,
    });
    if (!ok) return;
    shareBusy = true;
    try {
      const res = await fetch(`/api/share/${encodeURIComponent(trip._slug)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`Disable failed: ${res.status}`);
      shareUrl = '';
      await invalidateAll();
    } catch (err) {
      console.error(err);
      actionError = { code: 'action_failed', ctx: { action: 'disable sharing' } };
    } finally {
      shareBusy = false;
    }
  }

  async function copyShareUrl() {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
    } catch { /* clipboard blocked — user can copy manually */ }
  }

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
  // ── Brochure prepare (Ambient Background) ──
  // The route returns 202 immediately and the global jobs indicator surfaces
  // progress + the success toast. Telemetry-resolved values come from
  // `data.promises['brochure-prepare']`; the fallback keeps the UI working
  // before the server-load round-trip completes.
  const BROCHURE_FALLBACK = {
    verb: 'Prepare brochure',
    produces: 'A structured brochure draft (stops with map pins, lodging, field guide notes, gotchas), ready to review before saving.',
    time_seconds: 45,
    tokens_range: [2000, 5000],
  };
  const BROCHURE_PROMISE = $derived(
    data.promises?.['brochure-prepare'] ?? BROCHURE_FALLBACK,
  );

  // True while a brochure job is in flight for this trip. Drives the disabled
  // state on the trigger button so the user can't kick off a second run.
  const brochureRunning = $derived(
    tripJobs.some(j => j.workflow === 'brochure'),
  );

  let brochureError = $state(/** @type {{code: string, ctx?: object}|null} */ (null));

  async function prepareBrochure() {
    if (!trip || brochureRunning) return;
    const ok = await showConfirm({
      title: 'Prepare brochure?',
      promise: BROCHURE_PROMISE,
      confirmLabel: 'Prepare in background',
    });
    if (!ok) return;
    brochureError = null;
    try {
      const res = await fetch(`/api/brochure/prepare/${encodeURIComponent(trip._slug)}`, { method: 'POST' });
      if (res.status === 409) {
        brochureError = { code: 'already_running' };
        return;
      }
      if (!res.ok && res.status !== 202) {
        brochureError = { code: 'action_failed' };
        return;
      }
      // 202 Accepted — the global indicator takes over from here. Refresh the
      // jobs poll immediately so the per-trip badge appears without waiting
      // for the next 10s tick.
      try {
        const jobsRes = await fetch('/api/jobs');
        if (jobsRes.ok) {
          const body = await jobsRes.json();
          allJobs = body.jobs ?? [];
        }
      } catch { /* the 10s poll will pick it up */ }
    } catch {
      brochureError = { code: 'network_error' };
    }
  }

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

    if (data.features?.share) {
      if (shareUrl) {
        // Share is active — show the URL as read-only text, then Copy + Disable
        outputItems.push({
          type: 'text',
          value: shareUrl,
        });
        outputItems.push({
          type: 'button',
          label: '📋 Copy share link',
          onclick: copyShareUrl,
        });
        outputItems.push({
          type: 'button',
          label: '🔗 Disable share',
          onclick: disableShare,
          disabled: shareBusy,
          danger: false,
        });
      } else {
        outputItems.push({
          type: 'button',
          label: shareBusy ? 'Generating…' : '🔗 Generate share link',
          onclick: enableShare,
          disabled: shareBusy,
        });
      }
    }

    const groups = [{ label: 'Output', items: outputItems }];

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

    // Lifecycle group
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
</script>

<svelte:head>
  <title>{trip?.title || trip?._slug} · Traverse</title>
</svelte:head>

<div class="page">
  <header>
    <button class="back" onclick={() => goto('/')} aria-label="Back to all trips">← All trips</button>
    <span class="stage-pill">{stage || 'planning'}</span>
    <h1>{trip?.title || trip?._slug}</h1>
    <div class="meta">
      {#if trip?.destination}<span>{trip.destination}</span>{/if}
      {#if driveLabel}
        <span class="mode drive">{driveLabel}</span>
      {/if}
      {#if trip?._cost}<span class="cost">{trip._cost}</span>{/if}
    </div>
    {#if isPlanning}
      <button
        class="edit-mode-toggle"
        class:active={editMode}
        onclick={() => { if (!anySectionEditing) editMode = !editMode; }}
        title={anySectionEditing ? 'Finish editing the open section first.' : undefined}
        aria-pressed={editMode}
      >
        {editMode ? '✓ Editing' : '✎ Edit'}
      </button>
    {/if}
    <KebabMenu groups={kebabGroups} />
    {#if tripJobs.length > 0}
      <div class="header-job-badge">
        <TripJobBadge jobs={tripJobs} />
      </div>
    {/if}
  </header>

  {#if trip?._image}
    <div class="hero">
      <img src={trip._image.large || trip._image.medium} alt={trip.title || ''} />
      {#if trip.vibe}<span class="vibe">{trip.vibe}</span>{/if}
    </div>
  {/if}

  <div class="layout">
    <main class="content">
      {#if editMode}
        <div class="editing-banner" role="status">
          You're editing. Section actions and brochure controls are visible below.
        </div>
      {/if}

      {#if isPlanning}
        {#if !editMode}
          <div class="callout">
            <strong>Planning trip.</strong>
            Click <em>Edit</em> to modify sections, or tap <em>Ask {data.assistantName}</em> for plain-English updates.
          </div>
        {/if}
      {:else if isCompleted}
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
      {:else}
        <div class="callout warn">
          <strong>Idea.</strong> Click <em>Research →</em> on the card to flesh this out into a planning trip with route, stops, and logistics.
        </div>
      {/if}

      {#if Array.isArray(trip?._coords)}
        <div class="map-section">
          <TripDetailMap
            {trip}
            home={data.home?.coords}
            stops={data.brochureData?.stops}
            color={markerColor}
            interactive={true}
          />
        </div>
      {/if}

      {#if data.brochureData?.days}
        <div class="itinerary-view">
          <div class="itinerary-toolbar no-print">
            <button class="btn btn-secondary btn-compact" onclick={() => window.print()}>
              Print / Save PDF
            </button>
          </div>
          <BrochureDayBlocks days={data.brochureData.days} />
        </div>
      {:else if sections.itinerary}
        <div class="itinerary-view">
          <div class="itinerary-toolbar no-print">
            <button class="btn btn-secondary btn-compact" onclick={() => window.print()}>
              Print / Save PDF
            </button>
          </div>
          {@html renderMarkdown(sections.itinerary)}
          <p class="itinerary-legacy-cta no-print">
            <a href={`/trips/${encodeURIComponent(trip._slug)}/brochure/prepare`}>Prepare brochure to enable editing</a>
          </p>
        </div>
      {:else if isPlanning && data.features?.homeMdReady !== false}
        <EmptyItineraryCTA
          onprepare={prepareBrochure}
          busy={brochureRunning}
          promise={BROCHURE_PROMISE}
        />
      {/if}

      {#each canonicalSections as section}
        <section class="section">
          <header class="section-header">
            <h2>{SECTION_LABELS[section] || section}</h2>
            {#if editMode && isPlanning && sections[section] !== undefined && !editing[section]}
              <button class="btn btn-secondary btn-compact" onclick={() => startEdit(section)}>Edit</button>
            {/if}
          </header>

          {#if sections[section] === undefined}
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
          {:else}
            <div class="prose">{@html renderMarkdown(stripLeadingH1(sections[section]))}</div>
          {/if}
        </section>
      {/each}

      {#if deepenSectionError}
        <div class="deepen-section-error" role="alert">{failureSentence(deepenSectionError.code, deepenSectionError.ctx ?? {})}</div>
      {/if}

      {#if brochureError}
        <div class="brochure-error-banner" role="alert">{failureSentence(brochureError.code, brochureError.ctx ?? {})}</div>
      {/if}

      {#if actionError}
        <div class="action-error-banner" role="alert" aria-live="polite">
          <span class="action-error-text">{failureSentence(actionError.code, actionError.ctx ?? {})}</span>
          <button class="action-error-dismiss" onclick={dismissActionError} aria-label="Dismiss">Dismiss</button>
        </div>
      {/if}

      <!-- Brochure-stale notice is no longer Edit-mode-gated; staleness is a
           correctness signal for any reader, and the Re-prepare action is a
           content-producing workflow rather than authoring. -->
      {#if data.brochureStale && !brochureRunning && data.features?.homeMdReady !== false}
        <div class="brochure-stale-notice">
          <span>Sections have changed. Re-prepare?</span>
          <PromiseTooltip promise={BROCHURE_PROMISE}>
            <button
              class="btn btn-secondary btn-compact"
              onclick={prepareBrochure}
            >Re-prepare brochure</button>
          </PromiseTooltip>
        </div>
      {/if}
    </main>
  </div>

  {#if isPlanning && data.features?.chat && data.features?.homeMdReady !== false}
    <button class="chat-fab" class:open={chatOpen} onclick={() => chatOpen = !chatOpen} aria-label="Ask {data.assistantName}">
      {#if chatOpen}
        ✕
      {:else}
        <svg class="fab-icon" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M8 1.2L9.4 5.6 14 7l-4.6 1.4L8 12.8 6.6 8.4 2 7l4.6-1.4z M13 11l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z" fill="currentColor"/>
        </svg>
        Ask {data.assistantName}
      {/if}
    </button>
  {/if}

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

  <div class="chat-backdrop" class:open={chatOpen} onclick={() => chatOpen = false} role="presentation"></div>

  <aside class="chat" class:open={chatOpen} aria-hidden={!chatOpen}
    use:swipeClose={() => chatOpen = false}>
    <header class="chat-header">
      <span>Ask {data.assistantName} about this trip</span>
      <div class="chat-header-actions">
        {#if chatMessages.length > 0}
          <button class="chat-clear" onclick={clearChat} disabled={chatBusy} title="Clear conversation history">Clear</button>
        {/if}
        <button class="chat-close" onclick={() => chatOpen = false} aria-label="Close chat">✕</button>
      </div>
    </header>

    <div class="chat-log">
      {#if chatMessages.length === 0}
        <div class="assistant-card chat-empty">
          <div class="assistant-card__header">
            <Logo variant="primary" size={22} />
            <div class="assistant-card__label">{data.assistantName} says…</div>
          </div>
          <div class="assistant-card__body">
            <p>Ask for changes in plain English. A few examples to start:</p>
            <ul>
              <li>"Add a half-day in Leavenworth on the way."</li>
              <li>"Trim the route down to one direct option."</li>
              <li>"Suggest a vegetarian-friendly dinner spot in Atchison."</li>
            </ul>
            <p class="hint">I can edit your section files directly. Changes apply on save.</p>
          </div>
        </div>
      {:else}
        {#each chatMessages as m}
          <div class="msg" class:user={m.role === 'user'} class:assistant={m.role === 'assistant'}>
            <div class="msg-body">{m.content}</div>
            {#if m.updated && m.updated.length > 0}
              <div class="msg-updates">
                Updated: {m.updated.map(s => SECTION_LABELS[s] || s).join(', ')}
              </div>
            {/if}
            {#if m.tokens}
              <div class="msg-tokens">{formatTokens(m.tokens)}</div>
            {/if}
          </div>
        {/each}
        {#if chatBusy}
          <div class="msg assistant"><div class="msg-body typing"><span></span><span></span><span></span></div></div>
        {/if}
      {/if}
    </div>

    <form class="chat-input" onsubmit={(e) => { e.preventDefault(); sendChat(); }}>
      <textarea
        bind:value={chatInput}
        onkeydown={handleChatKey}
        placeholder="What should change?"
        rows="2"
        disabled={chatBusy}
      ></textarea>
      <PromiseTooltip promise={CHAT_PROMISE}>
        <button type="submit" class="send-btn" disabled={chatBusy || !chatInput.trim()}>
          {#if chatBusy}
            <span class="spinner" aria-hidden="true"></span>
          {/if}
          {chatBusy ? 'Sending…' : 'Send'}
        </button>
      </PromiseTooltip>
    </form>
    {#if chatErrorCode}
      <div class="chat-error" role="alert">
        <p class="chat-error-sentence">{failureSentence(chatErrorCode, chatErrorContext ?? {})}</p>
        <AffordanceButtons
          affordances={ERROR_REGISTRY[chatErrorCode]?.affordances ?? ['retry', 'dismiss']}
          size="sm"
          onretry={retryChatSend}
          ondismiss={dismissChatError}
        />
      </div>
    {/if}
  </aside>
</div>

<style>
  /* Reset app-shell rules leaked from the home page's :global(html, body) */
  :global(html, body) { height: auto; overflow: auto; }

  .page {
    min-height: 100vh;
    background: var(--surface-page);
    color: var(--text-primary);
    font-family: var(--font-sans);
    display: flex;
    flex-direction: column;
  }

  .page > header {
    background: var(--forest-800);
    color: var(--bone-200);
    border-bottom: 1px solid var(--border-default);
    padding: 1.1rem 1.75rem;
    display: flex;
    align-items: center;
    gap: 0.9rem;
    flex-wrap: wrap;
  }

  /* Per-trip job badge inside the page header. Pushes to the right of the meta
     block; wraps gracefully on small screens thanks to flex-wrap on the header. */
  .header-job-badge {
    margin-left: auto;
  }

  /* ── Read / Edit mode toggle ── */
  .edit-mode-toggle {
    background: none;
    border: 1.5px solid var(--forest-600);
    color: var(--bone-200);
    padding: 0.45rem 0.85rem;
    min-height: var(--tap-min);
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.78rem;
    font-weight: 600;
    font-family: var(--font-sans);
    transition: background 0.12s, border-color 0.12s, color 0.12s;
  }
  .edit-mode-toggle:hover {
    background: var(--forest-800);
    border-color: var(--forest-400);
    color: var(--bone-100);
  }
  /* Active state uses the project sunset palette (the amber tokens these
     CSS lines previously referenced don't exist in app.css, so the page
     was stuck on the hex fallbacks regardless of theme). */
  .edit-mode-toggle.active {
    background: var(--sunset-50);
    border-color: var(--sunset-200);
    color: var(--sunset-800);
  }
  .edit-mode-toggle.active:hover {
    background: var(--sunset-100);
    border-color: var(--sunset-400);
    color: var(--sunset-900);
  }

  /* ── Editing banner ── */
  .editing-banner {
    padding: 0.55rem 0.95rem;
    background: var(--sunset-50);
    border: 1px solid var(--sunset-200);
    border-radius: 4px;
    font-size: 0.82rem;
    color: var(--sunset-800);
    line-height: 1.45;
  }

  .back {
    background: none;
    border: 1.5px solid var(--forest-600);
    color: var(--bone-200);
    padding: 0.35rem 0.75rem;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.78rem;
    font-weight: 600;
    font-family: var(--font-sans);
    transition: background 0.12s, border-color 0.12s, color 0.12s;
  }
  .back:hover {
    background: var(--forest-800);
    border-color: var(--forest-400);
    color: var(--bone-100);
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
    flex: 1;
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
     and the background tint + matching border already carry the affordance. */
  .callout {
    background: var(--forest-50);
    color: var(--forest-800);
    border: 1px solid var(--forest-100);
    border-radius: 4px;
    padding: 0.7rem 0.95rem;
    font-size: 0.84rem;
    line-height: 1.55;
  }
  .callout.warn {
    background: var(--sunset-50);
    color: var(--sunset-800);
    border-color: var(--sunset-100);
  }
  .callout.completed-callout {
    background: var(--bark-50);
    color: var(--bark-600);
    border-color: var(--bark-100);
  }
  /* ── Receipts inline result / error ── */
  .receipts-success {
    margin-top: 0.6rem;
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--forest-700);
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
    background: var(--sunset-50, #fff5f0);
    border: 1px solid var(--embers-600);
    border-radius: 4px;
    max-width: 28rem;
  }
  .receipts-error-sentence {
    margin: 0;
    font-size: 0.82rem;
    color: var(--text-primary);
    line-height: 1.4;
  }
  /* The map now carries route geometry, home + destination markers, and
     numbered stop pins when a brochure exists. Claiming ~40vh on desktop
     gives the route enough room to read; the parent height clamps prevent
     it from dominating short viewports. */
  .map-section {
    height: 40vh;
    min-height: 280px;
    max-height: 480px;
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
  .editor:focus { outline: 2px solid var(--forest-200); outline-offset: 1px; }

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
  .prose :global(a) { color: var(--forest-600); text-decoration: none; }
  .prose :global(a:hover) { text-decoration: underline; }
  .prose :global(table) { width: 100%; border-collapse: collapse; font-size: 0.86rem; margin: 0 0 1rem; }
  .prose :global(th) { text-align: left; font-weight: 700; padding: 0.4rem 0.6rem; border-bottom: 2px solid var(--border-default); color: var(--text-primary); }
  .prose :global(td) { padding: 0.35rem 0.6rem; border-bottom: 1px solid var(--border-subtle); vertical-align: top; }
  .prose :global(code) { font-family: monospace; font-size: 0.82em; background: var(--forest-50); color: var(--forest-800); padding: 0.1em 0.4em; border-radius: 3px; }

  /* ── Brochure error banner (replaces .brochure-error inside old brochure-zone) ── */
  .brochure-error-banner {
    padding: 0.55rem 0.85rem;
    background: var(--sunset-50);
    border: 1px solid var(--embers-600);
    border-radius: 4px;
    font-size: 0.82rem;
    color: var(--embers-600);
    line-height: 1.45;
  }

  .deepen-section-error {
    font-size: 0.78rem;
    color: var(--embers-600);
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
    background: rgba(168, 47, 31, 0.08);
    border-color: var(--state-danger);
  }
  .action-error-dismiss:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }

  /* ── AI chat ── */
  .chat-fab {
    position: fixed;
    bottom: 1.5rem;
    right: 1.5rem;
    background: var(--forest-800);
    color: var(--bone-50);
    border: none;
    padding: 0.85rem 1.2rem;
    min-height: var(--tap-min);
    border-radius: 999px;
    font-size: 0.86rem;
    font-weight: 700;
    font-family: var(--font-sans);
    cursor: pointer;
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.18);
    z-index: 902;
    transition: transform 0.12s, box-shadow 0.12s;
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
  }
  .chat-fab:hover { transform: translateY(-1px); box-shadow: 0 9px 22px rgba(0, 0, 0, 0.22); }
  .chat-fab.open { background: var(--forest-900); }
  .fab-icon { display: block; }

  .chat-backdrop {
    position: fixed; inset: 0;
    background: rgba(20, 20, 20, 0.4);
    z-index: 902;
    opacity: 0; pointer-events: none;
    transition: opacity 0.25s;
  }
  .chat-backdrop.open { opacity: 1; pointer-events: auto; }

  .chat {
    position: fixed;
    top: 0; right: 0;
    width: 420px; max-width: 100vw; height: 100vh;
    background: var(--surface-raised);
    box-shadow: -10px 0 30px rgba(0, 0, 0, 0.15);
    z-index: 903;
    display: flex;
    flex-direction: column;
    transform: translateX(100%);
    transition: transform 0.28s cubic-bezier(0.22, 1, 0.36, 1);
  }
  .chat.open { transform: translateX(0); }

  .chat-header {
    background: var(--forest-800);
    color: var(--bone-200);
    padding: 0.85rem 1.1rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 0.85rem;
    font-weight: 700;
  }
  .chat-header-actions { display: flex; align-items: center; gap: 0.4rem; }
  .chat-close {
    background: none; border: none; color: var(--bone-400);
    cursor: pointer; font-size: 1rem; line-height: 1;
    padding: 0.2rem 0.35rem; border-radius: 3px;
  }
  .chat-close:hover { color: var(--bone-200); background: rgba(255, 255, 255, 0.08); }
  .chat-clear {
    background: none; border: 1px solid rgba(255, 255, 255, 0.18); color: var(--bone-400);
    cursor: pointer; font-size: 0.7rem; font-weight: 500; line-height: 1;
    padding: 0.3rem 0.55rem; border-radius: 3px; letter-spacing: 0.04em; text-transform: uppercase;
  }
  .chat-clear:hover:not(:disabled) { color: var(--bone-200); background: rgba(255, 255, 255, 0.08); }
  .chat-clear:disabled { opacity: 0.4; cursor: not-allowed; }

  .chat-log {
    flex: 1;
    overflow-y: auto;
    padding: 1rem 1.1rem;
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
  }

  .chat-empty .assistant-card__body p { margin: 0 0 0.5rem; }
  .chat-empty .assistant-card__body ul { margin: 0.4rem 0 0.5rem 1.2rem; padding: 0; }
  .chat-empty .assistant-card__body li { margin-bottom: 0.25rem; }
  .chat-empty .assistant-card__body .hint {
    color: var(--text-tertiary);
    font-size: 0.78rem;
    margin-top: 0.5rem;
  }

  .msg {
    max-width: 88%;
    padding: 0.55rem 0.75rem;
    border-radius: 8px;
    font-size: 0.86rem;
    line-height: 1.5;
    white-space: pre-wrap;
  }
  .msg.user {
    align-self: flex-end;
    background: var(--forest-800);
    color: var(--bone-50);
    border-bottom-right-radius: 2px;
  }
  .msg.assistant {
    align-self: flex-start;
    background: var(--surface-sunken);
    color: var(--bark-800);
    border-bottom-left-radius: 2px;
  }
  .msg-updates {
    margin-top: 0.4rem;
    font-size: 0.72rem;
    font-weight: 700;
    color: var(--planning-text);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  /* Opacity-pulse instead of the previous translateY hop; the bounce read
     as a dated chat-bubble loader. Staggered phases preserve the
     "something's being typed" cadence without any vertical motion. */
  .typing { display: inline-flex; gap: 4px; align-items: center; }
  .typing span {
    width: 6px; height: 6px;
    background: var(--text-tertiary);
    border-radius: 50%;
    animation: typing-pulse 1.2s infinite ease-in-out;
  }
  .typing span:nth-child(2) { animation-delay: 0.15s; }
  .typing span:nth-child(3) { animation-delay: 0.3s; }
  @keyframes typing-pulse { 0%, 80%, 100% { opacity: 0.3; } 40% { opacity: 1; } }

  .chat-input {
    border-top: 1px solid var(--border-default);
    padding: 0.75rem 0.9rem;
    display: flex;
    gap: 0.5rem;
    align-items: flex-end;
    background: var(--surface-raised);
  }
  .chat-input textarea {
    flex: 1;
    border: 1px solid var(--border-default);
    border-radius: 4px;
    padding: 0.5rem 0.65rem;
    font-family: var(--font-sans);
    font-size: 0.86rem;
    line-height: 1.45;
    color: var(--text-primary);
    background: var(--surface-page);
    resize: none;
  }
  .chat-input textarea:focus { outline: 2px solid var(--forest-200); outline-offset: 1px; }
  .chat-input .send-btn {
    background: var(--forest-800);
    color: var(--bone-50);
    border: none;
    padding: 0.5rem 0.95rem;
    border-radius: 4px;
    font-size: 0.82rem;
    font-weight: 700;
    font-family: var(--font-sans);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 0.38rem;
    white-space: nowrap;
  }
  .chat-input .send-btn:disabled { opacity: 0.5; cursor: not-allowed; }

  /* Spinner inside the send button — matches InstantInlineStatus.svelte's .spinner */
  @keyframes chat-spin { to { transform: rotate(360deg); } }
  .chat-input .spinner {
    width: 11px; height: 11px;
    border: 1.5px solid rgba(255, 255, 255, 0.35);
    border-top-color: #fff;
    border-radius: 50%;
    animation: chat-spin 0.8s linear infinite;
    flex-shrink: 0;
  }

  /* Inline error envelope below the chat input area */
  .chat-error {
    padding: 0.6rem 0.9rem 0.7rem;
    background: var(--sunset-50, #fff5f0);
    border-top: 1px solid var(--embers-600);
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .chat-error-sentence {
    margin: 0;
    font-size: 0.78rem;
    color: var(--text-primary);
    line-height: 1.4;
  }

  /* Per-turn token count — subtle dim text below assistant message */
  .msg-tokens {
    margin-top: 0.3rem;
    font-size: 0.68rem;
    color: var(--text-tertiary);
    font-variant-numeric: tabular-nums;
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
  .itinerary-view :global(h2) {
    font-size: 1rem;
    font-weight: 800;
    letter-spacing: -0.01em;
    color: var(--text-primary);
    margin: 0;
    padding: 0.7rem 1.1rem 0.6rem;
    background: var(--sunset-50);
    border-radius: 4px 4px 0 0;
    border-bottom: 1px solid var(--sunset-200);
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

  /* ── Legacy itinerary CTA (shown below prose itinerary when no brochure exists) ── */
  .itinerary-legacy-cta {
    margin-top: 1rem;
    font-size: 0.85rem;
    color: var(--text-secondary, #64748b);
  }

  /* ── Brochure staleness notice ── */
  .brochure-stale-notice {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.6rem 1rem;
    background: var(--sunset-50);
    border: 1px solid var(--sunset-200);
    border-radius: 6px;
    font-size: 0.85rem;
    color: var(--sunset-800);
    margin-top: 0.5rem;
  }
  .brochure-stale-notice span { flex: 1; }

  /* ── Print styles ── */
  @media print {
    .page > header,
    .chat-fab,
    .chat-backdrop,
    .chat,
    .callout,
    .map-section,
    .hero,
    .no-print { display: none !important; }

    .page { background: #fff; color: #111; }
    .layout { padding: 0; }
    .content { max-width: 100%; }

    .itinerary-view :global(h2) {
      background: #f5f0e8;
      border-bottom-color: #92400e;
      color: #1a1a1a;
      page-break-after: avoid;
    }
    .itinerary-view :global(h3) { color: #666; }
    .itinerary-view :global(p),
    .itinerary-view :global(li) { color: #333; font-size: 10pt; }
    .itinerary-view { page-break-inside: avoid; }
  }

  @media (max-width: 768px) {
    .page > header { padding: 0.85rem 1rem; gap: 0.55rem; }
    .page > header h1 { font-size: 1.05rem; }
    .meta { width: 100%; margin-left: 0; }
    .hero { height: 200px; }
    .map-section { height: 30vh; min-height: 220px; max-height: 320px; }
    .layout { padding: 1rem 0.85rem 6rem; }
    .section { padding: 1rem 1.1rem 1.2rem; }
    .chat { width: 100vw; }
    .chat-fab { bottom: 1rem; right: 1rem; padding: 0.75rem 1rem; }
  }
</style>

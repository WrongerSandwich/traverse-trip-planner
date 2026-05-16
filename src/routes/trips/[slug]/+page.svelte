<script>
  import { marked } from 'marked';
  import { untrack } from 'svelte';
  import { invalidateAll, goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import MiniMap from '$lib/components/MiniMap.svelte';
  import Logo from '$lib/components/Logo.svelte';
  import RetroModal from '$lib/components/RetroModal.svelte';
  import ConfirmModal from '$lib/components/ConfirmModal.svelte';
  import PromiseTooltip from '$lib/components/PromiseTooltip.svelte';
  import AffordanceButtons from '$lib/workflow-status/AffordanceButtons.svelte';
  import { failureSentence, ERROR_REGISTRY } from '$lib/errors-registry.js';
  import { formatTokens } from '$lib/utils/formatTokens.js';
  import TripJobBadge from '$lib/components/TripJobBadge.svelte';
  import { receiptsErrorFromStatus } from '$lib/utils/receiptsErrors.js';
  import StreamBanner from '$lib/workflow-status/StreamBanner.svelte';
  import { tripColor } from '$lib/utils/colors.js';
  import { swipeClose } from '$lib/actions/swipeClose.js';
  import { streamAction } from '$lib/utils/action.js';
  import { filterJobsForSlug } from '$lib/utils/jobLabels.js';
  import { browser } from '$app/environment';

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

  // Canonical section sets per stage (itinerary handled separately above the list)
  const STAGE_SECTIONS = {
    planning:  ['overview', 'route', 'stops', 'logistics'],
    completed: ['overview', 'route', 'stops', 'logistics', 'notes'],
  };

  const trip = $derived(data.trip);
  const stage = $derived(data.stage);
  const isPlanning = $derived(stage === 'planning');
  const isCompleted = $derived(stage === 'completed');
  const isLocked = $derived(trip?.locked === 'true');

  // Local section content state, seeded from server load. Edits live here
  // until saved — intentionally initial-only (don't re-sync on every load),
  // so untrack() to silence the "captures initial value" lint.
  let sections = $state(untrack(() => ({ ...data.files })));
  // Per-section UI state
  let editing = $state({});      // { route: true, ... }
  let drafts  = $state({});      // staging textareas while editing
  let saving  = $state({});
  // ── Lock state (In-Page Stream archetype) ──
  // lockState: 'idle' | 'in_progress' | 'success' | 'failure' | 'cancelled'
  let lockState = $state('idle');
  let lockStreamingText = $state('');
  let lockTokens = $state(null);       // number | null — populated from done event
  let lockErrorCode = $state(null);    // TraverseError code string | null
  let lockElapsed = $state(0);         // seconds elapsed while in_progress
  let lockAborter = $state(null);      // AbortController | null
  let lockElapsedTimer = null;         // setInterval handle

  const locking = $derived(lockState === 'in_progress');
  let completing = $state(false);

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

  // Show the "Research this section →" button only when the feature is enabled,
  // the trip is not locked/completed, and the section is a researchable type.
  const RESEARCHABLE = new Set(['route', 'stops', 'logistics']);
  const canResearchSection = $derived(
    stage === 'planning' && !isLocked &&
    Boolean(data.features?.deepen)
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

  let deepenSectionError = $state(/** @type {string|null} */ (null));

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
        deepenSectionError = 'Already researching a section for this trip — see the jobs indicator at the top of the page.';
        return;
      }
      if (!res.ok && res.status !== 202) {
        deepenSectionError = `Couldn't start section research (${res.status}).`;
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
    } catch (err) {
      deepenSectionError = `Network error: ${err.message}`;
    }
  }

  function startEdit(section) {
    drafts[section] = sections[section] ?? '';
    editing[section] = true;
  }

  function cancelEdit(section) {
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
      alert(`Couldn't save those edits — ${err.message}`);
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

  // ── Lock / Unlock ──

  function startLockElapsedTimer() {
    lockElapsed = 0;
    if (lockElapsedTimer) clearInterval(lockElapsedTimer);
    lockElapsedTimer = setInterval(() => { lockElapsed += 1; }, 1000);
  }

  function stopLockElapsedTimer() {
    if (lockElapsedTimer) { clearInterval(lockElapsedTimer); lockElapsedTimer = null; }
  }

  /** Elapsed + estimated-remaining label for the banner, e.g. "12s · ~18s remaining" */
  const lockEstimateRemaining = $derived.by(() => {
    if (lockState !== 'in_progress') return null;
    const remaining = Math.max(0, LOCK_PROMISE.time_seconds - lockElapsed);
    if (remaining === 0) return `${lockElapsed}s elapsed`;
    return `${lockElapsed}s · ~${remaining}s remaining`;
  });

  async function lockTrip() {
    if (!trip || locking) return;

    // Confirm before starting (long-form promise in modal body).
    const ok = await showConfirm({
      title: 'Generate itinerary?',
      promise: LOCK_PROMISE,
      confirmLabel: 'Generate itinerary',
    });
    if (!ok) return;

    // Reset state and begin.
    lockState = 'in_progress';
    lockStreamingText = '';
    lockTokens = null;
    lockErrorCode = null;
    lockAborter = new AbortController();
    startLockElapsedTimer();

    try {
      await streamAction(
        `/api/lock/${encodeURIComponent(trip._slug)}`,
        ({ msg, done, tokens }) => {
          if (msg.startsWith('itinerary:')) {
            lockStreamingText += msg.slice('itinerary:'.length);
          }
          if (done) {
            if (msg.toLowerCase().startsWith('error:')) {
              lockState = 'failure';
              // Try to extract a TraverseError code from the message.
              // The server emits "Error: Itinerary generation failed: …" for generic
              // errors and "Error: <TraverseError message>" for typed ones.
              // We surface a generic 'network_error' code when we can't parse a known code.
              lockErrorCode = 'network_error';
            } else {
              lockState = 'success';
              if (tokens) lockTokens = tokens;
              // Trigger page reload to show the locked state / itinerary tab.
              invalidateAll();
            }
          }
        },
        null,
        lockAborter.signal,
      );
      // streamAction resolves silently on abort (abort = cancel).
      if (lockState === 'in_progress') {
        lockState = 'cancelled';
      }
    } catch (err) {
      console.error(err);
      lockState = 'failure';
      lockErrorCode = 'network_error';
    } finally {
      stopLockElapsedTimer();
      lockAborter = null;
    }
  }

  function cancelLock() {
    if (lockAborter) {
      lockAborter.abort();
      // State transitions to 'cancelled' in the finally block of lockTrip.
    }
  }

  function dismissLock() {
    lockState = 'idle';
    lockStreamingText = '';
    lockTokens = null;
    lockErrorCode = null;
  }

  async function unlockTrip() {
    if (!trip) return;
    try {
      const res = await fetch(`/api/lock/${encodeURIComponent(trip._slug)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`Unlock failed: ${res.status}`);
      await invalidateAll();
    } catch (err) {
      console.error(err);
      alert("Couldn't unlock the trip. The server log may have more detail.");
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
      alert("Couldn't mark the trip as completed. The server log may have more detail.");
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
      alert("Couldn't enable sharing. The server log may have more detail.");
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
      alert("Couldn't disable sharing. The server log may have more detail.");
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

  // ── Lock promise (mirrors _promise from the lock route) ──
  // Telemetry-resolved values come from `data.promises.lock` (see
  // src/lib/server/promises.js). The fallback keeps PromiseTooltip /
  // ConfirmModal rendering when the server-load hasn't delivered them yet.
  const LOCK_FALLBACK = {
    verb: 'Generate itinerary',
    produces: 'A day-by-day itinerary synthesized from your planning sections, streamed in real time as it generates.',
    time_seconds: 30,
    tokens_range: [2000, 4000],
  };
  const LOCK_PROMISE = $derived(data.promises?.lock ?? LOCK_FALLBACK);

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
    produces: 'A structured brochure draft — stops with map pins, lodging, field guide notes, and gotchas — ready to review before saving.',
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

  let brochureError = $state(null);

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
        brochureError = 'Already preparing this brochure — see the jobs indicator at the top of the page.';
        return;
      }
      if (!res.ok && res.status !== 202) {
        brochureError = `Couldn't start brochure prep (${res.status}).`;
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
    } catch (err) {
      brochureError = `Network error: ${err.message}`;
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
      alert("Couldn't archive that one. The server log may have more detail.");
    }
  }


</script>

<svelte:head>
  <title>{trip?.title || trip?._slug} — Traverse</title>
</svelte:head>

<div class="page">
  <header>
    <button class="back" onclick={() => goto('/')} aria-label="Back to all trips">← All trips</button>
    <span class="stage-pill" class:locked-pill={isLocked && isPlanning}>{isLocked && isPlanning ? 'locked' : (stage || 'planning')}</span>
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
      {#if isPlanning && !isLocked}
        <div class="callout">
          <strong>Planning mode.</strong>
          Edit any section below, or tap <em>Ask {data.assistantName}</em> to describe a change in plain English — updates are written straight to the markdown.
          <div class="callout-actions">
            <PromiseTooltip promise={LOCK_PROMISE}>
              <button
                class="btn btn-primary"
                onclick={lockTrip}
                disabled={locking || !data.features?.lock}
                title={data.features?.lock ? undefined : 'No default model configured — edit your .env to enable this'}
              >
                {locking ? 'Generating itinerary…' : 'Lock trip & generate itinerary'}
              </button>
            </PromiseTooltip>
            <a class="btn btn-secondary" href={`/trips/${encodeURIComponent(trip._slug)}/brochure`} target="_blank" rel="noopener">Preview brochure</a>
            <button class="btn btn-secondary" onclick={completeTrip} disabled={completing || locking}>
              {completing ? 'Completing…' : 'Mark as completed'}
            </button>
          </div>
        </div>

        {#if lockState !== 'idle'}
          <div class="lock-stream-wrap">
            <StreamBanner
              state={lockState}
              title="Generating itinerary…"
              successTitle="Trip locked"
              tokens={lockTokens}
              estimateRemaining={lockEstimateRemaining}
              errorCode={lockErrorCode}
              oncancel={cancelLock}
              onretry={lockTrip}
              ondismiss={dismissLock}
            />
            {#if lockStreamingText}
              <pre class="lock-preview" aria-label="Itinerary preview">{lockStreamingText}</pre>
            {/if}
          </div>
        {/if}
      {:else if isPlanning && isLocked}
        <div id="locked-callout" class="callout locked-callout">
          <strong>Locked — read-only.</strong>
          Editing is frozen. The itinerary below was generated from your planning sections.
          <div class="callout-actions">
            <button class="btn btn-secondary" onclick={unlockTrip}>Unlock to edit</button>
            <a class="btn btn-secondary" href={`/trips/${encodeURIComponent(trip._slug)}/brochure`} target="_blank" rel="noopener">View brochure</a>
            <button class="btn btn-secondary" onclick={completeTrip} disabled={completing}>
              {completing ? 'Completing…' : 'Mark as completed'}
            </button>
          </div>
        </div>
      {:else if isCompleted}
        <div class="callout completed-callout">
          <strong>Completed.</strong>
          This trip is done. All sections are preserved below.
          {#if (!hasNotes && data.features?.retro) || data.features?.receipts}
            <div class="callout-actions">
              {#if !hasNotes && data.features?.retro}
                <button class="btn btn-secondary" onclick={() => retroOpen = true}>
                  Add retro
                </button>
              {/if}
              {#if data.features?.receipts}
                <PromiseTooltip promise={RECEIPTS_PROMISE}>
                  <button
                    class="btn btn-secondary"
                    onclick={openReceiptPicker}
                    disabled={receiptsStatus === 'uploading'}
                  >
                    {#if receiptsStatus === 'uploading'}
                      <span class="btn-spinner" aria-hidden="true"></span>
                      Parsing receipts…
                    {:else}
                      Add receipts
                    {/if}
                  </button>
                </PromiseTooltip>
                <input
                  bind:this={receiptsInput}
                  type="file"
                  accept="image/*"
                  multiple
                  style="display:none"
                  onchange={uploadReceipts}
                />
              {/if}
            </div>
          {/if}
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
      {:else}
        <div class="callout warn">
          This trip is in <strong>{stage}</strong>. Move it to Planning from the cards view to enable editing.
        </div>
      {/if}

      {#if Array.isArray(trip?._coords)}
        <div class="map-strip">
          <MiniMap coords={trip._coords} color={markerColor} zoom={9} interactive={true} />
        </div>
      {/if}

      {#if (isLocked || isCompleted) && sections.itinerary}
        <div class="itinerary-view">
          {@html marked.parse(sections.itinerary || '')}
        </div>
      {/if}

      {#each canonicalSections as section}
        <section class="section">
          <header class="section-header">
            <h2>{SECTION_LABELS[section] || section}</h2>
            {#if isPlanning && !isLocked && sections[section] !== undefined && !editing[section]}
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
                    title={deepenSectionRunning ? 'Already running — see indicator' : undefined}
                  >
                    {deepenSectionRunning ? 'Researching…' : 'Research this section →'}
                  </button>
                </PromiseTooltip>
              {:else if isLocked && RESEARCHABLE.has(section)}
                <p class="section-locked-hint"><a href="#locked-callout">Unlock the trip</a> to research this section.</p>
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
            <div class="prose">{@html marked.parse(sections[section] || '')}</div>
          {/if}
        </section>
      {/each}

      {#if data.features?.share}
        <div class="share-zone">
          {#if shareUrl}
            <div class="share-active">
              <input class="share-url" type="text" readonly value={shareUrl} onfocus={(e) => e.target.select()} />
              <button class="share-copy" onclick={copyShareUrl} type="button">Copy</button>
              <button class="share-disable" onclick={disableShare} disabled={shareBusy}>Disable</button>
            </div>
            <span class="share-hint">Anyone with this link can view the trip read-only. Disabling revokes access immediately.</span>
          {:else}
            <button class="share-enable" onclick={enableShare} disabled={shareBusy}>
              {shareBusy ? 'Generating…' : 'Generate share link'}
            </button>
            <span class="share-hint">Creates a public read-only URL anyone can view (no Traverse account needed).</span>
          {/if}
        </div>
      {/if}

      {#if deepenSectionError}
        <div class="deepen-section-error" role="alert">{deepenSectionError}</div>
      {/if}

      <div class="brochure-zone">
        <div class="brochure-row">
          <a class="btn btn-secondary btn-compact" href={`/trips/${encodeURIComponent(trip._slug)}/brochure`} target="_blank" rel="noopener">View brochure</a>
          <a class="btn btn-secondary btn-compact" href={`/trips/${encodeURIComponent(trip._slug)}/brochure/prepare`}>Open prepare form</a>
          <PromiseTooltip promise={BROCHURE_PROMISE}>
            <button
              type="button"
              class="btn btn-primary btn-compact"
              onclick={prepareBrochure}
              disabled={brochureRunning}
              title={brochureRunning ? 'Already running — see indicator' : undefined}
            >
              {brochureRunning ? 'Preparing…' : 'Prepare brochure'}
            </button>
          </PromiseTooltip>
        </div>
        {#if brochureError}
          <span class="brochure-error">{brochureError}</span>
        {:else}
          <span class="archive-hint">
            The Field guide reads your notes and proposes a structured set of stops, lodging, and notes for the brochure. The job runs in the background — the indicator at the top of the page will tell you when it's ready.
          </span>
        {/if}
      </div>

      {#if !isCompleted}
        <div class="danger-zone">
          <button class="btn btn-danger btn-compact" onclick={archiveTrip}>Archive trip</button>
          <span class="archive-hint">Hides it from view but keeps the file so it won't be re-suggested.</span>
        </div>
      {/if}
    </main>
  </div>

  {#if !isLocked && !isCompleted && data.features?.chat}
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
            <p class="hint">I can edit your section files directly — changes apply on save.</p>
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
    background: var(--surface-invert);
    color: var(--text-inverse);
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

  .back {
    background: none;
    border: 1.5px solid var(--forest-600);
    color: var(--bone-400);
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
  .stage-pill.locked-pill {
    background: var(--sunset-50);
    color: var(--sunset-800);
  }

  .page > header h1 {
    font-family: var(--font-serif);
    font-size: 1.4rem;
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
    color: var(--bone-400);
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
  .meta .cost { font-weight: 700; color: var(--bone-100); }

  .hero {
    position: relative;
    height: 280px;
    overflow: hidden;
    background: var(--bone-400);
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
    max-width: 760px;
    display: flex;
    flex-direction: column;
    gap: 1.4rem;
  }

  .callout {
    background: var(--forest-50);
    color: var(--forest-800);
    border-left: 3px solid var(--forest-800);
    padding: 0.7rem 0.95rem;
    font-size: 0.84rem;
    line-height: 1.55;
  }
  .callout.warn {
    background: var(--sunset-50);
    color: var(--sunset-800);
    border-left-color: var(--sunset-600);
  }
  .callout.locked-callout {
    background: var(--sunset-50);
    color: var(--sunset-800);
    border-left-color: var(--sunset-600);
  }
  .callout-actions {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
    margin-top: 0.65rem;
  }
  /* lock-stream-wrap: StreamBanner + preview pre, rendered as a section-level card */
  .lock-stream-wrap {
    display: flex;
    flex-direction: column;
    gap: 0;
    border-radius: 6px;
    overflow: hidden;
    border: 1px solid var(--bone-200);
  }
  .lock-preview {
    margin: 0;
    max-height: 280px;
    overflow-y: auto;
    background: var(--bone-50);
    border: 1px solid var(--bone-200);
    border-radius: 4px;
    padding: 0.75rem 0.9rem;
    font-family: var(--font-sans);
    font-size: 0.78rem;
    line-height: 1.55;
    white-space: pre-wrap;
    color: var(--text-primary);
  }
  .callout.completed-callout {
    background: var(--bark-50);
    color: var(--bark-600);
    border-left-color: var(--bark-400);
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
  /* Spinner inside a standard btn (matches Instant Inline shape) */
  @keyframes btn-spin { to { transform: rotate(360deg); } }
  .btn-spinner {
    display: inline-block;
    width: 11px;
    height: 11px;
    border: 1.5px solid rgba(0, 0, 0, 0.2);
    border-top-color: currentColor;
    border-radius: 50%;
    animation: btn-spin 0.8s linear infinite;
    vertical-align: middle;
    flex-shrink: 0;
  }

  .map-strip {
    height: 220px;
    border-radius: 6px;
    overflow: hidden;
    background: var(--bone-400);
  }

  .section {
    background: var(--surface-raised);
    border: 1px solid var(--bone-200);
    border-radius: 6px;
    padding: 1.25rem 1.4rem 1.5rem;
  }

  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.75rem;
    border-bottom: 1px solid var(--bone-200);
    padding-bottom: 0.55rem;
  }
  .section-header h2 {
    font-size: 1.05rem;
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
    border: 1px solid var(--bone-400);
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

  .section-locked-hint {
    font-size: 0.86rem;
    color: var(--text-tertiary);
    margin: 0;
  }

  .prose { font-size: 0.92rem; line-height: 1.75; color: var(--text-secondary); }
  .prose :global(h1), .prose :global(h2) {
    font-size: 1rem; font-weight: 700; margin: 1.4rem 0 0.5rem;
    color: var(--text-primary); letter-spacing: -0.015em;
  }
  .prose :global(h3) { font-size: 0.92rem; font-weight: 700; margin: 1.1rem 0 0.35rem; color: var(--text-primary); }
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
  .prose :global(th) { text-align: left; font-weight: 700; padding: 0.4rem 0.6rem; border-bottom: 2px solid var(--bone-400); color: var(--text-primary); }
  .prose :global(td) { padding: 0.35rem 0.6rem; border-bottom: 1px solid var(--bone-200); vertical-align: top; }
  .prose :global(code) { font-family: monospace; font-size: 0.82em; background: var(--forest-50); color: var(--forest-800); padding: 0.1em 0.4em; border-radius: 3px; }

  /* ── Danger zone (archive) ── */
  .share-zone {
    margin-top: 1.25rem;
    padding: 1rem 0 0;
    border-top: 1px dashed var(--bone-400);
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.45rem;
  }
  .share-active { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; width: 100%; }
  .share-url {
    flex: 1; min-width: 220px;
    font-family: var(--font-sans);
    font-size: 0.78rem;
    padding: 0.4rem 0.6rem;
    border: 1px solid var(--bone-400);
    border-radius: 3px;
    background: var(--surface-page);
    color: var(--text-secondary);
  }
  .share-enable, .share-copy, .share-disable {
    background: none;
    border: 1px solid var(--bone-400);
    color: var(--text-secondary);
    font-family: var(--font-sans);
    font-size: 0.74rem;
    font-weight: 600;
    padding: 0.32rem 0.7rem;
    border-radius: 3px;
    cursor: pointer;
    transition: border-color 0.12s, color 0.12s, background 0.12s;
  }
  .share-enable:hover:not(:disabled),
  .share-copy:hover:not(:disabled) {
    border-color: var(--forest-200);
    color: var(--forest-800);
    background: var(--forest-50);
  }
  .share-disable:hover:not(:disabled) {
    border-color: var(--embers-600);
    color: var(--embers-600);
    background: var(--sunset-50);
  }
  .share-enable:disabled, .share-copy:disabled, .share-disable:disabled { opacity: 0.5; cursor: not-allowed; }
  .share-hint { font-size: 0.72rem; color: var(--text-tertiary); line-height: 1.45; }

  .brochure-zone,
  .danger-zone {
    margin-top: 1rem;
    padding: 1.1rem 0 0;
    border-top: 1px dashed var(--bone-400);
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.4rem;
  }
  .brochure-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .archive-hint { font-size: 0.72rem; color: var(--text-tertiary); line-height: 1.45; }
  .brochure-error {
    font-size: 0.78rem;
    color: var(--embers-600);
    line-height: 1.45;
  }

  .deepen-section-error {
    font-size: 0.78rem;
    color: var(--embers-600);
    line-height: 1.45;
    margin-top: 0.25rem;
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
    background: var(--surface-invert);
    color: var(--text-inverse);
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
  .chat-close:hover { color: var(--text-inverse); background: rgba(255, 255, 255, 0.08); }
  .chat-clear {
    background: none; border: 1px solid rgba(255, 255, 255, 0.18); color: var(--bone-400);
    cursor: pointer; font-size: 0.7rem; font-weight: 500; line-height: 1;
    padding: 0.3rem 0.55rem; border-radius: 3px; letter-spacing: 0.04em; text-transform: uppercase;
  }
  .chat-clear:hover:not(:disabled) { color: var(--text-inverse); background: rgba(255, 255, 255, 0.08); }
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
    color: var(--bone-600);
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
  .typing { display: inline-flex; gap: 4px; }
  .typing span {
    width: 6px; height: 6px;
    background: var(--text-tertiary);
    border-radius: 50%;
    animation: bounce 1s infinite ease-in-out;
  }
  .typing span:nth-child(2) { animation-delay: 0.12s; }
  .typing span:nth-child(3) { animation-delay: 0.24s; }
  @keyframes bounce { 0%, 60%, 100% { transform: translateY(0); opacity: 0.5; } 30% { transform: translateY(-4px); opacity: 1; } }

  .chat-input {
    border-top: 1px solid var(--bone-400);
    padding: 0.75rem 0.9rem;
    display: flex;
    gap: 0.5rem;
    align-items: flex-end;
    background: var(--surface-raised);
  }
  .chat-input textarea {
    flex: 1;
    border: 1px solid var(--bone-400);
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

  /* ── Itinerary view (locked state) ── */
  .itinerary-view {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
  }
  .itinerary-view :global(h2) {
    font-size: 1rem;
    font-weight: 800;
    letter-spacing: -0.01em;
    color: var(--text-primary);
    margin: 0;
    padding: 0.7rem 1.1rem 0.6rem;
    background: var(--sunset-50);
    border-left: 3px solid var(--sunset-800);
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
    border-bottom: 1px solid var(--bone-200);
  }
  .itinerary-view :global(li:last-child) { border-bottom: none; }
  .itinerary-view :global(strong) { font-weight: 700; color: var(--text-primary); }

  /* ── Print styles ── */
  @media print {
    .page > header,
    .chat-fab,
    .chat-backdrop,
    .chat,
    .callout,
    .danger-zone,
    .map-strip,
    .hero { display: none !important; }

    .page { background: #fff; color: #111; }
    .layout { padding: 0; }
    .content { max-width: 100%; }

    .itinerary-view :global(h2) {
      background: #f5f0e8;
      border-left-color: #92400e;
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
    .layout { padding: 1rem 0.85rem 6rem; }
    .section { padding: 1rem 1.1rem 1.2rem; }
    .chat { width: 100vw; }
    .chat-fab { bottom: 1rem; right: 1rem; padding: 0.75rem 1rem; }
  }
</style>

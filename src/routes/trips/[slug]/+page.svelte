<script>
  import { marked } from 'marked';
  import { untrack } from 'svelte';
  import { invalidateAll, goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import MiniMap from '$lib/components/MiniMap.svelte';
  import Logo from '$lib/components/Logo.svelte';
  import ActionPanel from '$lib/components/ActionPanel.svelte';
  import RetroModal from '$lib/components/RetroModal.svelte';
  import { tripColor } from '$lib/utils/colors.js';
  import { formatUsage } from '$lib/utils/format.js';
  import { swipeClose } from '$lib/actions/swipeClose.js';
  import { streamAction } from '$lib/utils/action.js';

  let { data } = $props();

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
    exploring: ['overview', 'route', 'stops', 'logistics'],
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
  let locking = $state(false);
  let completing = $state(false);
  let lockStreamingText = $state('');
  let lockStatus = $state('');

  // ── Section research (deepen-section) ──
  let srMessages  = $state([]);
  let srRunning   = $state(false);
  let srDone      = $state(false);
  let srVisible   = $state(false);
  let srAborter   = $state(null);  // AbortController, non-null while cancellable
  let srSection   = $state(null);  // which section is currently being researched

  // Refresh sections when nav causes a new load (rarely, but safe).
  $effect(() => { sections = { ...data.files }; });

  const markerColor = $derived(tripColor(trip));

  const driveLabel = $derived(
    trip?._drive_hours != null
      ? `${trip._drive_hours % 1 === 0 ? trip._drive_hours : trip._drive_hours.toFixed(1)} hr`
      : null
  );

  const canonicalSections = $derived(STAGE_SECTIONS[stage] ?? STAGE_SECTIONS.exploring);

  // Show the "Research this section →" button only when the feature is enabled,
  // the trip is not locked/completed, and the section is a researchable type.
  const RESEARCHABLE = new Set(['route', 'stops', 'logistics']);
  const canResearchSection = $derived(
    (stage === 'exploring' || (stage === 'planning' && !isLocked)) &&
    Boolean(data.features?.deepen)
  );

  function srPush(msg, done = false) {
    srMessages = [...srMessages, msg];
    if (done) { srDone = true; srRunning = false; }
  }

  function cancelSectionResearch() {
    if (srAborter) {
      srAborter.abort();
      srPush('Cancelled by user.', true);
    }
  }

  async function researchSection(section) {
    if (srRunning) return;
    srMessages  = [];
    srRunning   = true;
    srDone      = false;
    srVisible   = true;
    srSection   = section;
    srAborter   = new AbortController();
    try {
      await streamAction(
        `/api/actions/deepen-section/${encodeURIComponent(trip._slug)}/${encodeURIComponent(section)}`,
        ({ msg, done }) => {
          srPush(msg, done);
          if (done && !msg.toLowerCase().startsWith('error')) {
            // Pull the new section content into the page without a full reload.
            invalidateAll();
          }
        },
        null,
        srAborter.signal,
      );
      if (!srDone) srPush('Cancelled.', true);
    } catch (e) {
      srPush(`Error: ${e.message}`, true);
    } finally {
      srAborter  = null;
      srSection  = null;
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
  let chatOpen = $state(false);
  let chatMessages = $state([]); // [{role: 'user'|'assistant', content: '...'}]
  let chatInput = $state('');
  let chatBusy = $state(false);

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

  async function sendChat() {
    const text = chatInput.trim();
    if (!text || chatBusy) return;
    chatBusy = true;
    chatMessages = [...chatMessages, { role: 'user', content: text }];
    chatInput = '';

    try {
      const res = await fetch(
        `/api/trip/${encodeURIComponent(trip._slug)}/chat`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: chatMessages }),
        }
      );
      if (!res.ok) throw new Error(`Chat failed (${res.status})`);
      const data = await res.json();
      chatMessages = [
        ...chatMessages,
        {
          role: 'assistant',
          content: data.reply || '(no reply)',
          updated: Object.keys(data.updates || {}),
          usage: data.usage,
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
    } catch (err) {
      chatMessages = [
        ...chatMessages,
        { role: 'assistant', content: `Error: ${err.message}` },
      ];
    } finally {
      chatBusy = false;
    }
  }

  function handleChatKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendChat();
    }
  }

  // ── Lock / Unlock ──
  async function lockTrip() {
    if (!trip || locking) return;
    locking = true;
    lockStreamingText = '';
    lockStatus = 'Plotting the itinerary…';
    try {
      await streamAction(`/api/lock/${encodeURIComponent(trip._slug)}`, ({ msg, done }) => {
        if (msg.startsWith('itinerary:')) {
          lockStreamingText += msg.slice('itinerary:'.length);
        } else {
          lockStatus = msg;
        }
        if (done && !msg.toLowerCase().startsWith('error')) invalidateAll();
      });
    } catch (err) {
      console.error(err);
      alert("Couldn't lock the trip. The server log may have more detail.");
    } finally {
      locking = false;
      // Keep the streamed text visible until invalidateAll has refreshed the page;
      // the locked-state render replaces this UI naturally.
    }
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
    if (!confirm(`Mark "${label}" as completed? It'll move out of planning.`)) return;
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
    if (!confirm('Disable the share link? Anyone who already has the URL will lose access.')) return;
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

  // ── Archive ──
  async function archiveTrip() {
    if (!trip) return;
    const label = trip.title || trip._slug;
    if (!confirm(`Archive "${label}"? It'll vanish from view but stay on disk, so the seeder won't suggest it again.`)) return;
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
            <button
              class="btn btn-primary"
              onclick={lockTrip}
              disabled={locking || !data.features?.lock}
              title={data.features?.lock ? '' : 'No default model configured — edit your .env to enable this'}
            >
              {locking ? 'Plotting the itinerary…' : 'Lock trip & generate itinerary'}
            </button>
            <a class="btn btn-secondary" href={`/trips/${encodeURIComponent(trip._slug)}/brochure`} target="_blank" rel="noopener">Preview brochure</a>
            <button class="btn btn-secondary" onclick={completeTrip} disabled={completing}>
              {completing ? 'Completing…' : 'Mark as completed'}
            </button>
          </div>
          {#if locking}
            <div class="lock-stream">
              <div class="lock-status">{lockStatus}</div>
              {#if lockStreamingText}
                <pre class="lock-preview">{lockStreamingText}</pre>
              {/if}
            </div>
          {/if}
        </div>
      {:else if isPlanning && isLocked}
        <div class="callout locked-callout">
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
          {#if !hasNotes && data.features?.retro}
            <div class="callout-actions">
              <button class="btn btn-secondary" onclick={() => retroOpen = true}>
                Add retro
              </button>
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
                <button
                  class="btn btn-secondary btn-compact"
                  onclick={() => researchSection(section)}
                  disabled={srRunning}
                >
                  {srRunning && srSection === section ? 'Researching…' : 'Research this section →'}
                </button>
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

      <div class="brochure-zone">
        <div class="brochure-row">
          <a class="btn btn-secondary btn-compact" href={`/trips/${encodeURIComponent(trip._slug)}/brochure`} target="_blank" rel="noopener">View brochure</a>
          <a class="btn btn-secondary btn-compact" href={`/trips/${encodeURIComponent(trip._slug)}/brochure/prepare`}>Prepare brochure</a>
        </div>
        <span class="archive-hint">
          The Field guide reads your notes and proposes a structured set of stops, lodging, and notes for the brochure. You review and toggle, then save.
        </span>
      </div>

      <div class="danger-zone">
        <button class="btn btn-danger btn-compact" onclick={archiveTrip}>Archive trip</button>
        <span class="archive-hint">Hides it from view but keeps the file so it won't be re-suggested.</span>
      </div>
    </main>
  </div>

  {#if isPlanning && !isLocked && data.features?.chat}
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

  {#if srVisible}
    <ActionPanel
      messages={srMessages}
      running={srRunning}
      done={srDone}
      onclose={() => srVisible = false}
      oncancel={srAborter ? cancelSectionResearch : null}
    />
  {/if}

  {#if retroOpen}
    <RetroModal
      slug={trip._slug}
      assistantName={data.assistantName}
      onclose={() => retroOpen = false}
      onsaved={onRetroSaved}
    />
  {/if}

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
            {#if m.usage}
              <div class="msg-usage">{formatUsage(m.usage)}</div>
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
      <button type="submit" disabled={chatBusy || !chatInput.trim()}>Send</button>
    </form>
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
  .lock-stream {
    margin-top: 0.85rem;
    padding-top: 0.85rem;
    border-top: 1px dashed rgba(201, 182, 149, 0.6);
  }
  .lock-status {
    font-size: 0.78rem;
    color: var(--text-secondary);
    margin-bottom: 0.5rem;
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
  .msg-usage {
    margin-top: 0.35rem;
    font-size: 0.7rem;
    color: var(--text-tertiary);
    font-variant-numeric: tabular-nums;
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
  .chat-input button {
    background: var(--forest-800);
    color: var(--bone-50);
    border: none;
    padding: 0.5rem 0.95rem;
    border-radius: 4px;
    font-size: 0.82rem;
    font-weight: 700;
    font-family: var(--font-sans);
    cursor: pointer;
  }
  .chat-input button:disabled { opacity: 0.5; cursor: not-allowed; }

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

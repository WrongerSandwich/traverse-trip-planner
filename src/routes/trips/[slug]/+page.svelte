<script>
  import { marked } from 'marked';
  import { invalidateAll, goto } from '$app/navigation';
  import MiniMap from '$lib/components/MiniMap.svelte';
  import { tripColor } from '$lib/utils/colors.js';
  import { swipeClose } from '$lib/actions/swipeClose.js';

  let { data } = $props();

  const SECTION_LABELS = {
    overview: 'Overview',
    route: 'Route',
    stops: 'Stops',
    logistics: 'Logistics',
  };
  const SECTION_ORDER = ['overview', 'route', 'stops', 'logistics'];

  const trip = $derived(data.trip);
  const stage = $derived(data.stage);
  const isPlanning = $derived(stage === 'planning');

  // Local section content state, seeded from server load. Edits live here until saved.
  let sections = $state({ ...data.files });
  // Per-section UI state
  let editing = $state({});      // { route: true, ... }
  let drafts  = $state({});      // staging textareas while editing
  let saving  = $state({});

  // Refresh sections when nav causes a new load (rarely, but safe).
  $effect(() => { sections = { ...data.files }; });

  const markerColor = $derived(tripColor(trip));

  const driveLabel = $derived(
    trip?._drive_hours != null
      ? `${trip._drive_hours % 1 === 0 ? trip._drive_hours : trip._drive_hours.toFixed(1)} hr`
      : null
  );

  const availableSections = $derived(
    SECTION_ORDER.filter(s => sections[s] !== undefined)
  );

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
      alert(`Could not save: ${err.message}`);
    } finally {
      saving[section] = false;
    }
  }

  // ── AI chat ──
  let chatOpen = $state(false);
  let chatMessages = $state([]); // [{role: 'user'|'assistant', content: '...'}]
  let chatInput = $state('');
  let chatBusy = $state(false);

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

  // ── Archive ──
  async function archiveTrip() {
    if (!trip) return;
    const label = trip.title || trip._slug;
    if (!confirm(`Archive "${label}"? It will be hidden from view but the file is kept so the seeder won't suggest it again.`)) return;
    try {
      const res = await fetch(`/api/archive/${encodeURIComponent(trip._slug)}`, { method: 'POST' });
      if (!res.ok) throw new Error(`Archive failed: ${res.status}`);
      await goto('/', { invalidateAll: true });
    } catch (err) {
      console.error(err);
      alert('Could not archive — check the server log.');
    }
  }


</script>

<svelte:head>
  <title>{trip?.title || trip?._slug} — Atlas</title>
</svelte:head>

<div class="page">
  <header>
    <button class="back" onclick={() => goto('/')} aria-label="Back to all trips">← All trips</button>
    <span class="stage-pill">{stage || 'planning'}</span>
    <h1>{trip?.title || trip?._slug}</h1>
    <div class="meta">
      {#if trip?.destination}<span>{trip.destination}</span>{/if}
      {#if trip?.fly_in === 'true'}
        <span class="mode fly">✈ fly</span>
      {:else if driveLabel}
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
      {#if isPlanning}
        <div class="callout">
          <strong>Planning mode.</strong>
          Edit any section below. Use <em>Ask Claude</em> to request changes — Claude reads your current sections and writes updates back to the markdown.
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

      {#each availableSections as section}
        <section class="section">
          <header class="section-header">
            <h2>{SECTION_LABELS[section] || section}</h2>
            {#if isPlanning && !editing[section]}
              <button class="edit-btn" onclick={() => startEdit(section)}>Edit</button>
            {/if}
          </header>

          {#if editing[section]}
            <textarea
              class="editor"
              bind:value={drafts[section]}
              spellcheck="true"
              rows="14"
            ></textarea>
            <div class="editor-actions">
              <button class="save-btn" onclick={() => saveEdit(section)} disabled={saving[section]}>
                {saving[section] ? 'Saving…' : 'Save'}
              </button>
              <button class="cancel-btn" onclick={() => cancelEdit(section)} disabled={saving[section]}>
                Cancel
              </button>
            </div>
          {:else}
            <div class="prose">{@html marked.parse(sections[section] || '')}</div>
          {/if}
        </section>
      {/each}

      <div class="danger-zone">
        <button class="archive-btn" onclick={archiveTrip}>Archive trip</button>
        <span class="archive-hint">Hides it from view but keeps the file so it won't be re-suggested.</span>
      </div>
    </main>
  </div>

  {#if isPlanning}
    <button class="chat-fab" class:open={chatOpen} onclick={() => chatOpen = !chatOpen} aria-label="Ask Claude">
      {chatOpen ? '✕' : '✨ Ask Claude'}
    </button>
  {/if}

  <div class="chat-backdrop" class:open={chatOpen} onclick={() => chatOpen = false} role="presentation"></div>

  <aside class="chat" class:open={chatOpen} aria-hidden={!chatOpen}
    use:swipeClose={() => chatOpen = false}>
    <header class="chat-header">
      <span>Ask Claude about this trip</span>
      <button class="chat-close" onclick={() => chatOpen = false} aria-label="Close chat">✕</button>
    </header>

    <div class="chat-log">
      {#if chatMessages.length === 0}
        <div class="chat-empty">
          <p>Ask for changes in plain English — try things like:</p>
          <ul>
            <li>"Add a half-day in Leavenworth on the way."</li>
            <li>"Trim the route down to one direct option."</li>
            <li>"Suggest a vegetarian-friendly dinner spot in Atchison."</li>
          </ul>
          <p class="hint">Claude can edit your section files directly. Updates apply on save.</p>
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
    background: var(--bg);
    color: var(--text);
    font-family: var(--font);
    display: flex;
    flex-direction: column;
  }

  .page > header {
    background: var(--header-bg);
    color: var(--header-text);
    padding: 1.1rem 1.75rem;
    display: flex;
    align-items: center;
    gap: 0.9rem;
    flex-wrap: wrap;
  }

  .back {
    background: none;
    border: 1.5px solid oklch(36% 0.06 155);
    color: oklch(80% 0.025 155);
    padding: 0.35rem 0.75rem;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.78rem;
    font-weight: 600;
    font-family: var(--font);
    transition: background 0.12s, border-color 0.12s, color 0.12s;
  }
  .back:hover {
    background: oklch(28% 0.03 155);
    border-color: oklch(52% 0.08 155);
    color: oklch(94% 0.018 80);
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
    font-size: 1.4rem;
    font-weight: 800;
    line-height: 1;
    letter-spacing: -0.02em;
    margin: 0;
  }

  .meta {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 0.55rem;
    font-size: 0.78rem;
    color: oklch(80% 0.012 80);
  }
  .meta .mode {
    font-size: 0.62rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    padding: 0.14rem 0.45rem;
    border-radius: 2px;
  }
  .meta .mode.drive { background: oklch(93.5% 0.048 155 / 0.9); color: oklch(30% 0.12 155); }
  .meta .mode.fly   { background: oklch(93.5% 0.048 195 / 0.9); color: oklch(26% 0.12 195); }
  .meta .cost { font-weight: 700; color: oklch(94% 0.018 80); }

  .hero {
    position: relative;
    height: 280px;
    overflow: hidden;
    background: var(--border);
  }
  .hero img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .hero .vibe {
    position: absolute;
    top: 0.9rem; left: 1.2rem;
    font-size: 0.62rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--accent-bg);
    background: var(--accent);
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
    background: var(--accent-bg);
    color: var(--accent);
    border-left: 3px solid var(--accent);
    padding: 0.7rem 0.95rem;
    border-radius: 3px;
    font-size: 0.84rem;
    line-height: 1.55;
  }
  .callout.warn {
    background: oklch(94% 0.04 70);
    color: oklch(36% 0.14 55);
    border-left-color: oklch(48% 0.14 55);
  }

  .map-strip {
    height: 220px;
    border-radius: 6px;
    overflow: hidden;
    background: var(--border);
  }

  .section {
    background: var(--surface);
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
    font-size: 1.05rem;
    font-weight: 700;
    letter-spacing: -0.015em;
    color: var(--text);
    margin: 0;
  }

  .edit-btn {
    background: none;
    border: 1.5px solid var(--accent-border);
    color: var(--accent);
    padding: 0.18rem 0.55rem;
    border-radius: 3px;
    font-size: 0.72rem;
    font-weight: 600;
    font-family: var(--font);
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
  }
  .edit-btn:hover { background: var(--accent); color: oklch(97% 0.012 80); }

  .editor {
    width: 100%;
    min-height: 260px;
    font-family: 'DM Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.86rem;
    line-height: 1.6;
    color: var(--text);
    background: var(--surface-raised);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 0.7rem 0.85rem;
    resize: vertical;
  }
  .editor:focus { outline: 2px solid var(--accent-border); outline-offset: 1px; }

  .editor-actions {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.55rem;
  }
  .save-btn {
    background: var(--accent);
    color: oklch(97% 0.012 80);
    border: none;
    padding: 0.4rem 0.9rem;
    border-radius: 4px;
    font-size: 0.78rem;
    font-weight: 700;
    font-family: var(--font);
    cursor: pointer;
  }
  .save-btn:disabled { opacity: 0.55; cursor: not-allowed; }
  .cancel-btn {
    background: none;
    border: 1.5px solid var(--border);
    color: var(--text-2);
    padding: 0.4rem 0.9rem;
    border-radius: 4px;
    font-size: 0.78rem;
    font-weight: 600;
    font-family: var(--font);
    cursor: pointer;
  }
  .cancel-btn:hover:not(:disabled) { border-color: var(--accent-border); color: var(--accent); }

  .prose { font-size: 0.92rem; line-height: 1.75; color: var(--text-2); }
  .prose :global(h1), .prose :global(h2) {
    font-size: 1rem; font-weight: 700; margin: 1.4rem 0 0.5rem;
    color: var(--text); letter-spacing: -0.015em;
  }
  .prose :global(h3) { font-size: 0.92rem; font-weight: 700; margin: 1.1rem 0 0.35rem; color: var(--text); }
  .prose :global(h1:first-child),
  .prose :global(h2:first-child),
  .prose :global(h3:first-child) { margin-top: 0; }
  .prose :global(p) { margin: 0 0 0.85rem; }
  .prose :global(ul), .prose :global(ol) { margin: 0 0 0.85rem 1.3rem; }
  .prose :global(li) { margin-bottom: 0.3rem; }
  .prose :global(strong) { font-weight: 700; color: var(--text); }
  .prose :global(a) { color: var(--accent-mid); text-decoration: none; }
  .prose :global(a:hover) { text-decoration: underline; }
  .prose :global(table) { width: 100%; border-collapse: collapse; font-size: 0.86rem; margin: 0 0 1rem; }
  .prose :global(th) { text-align: left; font-weight: 700; padding: 0.4rem 0.6rem; border-bottom: 2px solid var(--border); color: var(--text); }
  .prose :global(td) { padding: 0.35rem 0.6rem; border-bottom: 1px solid var(--border-subtle); vertical-align: top; }
  .prose :global(code) { font-family: monospace; font-size: 0.82em; background: var(--accent-bg); color: var(--accent); padding: 0.1em 0.4em; border-radius: 3px; }

  /* ── Danger zone (archive) ── */
  .danger-zone {
    margin-top: 1rem;
    padding: 1.1rem 0 0;
    border-top: 1px dashed var(--border);
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.4rem;
  }
  .archive-btn {
    background: none;
    border: 1px solid var(--border);
    color: var(--text-3);
    font-family: var(--font);
    font-size: 0.74rem;
    font-weight: 600;
    padding: 0.32rem 0.7rem;
    border-radius: 3px;
    cursor: pointer;
    transition: border-color 0.12s, color 0.12s, background 0.12s;
  }
  .archive-btn:hover  { border-color: oklch(58% 0.16 25); color: oklch(48% 0.18 25); background: oklch(96% 0.025 25); }
  .archive-btn:active { transform: scale(0.97); }
  .archive-hint { font-size: 0.72rem; color: var(--text-3); line-height: 1.45; }

  /* ── AI chat ── */
  .chat-fab {
    position: fixed;
    bottom: 1.5rem;
    right: 1.5rem;
    background: var(--accent);
    color: oklch(97% 0.012 80);
    border: none;
    padding: 0.85rem 1.2rem;
    border-radius: 999px;
    font-size: 0.86rem;
    font-weight: 700;
    font-family: var(--font);
    cursor: pointer;
    box-shadow: 0 6px 18px oklch(0% 0 0 / 0.18);
    z-index: 902;
    transition: transform 0.12s, box-shadow 0.12s;
  }
  .chat-fab:hover { transform: translateY(-1px); box-shadow: 0 9px 22px oklch(0% 0 0 / 0.22); }
  .chat-fab.open { background: oklch(28% 0.13 155); }

  .chat-backdrop {
    position: fixed; inset: 0;
    background: oklch(10% 0 0 / 0.4);
    z-index: 902;
    opacity: 0; pointer-events: none;
    transition: opacity 0.25s;
  }
  .chat-backdrop.open { opacity: 1; pointer-events: auto; }

  .chat {
    position: fixed;
    top: 0; right: 0;
    width: 420px; max-width: 100vw; height: 100vh;
    background: var(--surface);
    box-shadow: -10px 0 30px oklch(0% 0 0 / 0.15);
    z-index: 903;
    display: flex;
    flex-direction: column;
    transform: translateX(100%);
    transition: transform 0.28s cubic-bezier(0.22, 1, 0.36, 1);
  }
  .chat.open { transform: translateX(0); }

  .chat-header {
    background: var(--header-bg);
    color: var(--header-text);
    padding: 0.85rem 1.1rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 0.85rem;
    font-weight: 700;
  }
  .chat-close {
    background: none; border: none; color: oklch(70% 0.02 155);
    cursor: pointer; font-size: 1rem; line-height: 1;
    padding: 0.2rem 0.35rem; border-radius: 3px;
  }
  .chat-close:hover { color: var(--header-text); background: oklch(100% 0 0 / 0.08); }

  .chat-log {
    flex: 1;
    overflow-y: auto;
    padding: 1rem 1.1rem;
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
  }

  .chat-empty {
    color: var(--text-2);
    font-size: 0.86rem;
    line-height: 1.6;
  }
  .chat-empty ul { margin: 0.5rem 0 0.6rem 1.2rem; }
  .chat-empty li { margin-bottom: 0.25rem; }
  .chat-empty .hint { color: var(--text-3); font-size: 0.78rem; }

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
    background: var(--accent);
    color: oklch(97% 0.012 80);
    border-bottom-right-radius: 2px;
  }
  .msg.assistant {
    align-self: flex-start;
    background: var(--accent-bg);
    color: var(--text);
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
    background: var(--text-3);
    border-radius: 50%;
    animation: bounce 1s infinite ease-in-out;
  }
  .typing span:nth-child(2) { animation-delay: 0.12s; }
  .typing span:nth-child(3) { animation-delay: 0.24s; }
  @keyframes bounce { 0%, 60%, 100% { transform: translateY(0); opacity: 0.5; } 30% { transform: translateY(-4px); opacity: 1; } }

  .chat-input {
    border-top: 1px solid var(--border);
    padding: 0.75rem 0.9rem;
    display: flex;
    gap: 0.5rem;
    align-items: flex-end;
    background: var(--surface);
  }
  .chat-input textarea {
    flex: 1;
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 0.5rem 0.65rem;
    font-family: var(--font);
    font-size: 0.86rem;
    line-height: 1.45;
    color: var(--text);
    background: var(--surface-raised);
    resize: none;
  }
  .chat-input textarea:focus { outline: 2px solid var(--accent-border); outline-offset: 1px; }
  .chat-input button {
    background: var(--accent);
    color: oklch(97% 0.012 80);
    border: none;
    padding: 0.5rem 0.95rem;
    border-radius: 4px;
    font-size: 0.82rem;
    font-weight: 700;
    font-family: var(--font);
    cursor: pointer;
  }
  .chat-input button:disabled { opacity: 0.5; cursor: not-allowed; }

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

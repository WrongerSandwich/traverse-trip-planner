<script>
  // Stop candidate card. Category-tinted leading edge, an icon glyph per
  // category, a single-line description (the previous `.why` paragraph is
  // folded into hover/focus reveal), a distance chip, drag handle, and a
  // hover-revealed Hide button. The visible form is intentionally
  // distinct from LodgingCard — the brief calls for "stop cards look
  // like a place to do; lodging cards look like a place to sleep."

  import { mapsHref, telHref, websiteHref, hostLabel } from '$lib/utils/links.js';

  let {
    stop,
    promoted = false,
    distance = null,
    hovered = false,
    readonly = false,
    working = false,
    showDragHandle = true,
    // `compact` is the "in a day card" rendering — drops the description
    // line and tightens padding. The Promote/Un-promote action button and
    // the source-url link are also suppressed because the parent (a
    // PlanSection day card) owns its own affordance set; we keep the
    // drag handle and the hover-revealed Hide button since they map to
    // the in-day gestures (reorder + remove-from-day).
    compact = false,
    onHover = () => {},
    onClick = () => {},
    onPromote = () => {},
    onUnpromote = () => {},
    onHide = () => {},
    onToggleTodo = () => {},
    ondragstart = () => {},
    ondragend = () => {},
  } = $props();

  // Each category gets a glyph from a small icon vocabulary. Single
  // characters keep the surface area minimal; semantic value is carried
  // by the category color, not the glyph.
  const CATEGORY_GLYPH = {
    historic:      '◉',
    cultural:      '◐',
    food:          '◊',
    entertainment: '✺',
    outdoors:      '▲',
    view:          '◇',
    quirky:        '✦',
    shopping:      '○',
    misc:          '·',
  };

  const glyph = $derived(CATEGORY_GLYPH[stop.category] ?? CATEGORY_GLYPH.misc);

  const hasMeta = $derived(!!(stop.address || stop.hours || stop.website || stop.phone));
  const mapsUrl = $derived(mapsHref(stop.address));
  const telUrl = $derived(telHref(stop.phone));
  const webUrl = $derived(websiteHref(stop.website));
  const webLabel = $derived(stop.website ? hostLabel(stop.website) : '');

  // The visible text below the title. Fold `why_recommended` into the
  // description if both exist and the description is short — keeps the
  // card to one paragraph at rest. If both are long, the full `why` is
  // surfaced on the title attr / hover state.
  const summary = $derived.by(() => {
    const desc = (stop.description || '').trim();
    const why = (stop.why_recommended || '').trim();
    if (!desc) return why;
    if (!why) return desc;
    if (desc.length + why.length < 140) return `${desc} ${why}`;
    return desc;
  });

  // Compact (in-day) details drawer — on a Plan day card a stop shows only
  // its identity at rest (badge + name + distance + a one-line address) and
  // tucks hours, contact links, tips, and to-dos behind a single <details>
  // drawer, so the day stays scannable instead of expanding every stop to
  // full height. Mirrors TodayStopCard's collapse vocabulary; the difference
  // is the Plan drawer also holds logistics (the Today view shows those in
  // its body, where they're actionable). Only used in compact mode.
  const hasContactDetail = $derived(!!(stop.hours || webUrl || telUrl));
  const hasTips = $derived(!!(stop.tips?.length));
  const hasTodos = $derived(!!(stop.todos?.length));
  const hasPrep = $derived(hasTips || hasTodos);
  const hasDrawer = $derived(hasContactDetail || hasPrep);
  const drawerLabel = $derived.by(() => {
    const segs = [];
    // Lead with the actionable hook — outstanding to-dos are the real reason
    // to open a stop while planning, not a count of how many metadata fields
    // exist. Hours/contact trail as the reference tail.
    if (hasTodos) {
      const left = stop.todos.filter((t) => !t.done).length;
      const n = stop.todos.length;
      segs.push(left > 0 ? `${left} to-do${left === 1 ? '' : 's'} left` : `${n} to-do${n === 1 ? '' : 's'}`);
    }
    if (hasTips) { const n = stop.tips.length; segs.push(`${n} tip${n === 1 ? '' : 's'}`); }
    if (hasContactDetail) segs.push('hours & contact');
    return segs.join(' · ');
  });

  function handleDragStart(e) {
    if (!e.dataTransfer) return;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', stop.id);
    e.dataTransfer.setData('application/x-traverse-candidate', JSON.stringify({ id: stop.id, type: 'stop' }));
    ondragstart(stop.id);
  }
</script>

<article
  class="stop-card"
  class:promoted
  class:hovered
  class:compact
  data-category={stop.category}
  draggable={showDragHandle && !readonly && !working ? 'true' : 'false'}
  onmouseenter={() => onHover(stop.id)}
  onmouseleave={() => onHover(null)}
  onfocusin={() => onHover(stop.id)}
  onfocusout={() => onHover(null)}
  ondragstart={handleDragStart}
  {ondragend}
  aria-label="Candidate stop: {stop.name}"
>
  <div class="head">
    <span class="cat-badge" aria-hidden="true" title={stop.category}>{glyph}</span>
    <h4 class="name">{stop.name}</h4>
    {#if distance != null && !compact}
      <span class="distance" title="Distance from destination">{distance} mi</span>
    {/if}
    {#if promoted && !compact}
      <span class="in-plan-mark" title="In your plan" aria-label="In plan">●</span>
    {/if}
  </div>

  {#if summary && !compact}
    <p class="summary">{summary}</p>
  {/if}

  {#if hasMeta && !compact}
    <div class="meta-row" aria-label="Stop details">
      {#if stop.address}
        {#if mapsUrl}
          <a class="meta-chip meta-chip--addr" href={mapsUrl} target="_blank" rel="noopener" aria-label="Open in maps: {stop.address}" onclick={(e) => e.stopPropagation()}>
            <span class="meta-icon" aria-hidden="true">📍</span><span class="meta-chip-text">{stop.address}</span>
          </a>
        {:else}
          <span class="meta-chip meta-chip--addr"><span class="meta-icon" aria-hidden="true">📍</span><span class="meta-chip-text">{stop.address}</span></span>
        {/if}
      {/if}
      {#if stop.hours}
        <span class="meta-chip meta-chip--hours" title={stop.hours}>
          <span class="meta-icon" aria-hidden="true">⏰</span><span class="meta-chip-text">{stop.hours}</span>
        </span>
      {/if}
      {#if webUrl}
        <a class="meta-chip meta-chip--web" href={webUrl} target="_blank" rel="noopener" aria-label="Website: {webLabel}" onclick={(e) => e.stopPropagation()}>
          <span class="meta-icon" aria-hidden="true">🌐</span><span class="meta-chip-text">{webLabel}</span>
        </a>
      {/if}
      {#if telUrl}
        <a class="meta-chip meta-chip--phone" href={telUrl} aria-label="Call {stop.phone}" onclick={(e) => e.stopPropagation()}>
          <span class="meta-icon" aria-hidden="true">☎</span><span class="meta-chip-text">{stop.phone}</span>
        </a>
      {/if}
    </div>
  {/if}

  {#if compact && (stop.address || distance != null)}
    <div class="compact-addr">
      {#if stop.address}
        {#if mapsUrl}
          <a class="meta-link meta-link--primary addr-link" href={mapsUrl} target="_blank" rel="noopener" aria-label="Open in maps: {stop.address}" onclick={(e) => e.stopPropagation()}>
            <svg class="addr-pin" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-6-5.3-6-10a6 6 0 0 1 12 0c0 4.7-6 10-6 10z" /><circle cx="12" cy="11" r="2" /></svg><span class="addr-text">{stop.address}</span>
          </a>
        {:else}
          <span class="addr-link"><svg class="addr-pin" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-6-5.3-6-10a6 6 0 0 1 12 0c0 4.7-6 10-6 10z" /><circle cx="12" cy="11" r="2" /></svg><span class="addr-text">{stop.address}</span></span>
        {/if}
      {/if}
      {#if distance != null}
        <span class="distance compact-distance" title="Distance from destination">{distance} mi</span>
      {/if}
    </div>
  {/if}

  {#if compact && hasDrawer}
    <details class="prep disclosure">
      <summary class="disclosure-summary">
        <span class="disclosure-chev" aria-hidden="true">›</span>
        {drawerLabel}
      </summary>
      <div class="prep-content">
        {#if hasContactDetail}
          <div class="drawer-contact" aria-label="Hours and contact">
            {#if stop.hours}<div class="meta-line meta-line--hours">{stop.hours}</div>{/if}
            {#if webUrl || telUrl}
              <div class="meta-line meta-line--contact">
                {#if webUrl}<a class="meta-link" href={webUrl} target="_blank" rel="noopener" onclick={(e) => e.stopPropagation()}>{webLabel} ↗</a>{/if}
                {#if telUrl}<a class="meta-link" href={telUrl} onclick={(e) => e.stopPropagation()}>{stop.phone} ↗</a>{/if}
              </div>
            {/if}
          </div>
        {/if}
        {#if hasTips}
          <ul class="tips">
            {#each stop.tips as tip}
              <li>{tip}</li>
            {/each}
          </ul>
        {/if}
        {#if hasTodos}
          <ul class="todos">
            {#each stop.todos as todo (todo.id)}
              <li>
                <label
                  role="presentation"
                  onclick={(e) => e.stopPropagation()}
                >
                  <input
                    type="checkbox"
                    checked={todo.done}
                    disabled={readonly || working}
                    onchange={(e) => onToggleTodo(todo.id, e.currentTarget.checked)}
                  />
                  <span class:done={todo.done}>{todo.text}</span>
                </label>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </details>
  {/if}

  <footer>
    {#if showDragHandle && !readonly}
      <span class="drag-handle" aria-hidden="true" title={compact ? 'Drag to reorder within this day' : 'Drag onto a day card to promote'}>
        <span class="drag-dots">⋮⋮</span>
        <span class="drag-label">drag</span>
      </span>
    {/if}
    {#if !compact}
      {#if promoted}
        <button
          type="button"
          class="action"
          onclick={(e) => { e.stopPropagation(); onUnpromote(); }}
          disabled={readonly || working}
        >Un-promote</button>
      {:else}
        <button
          type="button"
          class="action action--primary"
          onclick={(e) => { e.stopPropagation(); onPromote(); }}
          disabled={readonly || working}
        >Promote to day…</button>
      {/if}
      {#if stop.source_url}
        <a class="link" href={stop.source_url} target="_blank" rel="noreferrer noopener" onclick={(e) => e.stopPropagation()}>Source ↗</a>
      {/if}
    {/if}
    {#if !readonly && !compact}
      <button
        type="button"
        class="hide"
        onclick={(e) => { e.stopPropagation(); onHide(); }}
        title="Hide this candidate"
        aria-label="Hide {stop.name}"
        disabled={working}
      >×</button>
    {/if}
  </footer>
</article>

<style>
  /* Card chassis — category color lives on the .cat-badge (filled circular
     glyph chip) and the action-button hover; the card chrome stays neutral
     so the row reads as a list of distinct items, not a stripe rhythm. The
     previous .leading-edge bar was structurally a side-stripe and tripped
     the impeccable absolute ban — replaced with the badge approach. */
  .stop-card {
    position: relative;
    display: grid;
    grid-template-columns: 1fr;
    gap: 0.35rem;
    padding: 0.6rem 0.85rem 0.55rem 0.85rem;
    background: var(--surface-raised);
    border: 1px solid var(--border-subtle);
    border-radius: 5px;
    font-family: var(--font-sans);
    cursor: pointer;
    transition: background-color 0.12s ease, border-color 0.12s ease, transform 0.15s ease;
    outline: none;
  }
  .stop-card[data-category="historic"]      { --c: var(--cat-historic);      --c-tint: var(--cat-historic-tint);      --c-on: var(--cat-historic-on); }
  .stop-card[data-category="cultural"]      { --c: var(--cat-cultural);      --c-tint: var(--cat-cultural-tint);      --c-on: var(--cat-cultural-on); }
  .stop-card[data-category="food"]          { --c: var(--cat-food);          --c-tint: var(--cat-food-tint);          --c-on: var(--cat-food-on); }
  .stop-card[data-category="entertainment"] { --c: var(--cat-entertainment); --c-tint: var(--cat-entertainment-tint); --c-on: var(--cat-entertainment-on); }
  .stop-card[data-category="outdoors"]      { --c: var(--cat-outdoors);      --c-tint: var(--cat-outdoors-tint);      --c-on: var(--cat-outdoors-on); }
  .stop-card[data-category="view"]          { --c: var(--cat-view);          --c-tint: var(--cat-view-tint);          --c-on: var(--cat-view-on); }
  .stop-card[data-category="quirky"]        { --c: var(--cat-quirky);        --c-tint: var(--cat-quirky-tint);        --c-on: var(--cat-quirky-on); }
  .stop-card[data-category="shopping"]      { --c: var(--cat-shopping);      --c-tint: var(--cat-shopping-tint);      --c-on: var(--cat-shopping-on); }
  .stop-card[data-category="misc"]          { --c: var(--cat-misc);          --c-tint: var(--cat-misc-tint);          --c-on: var(--cat-misc-on); }

  .stop-card:hover,
  .stop-card:focus-visible {
    border-color: var(--c, var(--border-default));
  }
  .stop-card:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }
  .stop-card.hovered {
    background: color-mix(in oklab, var(--c, var(--accent)) 4%, var(--surface-raised));
  }
  .stop-card.promoted {
    background: color-mix(in oklab, var(--accent) 4%, var(--surface-raised));
    border-color: color-mix(in oklab, var(--accent) 40%, var(--border-default));
  }
  .stop-card[draggable="true"]:active {
    cursor: grabbing;
  }

  /* Compact mode — the "I'm inside a day card" rendering used by
     PlanSection. Drops the description paragraph, tightens padding,
     and collapses to a single-row layout: badge + name + distance +
     drag-handle + hide × all in one line. Borders go subtler so the
     parent day-card chrome carries the visual weight. */
  .stop-card.compact {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    padding: 4px 8px;
    gap: 0.5rem;
    border-color: transparent;
    border-radius: 4px;
    background: transparent;
  }
  /* Hover stays a quiet background wash only — no border, so a compact
     stop never re-asserts a card-in-a-card outline inside the day card.
     Keyboard focus still gets the shared focus-ring outline above. */
  .stop-card.compact:hover,
  .stop-card.compact:focus-visible {
    background: var(--surface-page);
  }
  .stop-card.compact .head {
    flex: 1 1 auto;
    min-width: 0;
    flex-wrap: nowrap;
    align-items: center;
    gap: 0.5rem;
  }
  .stop-card.compact .cat-badge {
    width: 18px;
    height: 18px;
    font-size: 0.7rem;
  }
  .stop-card.compact .name {
    font-size: 0.92rem;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .stop-card.compact .distance {
    font-size: 0.66rem;
    padding: 0.08rem 0.32rem;
  }
  .stop-card.compact footer {
    flex-shrink: 0;
    gap: 0.25rem;
    margin-top: 0;
  }
  .stop-card.compact .drag-handle {
    padding: 2px 5px;
    font-size: 9.5px;
    /* Within-day reorder is a new gesture; keep the "drag" label so the
       affordance is discoverable from inside a day card, not just from
       the candidate-side rows the user already learned the gesture on. */
  }
  .stop-card.compact .drag-dots {
    font-size: 0.75rem;
  }
  /* Rest-state address — the single always-visible meta line on a compact
     stop, clamped to one line. Indented under the name (past the badge) so
     it reads as belonging to the stop above it. Everything else (hours,
     links, prep) lives in the drawer. */
  .stop-card.compact .compact-addr {
    flex-basis: 100%;
    min-width: 0;
    margin-top: 0.1rem;
    padding-left: calc(18px + 0.5rem);
    font-size: 0.8rem;
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .compact-addr .addr-link {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    min-width: 0;
    flex: 0 1 auto;
  }
  .compact-addr .compact-distance {
    flex-shrink: 0;
    margin-left: auto;
  }
  .compact-addr .addr-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .compact-addr .addr-pin {
    flex-shrink: 0;
    color: var(--text-tertiary);
  }

  .head {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    flex-wrap: wrap;
  }
  /* Category badge — filled circular chip in the category tint with the
     glyph in the on-color. Replaces the leading-edge bar; carries the
     category signal as a deliberate object rather than a side-stripe
     accent. Sits where the glyph used to live so the row visual mass
     and the name baseline are preserved. */
  .cat-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: var(--c-tint, var(--surface-sunken));
    color: var(--c-on, var(--text-tertiary));
    font-size: 0.78rem;
    line-height: 1;
    flex-shrink: 0;
    /* The category-color saturated stop reads as a thin ring around the
       tint fill — quiet but legible signal that this is the same family
       as the matching pin on the map. */
    box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--c, var(--border-default)) 35%, transparent);
  }
  .name {
    margin: 0;
    flex: 1;
    min-width: 0;
    font-family: var(--font-sans);
    font-size: 0.96rem;
    font-weight: 500;
    color: var(--text-primary);
    line-height: 1.25;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .distance {
    font-size: 0.7rem;
    font-weight: 600;
    letter-spacing: 0.02em;
    color: var(--c-on, var(--text-tertiary));
    background: var(--c-tint, var(--surface-sunken));
    padding: 0.12rem 0.4rem;
    border-radius: 999px;
    flex-shrink: 0;
  }
  .in-plan-mark {
    color: var(--accent);
    font-size: 0.7rem;
    line-height: 1;
    flex-shrink: 0;
  }

  .summary {
    margin: 0;
    font-size: 0.84rem;
    line-height: 1.45;
    color: var(--text-secondary);
    /* Multi-line clamp at 2 — long descriptions never expand the card
       beyond a tight resting height. */
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

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
  .meta-chip-text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Hours + contact, shown inside the compact drawer (and on the
     non-compact candidate card via the same line classes). */
  .drawer-contact {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    font-size: 0.82rem;
    line-height: 1.4;
  }
  .meta-line { color: var(--text-secondary); }
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
  @media (pointer: coarse) {
    .meta-link { min-height: var(--tap-min); display: inline-flex; align-items: center; padding: 0.2rem 0; }
  }

  footer {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex-wrap: wrap;
    margin-top: 0.1rem;
  }
  /* Drag handle is a labeled affordance ("⋮⋮ drag"), not a glyph-only chip,
     so users discover the gesture without a tooltip. Hidden entirely on
     coarse pointers since HTML5 DnD doesn't fire on touch — surfacing a
     non-functional affordance is worse than hiding it (the click-flow
     "Promote to day…" remains primary on phone). */
  .drag-handle {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    color: var(--text-tertiary);
    font-family: var(--font-sans);
    font-size: 10.5px;
    font-weight: 500;
    letter-spacing: 0.04em;
    text-transform: lowercase;
    line-height: 1;
    cursor: grab;
    padding: 3px 7px;
    border-radius: 4px;
    user-select: none;
    transition: background-color 0.12s, color 0.12s;
  }
  .drag-handle:hover { background: var(--surface-sunken); color: var(--text-secondary); }
  .drag-handle:active { cursor: grabbing; }
  .drag-dots {
    font-size: 0.85rem;
    line-height: 1;
    letter-spacing: -2px;
  }
  .drag-label {
    line-height: 1;
  }
  @media (pointer: coarse) {
    .drag-handle { display: none; }
    /* In compact mode the footer's only content is the drag-handle (hidden
       on touch) — the remove × now lives in the head. Drop the empty footer
       so it can't add a phantom gap below the drawer. */
    .stop-card.compact footer { display: none; }
  }

  /* Action buttons — compact density variant matching the .btn-inline
     vocabulary the rest of the planning page uses. */
  .action {
    background: transparent;
    border: 0.5px solid var(--border-default);
    padding: 3px 9px;
    border-radius: 4px;
    color: var(--text-secondary);
    cursor: pointer;
    font-family: var(--font-sans);
    font-size: 11.5px;
    font-weight: 500;
    line-height: 1;
    transition: background-color 0.12s, color 0.12s, border-color 0.12s;
  }
  .action:hover:not(:disabled) {
    background: var(--surface-raised);
    color: var(--text-primary);
    border-color: var(--c, var(--border-strong));
  }
  .action--primary {
    color: var(--c-on, var(--text-secondary));
    background: var(--c-tint, transparent);
    border-color: transparent;
  }
  .action--primary:hover:not(:disabled) {
    background: color-mix(in oklab, var(--c, var(--accent)) 18%, var(--surface-raised));
    border-color: var(--c, var(--border-strong));
    color: var(--c-on, var(--text-primary));
  }
  .action:disabled { opacity: 0.5; cursor: not-allowed; }

  .link {
    margin-left: auto;
    font-size: 0.72rem;
    color: var(--text-tertiary);
    text-decoration: none;
    border-bottom: 1px dotted color-mix(in oklab, var(--text-tertiary) 50%, transparent);
    padding-bottom: 1px;
    transition: color 0.12s;
  }
  .link:hover { color: var(--accent-text); border-bottom-color: var(--accent-text); }

  /* Hide button reveals on card hover / focus — keeps resting state calm,
     surfaces the whittle gesture when the user is engaged with this row. */
  .hide {
    background: transparent;
    border: none;
    color: var(--text-tertiary);
    font-size: 1.05rem;
    line-height: 1;
    padding: 0 0.25rem;
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.12s, color 0.12s;
    flex-shrink: 0;
  }
  .stop-card:hover .hide,
  .stop-card:focus-within .hide {
    opacity: 1;
  }
  .hide:hover:not(:disabled) { color: var(--state-danger); }
  .hide:disabled { opacity: 0.3; cursor: not-allowed; }
  /* Touch — coarse pointers have no :hover, so the hover-reveal hide
     button was effectively invisible. Force it visible and give it
     real tap area. Same for the primary action button (Promote/Un-
     promote), which sits at 20px tall in its compact desktop form. */
  @media (pointer: coarse) {
    .hide {
      opacity: 1;
      min-width: var(--tap-min);
      min-height: var(--tap-min);
      padding: 0 0.5rem;
    }
    .action {
      min-height: var(--tap-min);
      padding: 0.6rem 0.85rem;
      font-size: 13px;
    }
    .link {
      min-height: var(--tap-min);
      display: inline-flex;
      align-items: center;
    }
    /* Bound a pathological drawer (long hours + many tips/to-dos) so one
       open stop can't fully swallow the phone screen. Generous cap, so
       typical drawers are untouched; contained scroll so it doesn't
       chain to the page. */
    .stop-card.compact .prep-content {
      max-height: 60vh;
      overflow-y: auto;
      overscroll-behavior: contain;
    }
    /* To-do rows are real tap targets on a phone: full-height label,
       larger box, and a little breathing room so adjacent items aren't
       mis-tapped. */
    .prep ul.todos {
      display: flex;
      flex-direction: column;
      gap: 0.15rem;
    }
    .prep ul.todos li label {
      min-height: var(--tap-min);
      align-items: center;
      gap: 0.6rem;
    }
    .prep ul.todos li input[type="checkbox"] {
      width: 20px;
      height: 20px;
      flex-shrink: 0;
    }
  }

  .stop-card.compact .prep {
    flex-basis: 100%;
    margin-top: 0.4rem;
  }
  /* Flex lives on an inner wrapper, NOT the <details> itself — overriding
     `display` on <details> can defeat the native collapse in some engines
     (notably WebKit/iOS, the primary phone target). The <details> stays a
     default block element so its closed content is reliably hidden. */
  .stop-card.compact .prep-content {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .prep ul {
    margin: 0;
    padding-left: 1.1rem;
    list-style: disc;
    font-size: 0.8rem;
    color: var(--text-tertiary);
  }
  .prep ul.todos {
    list-style: none;
    padding-left: 0;
  }
  .prep ul.todos li label {
    display: flex;
    align-items: flex-start;
    gap: 0.4rem;
    cursor: pointer;
  }
  .prep ul.todos span.done {
    text-decoration: line-through;
    opacity: 0.6;
  }

  /* Details drawer — collapses hours/contact + tips + to-dos behind a
     summary row so a Plan day card stays scannable. Mirrors TodayStopCard's
     .disclosure (chevron, tap-floor summary) for cross-surface consistency.
     No top rule: the only thing above it at rest is the one-line address,
     and the inter-stop divider already carries structural separation. */
  .stop-card.compact .prep.disclosure {
    padding-top: 0.1rem;
  }
  /* Summary label uses --text-secondary for guaranteed AA contrast on the
     raised surface (the raw category color --c is too light on some tints,
     e.g. view/quirky). The category accent lives on the chevron instead,
     so the cross-reference to the badge/pin survives without risking
     legibility. */
  .disclosure-summary {
    list-style: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 0.4rem;
    min-height: var(--tap-min);
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--text-secondary);
    user-select: none;
  }
  .disclosure-summary::-webkit-details-marker { display: none; }
  .disclosure-chev {
    font-size: 0.8rem;
    line-height: 1;
    color: var(--c, var(--accent-text));
    transition: transform 0.15s ease;
  }
  .prep.disclosure[open] .disclosure-chev {
    transform: rotate(90deg);
  }
  @media (prefers-reduced-motion: reduce) {
    .disclosure-chev { transition: none; }
  }
</style>

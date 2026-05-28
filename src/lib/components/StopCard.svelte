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
    {#if distance != null}
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
            <span class="meta-icon" aria-hidden="true">📍</span>{stop.address}
          </a>
        {:else}
          <span class="meta-chip meta-chip--addr"><span class="meta-icon" aria-hidden="true">📍</span>{stop.address}</span>
        {/if}
      {/if}
      {#if stop.hours}
        <span class="meta-chip meta-chip--hours" title={stop.hours}>
          <span class="meta-icon" aria-hidden="true">⏰</span>{stop.hours}
        </span>
      {/if}
      {#if webUrl}
        <a class="meta-chip meta-chip--web" href={webUrl} target="_blank" rel="noopener" aria-label="Website: {webLabel}" onclick={(e) => e.stopPropagation()}>
          <span class="meta-icon" aria-hidden="true">🌐</span>{webLabel}
        </a>
      {/if}
      {#if telUrl}
        <a class="meta-chip meta-chip--phone" href={telUrl} aria-label="Call {stop.phone}" onclick={(e) => e.stopPropagation()}>
          <span class="meta-icon" aria-hidden="true">☎</span>{stop.phone}
        </a>
      {/if}
    </div>
  {/if}

  {#if hasMeta && compact}
    <div class="meta-stack" aria-label="Stop details">
      {#if stop.address}
        <div class="meta-line meta-line--addr">
          {#if mapsUrl}
            <a class="meta-link meta-link--primary" href={mapsUrl} target="_blank" rel="noopener" onclick={(e) => e.stopPropagation()}>
              {stop.address} <span class="meta-cta">→ Maps</span>
            </a>
          {:else}
            <span>{stop.address}</span>
          {/if}
        </div>
      {/if}
      {#if stop.hours}<div class="meta-line meta-line--hours">{stop.hours}</div>{/if}
      {#if webUrl || telUrl}
        <div class="meta-line meta-line--contact">
          {#if webUrl}<a class="meta-link" href={webUrl} target="_blank" rel="noopener" onclick={(e) => e.stopPropagation()}>{webLabel} ↗</a>{/if}
          {#if telUrl}<a class="meta-link" href={telUrl} onclick={(e) => e.stopPropagation()}>{stop.phone} ↗</a>{/if}
        </div>
      {/if}
    </div>
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
    {#if !readonly}
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
  .stop-card.compact:hover,
  .stop-card.compact:focus-visible {
    background: var(--surface-page);
    border-color: var(--border-subtle);
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
  .stop-card.compact .meta-stack {
    flex-basis: 100%;
    padding-left: calc(18px + 0.5rem); /* indent under the badge */
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
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
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

  /* Compact mode (inside Plan day cards) — vertical stack, larger touch
     targets, address gets primary visual weight. */
  .meta-stack {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    margin-top: 0.25rem;
    font-size: 0.82rem;
    line-height: 1.4;
    width: 100%;
  }
  .meta-line { color: var(--text-secondary); }
  .meta-line--addr { font-weight: 500; }
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
  .meta-cta {
    color: var(--accent-text);
    margin-left: 0.25rem;
  }
  @media (pointer: coarse) {
    .meta-line--addr a { min-height: var(--tap-min); display: inline-flex; align-items: center; }
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
  }
</style>

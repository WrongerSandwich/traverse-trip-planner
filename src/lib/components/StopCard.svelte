<script>
  // Stop candidate card. Category-tinted leading edge, an icon glyph per
  // category, a single-line description (the previous `.why` paragraph is
  // folded into hover/focus reveal), a distance chip, drag handle, and a
  // hover-revealed Hide button. The visible form is intentionally
  // distinct from LodgingCard — the brief calls for "stop cards look
  // like a place to do; lodging cards look like a place to sleep."

  let {
    stop,
    promoted = false,
    distance = null,
    hovered = false,
    readonly = false,
    working = false,
    showDragHandle = true,
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
  <span class="leading-edge" aria-hidden="true"></span>

  <div class="head">
    <span class="glyph" aria-hidden="true">{glyph}</span>
    <h4 class="name">{stop.name}</h4>
    {#if distance != null}
      <span class="distance" title="Distance from destination">{distance} mi</span>
    {/if}
    {#if promoted}
      <span class="in-plan-mark" title="In your plan" aria-label="In plan">●</span>
    {/if}
  </div>

  {#if summary}
    <p class="summary">{summary}</p>
  {/if}

  <footer>
    {#if showDragHandle && !readonly}
      <span class="drag-handle" aria-hidden="true" title="Drag onto a day card to promote">⋮⋮</span>
    {/if}
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
  /* Card chassis — category color drives the leading-edge stripe and the
     glyph; the body stays on the page surface so the category color is
     an accent, not a full wash. */
  .stop-card {
    position: relative;
    display: grid;
    grid-template-columns: 1fr;
    gap: 0.35rem;
    padding: 0.65rem 0.85rem 0.55rem 1.05rem;
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

  /* Category color stripe on the leading edge — replaces the impeccable-
     banned side-stripe border with a deliberate full bar that reads as
     an intentional badge, not a decorative accent. 4px wide on the
     inside-left of the card. */
  .leading-edge {
    position: absolute;
    top: 0.45rem;
    bottom: 0.45rem;
    left: 0.3rem;
    width: 3px;
    border-radius: 2px;
    background: var(--c, var(--border-default));
    opacity: 0.85;
  }

  .head {
    display: flex;
    align-items: baseline;
    gap: 0.45rem;
    flex-wrap: wrap;
  }
  .glyph {
    color: var(--c, var(--text-tertiary));
    font-size: 0.95rem;
    line-height: 1;
    flex-shrink: 0;
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

  footer {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex-wrap: wrap;
    margin-top: 0.1rem;
  }
  .drag-handle {
    color: var(--text-tertiary);
    font-size: 0.85rem;
    line-height: 1;
    letter-spacing: -2px;
    cursor: grab;
    padding: 0 0.15rem;
    user-select: none;
  }
  .drag-handle:active { cursor: grabbing; }

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
  /* Touch — keep the hide affordance visible at all times on coarse pointers. */
  @media (pointer: coarse) {
    .hide { opacity: 0.65; }
  }
</style>

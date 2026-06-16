<script>
  // Stop candidate card. Category badge glyph, name + distance, then the
  // two decision-driving lines at rest: the full `description` (what it is)
  // and the `why_recommended` rationale (why it fits this traveler). The
  // website sits at rest; address/hours/phone tuck behind a `Details`
  // disclosure. A drag handle and hover-revealed Hide button round it out.
  // The visible form is intentionally distinct from LodgingCard — the brief
  // calls for "stop cards look like a place to do; lodging cards look like a
  // place to sleep." (Note: the `compact` mode below — used in Plan day
  // cards — renders a tighter single-row variant with its own drawer.)

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
    // `inRail` is the "rendered inside a Plan day's itinerary spine" mode:
    // PlanSection draws a numbered, category-colored marker in its own left
    // rail, so this card suppresses its in-card category badge (one marker
    // per stop, not two) and drops the address line's badge indent. Only the
    // Plan day rows pass it; CandidatesSection never does, so it's untouched.
    inRail = false,
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

  const mapsUrl = $derived(mapsHref(stop.address));
  const telUrl = $derived(telHref(stop.phone));
  const webUrl = $derived(websiteHref(stop.website));
  const webLabel = $derived(stop.website ? hostLabel(stop.website) : '');

  // description and why_recommended are two distinct human-facing fields,
  // rendered as separate lines at rest and never folded: description = what
  // the place is (factual); why_recommended = why it fits this traveler
  // (personalized to home.md + the trip vibe). The old fold heuristic dropped
  // `why` whenever the two together ran long — i.e. on exactly the
  // substantive cards — so the best decision signal was silently lost.
  const description = $derived((stop.description || '').trim());
  const why = $derived((stop.why_recommended || '').trim());

  // Non-compact "Details" disclosure holds address/hours/phone — the fields
  // that only matter once a stop is selected. The primary link lives at rest
  // (see below), so it's excluded here.
  const hasCandidateDrawer = $derived(!!(stop.address || stop.hours || telUrl));

  // Single primary link shown at rest: prefer the official `website`, fall
  // back to `source_url` when there's no website. We never show both — when
  // both exist they're almost always the same place (and when they differ,
  // the website is the more useful link), so the old separate "Source ↗"
  // footer link was redundant clutter. This collapses to one link, deduped.
  const sourceUrl = $derived(websiteHref(stop.source_url));
  const primaryUrl = $derived(webUrl || sourceUrl);
  const primaryLabel = $derived(webUrl ? webLabel : (sourceUrl ? hostLabel(stop.source_url) : ''));

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
  class:in-rail={inRail}
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
    {#if !inRail}
      <span class="cat-badge" aria-hidden="true" title={stop.category}>{glyph}</span>
    {/if}
    <h3 class="name">{stop.name}</h3>
    {#if distance != null && !compact}
      <span class="distance" title="Distance from destination">{distance} mi</span>
    {/if}
    {#if promoted && !compact}
      <span class="in-plan-mark" title="In your plan" aria-label="In plan">●</span>
    {/if}
  </div>

  {#if !compact}
    {#if description}
      <p class="summary">{description}</p>
    {/if}
    {#if why}
      <p class="why"><span class="why-mark" aria-hidden="true">↳</span>{why}</p>
    {/if}
    {#if hasCandidateDrawer || primaryUrl}
      <div class="rest-row">
        {#if hasCandidateDrawer}
          <details class="rest-disclosure">
            <summary class="rest-summary">
              <span class="rest-chev" aria-hidden="true">›</span>
              Details
            </summary>
            <div class="rest-drawer" aria-label="Stop details">
              {#if stop.address}
                {#if mapsUrl}
                  <a class="addr-line" href={mapsUrl} target="_blank" rel="noopener" aria-label="Open in maps: {stop.address}" onclick={(e) => e.stopPropagation()}>
                    <svg class="meta-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-6-5.3-6-10a6 6 0 0 1 12 0c0 4.7-6 10-6 10z" /><circle cx="12" cy="11" r="2" /></svg><span class="meta-text">{stop.address}</span>
                  </a>
                {:else}
                  <span class="addr-line addr-line--static"><svg class="meta-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-6-5.3-6-10a6 6 0 0 1 12 0c0 4.7-6 10-6 10z" /><circle cx="12" cy="11" r="2" /></svg><span class="meta-text">{stop.address}</span></span>
                {/if}
              {/if}
              {#if stop.hours || telUrl}
                <div class="meta-actions">
                  {#if stop.hours}
                    <span class="meta-act meta-act--info" title={stop.hours}>
                      <svg class="meta-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 1.8" /></svg><span class="meta-text">{stop.hours}</span>
                    </span>
                  {/if}
                  {#if telUrl}
                    <a class="meta-act" href={telUrl} aria-label="Call {stop.phone}" onclick={(e) => e.stopPropagation()}>
                      <svg class="meta-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6.5 4h-2A1.5 1.5 0 0 0 3 5.5 15.5 15.5 0 0 0 18.5 21 1.5 1.5 0 0 0 20 19.5v-2a1.5 1.5 0 0 0-1.2-1.47l-2.4-.48a1.5 1.5 0 0 0-1.43.53l-.7.86a12 12 0 0 1-5.2-5.2l.86-.7a1.5 1.5 0 0 0 .53-1.43l-.48-2.4A1.5 1.5 0 0 0 6.5 4z" /></svg><span class="meta-text">call</span>
                    </a>
                  {/if}
                </div>
              {/if}
            </div>
          </details>
        {/if}
        {#if primaryUrl}
          <a class="meta-act rest-link" href={primaryUrl} target="_blank" rel="noopener" aria-label="{primaryLabel} (opens in a new tab)" onclick={(e) => e.stopPropagation()}>
            <svg class="meta-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6" /><path d="M20 4 11 13" /><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" /></svg><span class="meta-text">{primaryLabel}</span>
          </a>
        {/if}
      </div>
    {/if}
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
  /* --chip-ink: glyph color for the solid compact .cat-badge chip.
     Defaults to --text-inverse (cream in light, dark in dark) which
     works for dark fills (historic, cultural, entertainment, outdoors,
     quirky). Food and misc fills are too light for cream to clear 3:1
     decorative glyph contrast — those categories override to --forest-900
     (always dark forest ink, mode-invariant) which clears ≥5:1 in both
     light and dark mode. */
  .stop-card[data-category="historic"]      { --c: var(--cat-historic);      --c-tint: var(--cat-historic-tint);      --c-on: var(--cat-historic-on); }
  .stop-card[data-category="cultural"]      { --c: var(--cat-cultural);      --c-tint: var(--cat-cultural-tint);      --c-on: var(--cat-cultural-on); }
  .stop-card[data-category="food"]          { --c: var(--cat-food);          --c-tint: var(--cat-food-tint);          --c-on: var(--cat-food-on);          --chip-ink: var(--forest-900); }
  .stop-card[data-category="entertainment"] { --c: var(--cat-entertainment); --c-tint: var(--cat-entertainment-tint); --c-on: var(--cat-entertainment-on); }
  .stop-card[data-category="outdoors"]      { --c: var(--cat-outdoors);      --c-tint: var(--cat-outdoors-tint);      --c-on: var(--cat-outdoors-on); }
  .stop-card[data-category="view"]          { --c: var(--cat-view);          --c-tint: var(--cat-view-tint);          --c-on: var(--cat-view-on); }
  .stop-card[data-category="quirky"]        { --c: var(--cat-quirky);        --c-tint: var(--cat-quirky-tint);        --c-on: var(--cat-quirky-on); }
  .stop-card[data-category="shopping"]      { --c: var(--cat-shopping);      --c-tint: var(--cat-shopping-tint);      --c-on: var(--cat-shopping-on); }
  .stop-card[data-category="misc"]          { --c: var(--cat-misc);          --c-tint: var(--cat-misc-tint);          --c-on: var(--cat-misc-on);          --chip-ink: var(--forest-900); }

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
  /* In compact (Plan day card) mode the cat-badge becomes a solid square
     icon-chip matching the global .cat-chip spec: filled with the full
     category color, glyph in --text-inverse. These rules intentionally
     mirror the token treatment in the global .cat-chip utility — we can't
     consume .cat-chip directly here because Svelte's scoped component styles
     (specificity 0,2,0 for .stop-card.compact .cat-badge) would override
     the global utility (0,1,0), leaving the base circular/tint form intact.
     Sized at 24×24 / 0.72rem — slightly smaller than .cat-chip's 28×28 / 14px. */
  .stop-card.compact .cat-badge {
    width: 24px;
    height: 24px;
    border-radius: var(--radius-sm);
    font-size: 0.72rem;
    background: var(--c, var(--cat-misc));
    /* Use --chip-ink when set (food/misc: always-dark --forest-900 to
       clear ≥3:1 decorative glyph contrast on their lighter fills in
       both modes); fall back to --text-inverse (cream/dark per mode)
       for the dark fills that already pass. */
    color: var(--chip-ink, var(--text-inverse));
    box-shadow: none;
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
  }
  /* In compact mode show only the ⠿ grip glyph — no "drag" label text.
     The gesture is discoverable from the Arrange mode button; the label
     clutters the tight day-card row on mobile. Hidden on coarse pointers
     entirely (existing @media rule above). */
  .stop-card.compact .drag-label {
    display: none;
  }
  .stop-card.compact .drag-dots {
    font-size: 0.85rem;
    letter-spacing: -1px;
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
  /* In the Plan itinerary spine the badge is gone, so the address sits flush
     under the name (the rail provides the left gutter, not the badge). */
  .stop-card.compact.in-rail .compact-addr {
    padding-left: 0;
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
  }
  /* why_recommended — the personalized "why this fits you" line, distinct
     from the factual description above it. Muted, with a leading ↳ glyph
     (a text marker, not an absolutely-positioned side-stripe) so it reads
     as the rationale rather than another fact. */
  .why {
    margin: 0;
    display: flex;
    gap: 0.35rem;
    font-size: 0.82rem;
    line-height: 1.4;
    color: var(--text-tertiary);
  }
  .why-mark {
    color: var(--accent-text);
    flex-shrink: 0;
  }
  /* Rest row — the Details disclosure (left) and the single primary link
     (right) share one line, killing the old stacked website→Details→footer
     whitespace. align-items: flex-start keeps the link pinned to the summary
     baseline when the drawer opens and grows downward. The link is pushed
     right with margin-left:auto so it right-aligns even when it's the row's
     only child (a stop with a link but no drawer). */
  .rest-row {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    margin-top: 0.1rem;
  }
  /* The primary link reuses .meta-act for icon+host styling; only the
     right-alignment is layout-specific. */
  .rest-link {
    margin-left: auto;
    flex-shrink: 0;
  }

  /* Meta zone — a calm address line over a row of low-chrome icon-actions
     (hours/website/phone), replacing the former wall of pill chips. The
     emoji icons (📍⏰🌐☎) are gone in favor of inline stroke SVGs in
     currentColor so the meta reads as part of the Dusk palette, not a strip
     of multicolor glyphs. Keeps a long candidate pool fast to scan. */
  .meta-svg {
    width: 13px;
    height: 13px;
    flex-shrink: 0;
    color: var(--text-tertiary);
    transition: color 0.12s;
  }
  .addr-line {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    width: fit-content;
    max-width: 100%;
    min-width: 0;
    font-size: 0.8rem;
    color: var(--text-secondary);
    text-decoration: none;
  }
  a.addr-line { cursor: pointer; }
  a.addr-line:hover { color: var(--accent-text); }
  a.addr-line:hover .meta-svg { color: var(--accent-text); }
  a.addr-line:hover .meta-text { text-decoration: underline; text-underline-offset: 2px; }
  .meta-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.2rem 0.85rem;
  }
  .meta-act {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.76rem;
    color: var(--text-tertiary);
    background: transparent;
    border: none;
    padding: 0;
    text-decoration: none;
  }
  a.meta-act { cursor: pointer; }
  a.meta-act:hover { color: var(--accent-text); }
  a.meta-act:hover .meta-svg { color: var(--accent-text); }
  a.meta-act:hover .meta-text { text-decoration: underline; text-underline-offset: 2px; }
  .meta-text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 17rem;
  }
  @media (pointer: coarse) {
    a.addr-line,
    a.meta-act { min-height: var(--tap-min); }
  }

  /* ── Details disclosure (non-compact candidate card) ──────────────────
     Address/hours/phone tuck behind a native <details> pill, mirroring the
     compact StopCard / TodayStopCard drawer vocabulary (rotating chevron,
     tap-floored summary, reduced-motion guard) but styled for the candidate
     card's --surface-raised chassis (transparent pill + subtle border, so it
     doesn't vanish against the card's own raised fill). */
  .rest-disclosure { margin-top: 0; }
  .rest-summary {
    list-style: none;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.76rem;
    font-weight: 500;
    color: var(--text-secondary);
    user-select: none;
    background: transparent;
    border: 0.5px solid var(--border-subtle);
    border-radius: 999px;
    padding: 0.25rem 0.65rem 0.25rem 0.5rem;
    transition: background-color 0.12s, border-color 0.12s, color 0.12s;
  }
  .rest-summary:hover {
    background: var(--surface-sunken);
    border-color: var(--border-default);
    color: var(--text-primary);
  }
  .rest-summary::-webkit-details-marker { display: none; }
  .rest-chev {
    font-size: 0.8rem;
    line-height: 1;
    color: var(--accent-text);
    transition: transform 0.15s ease;
  }
  .rest-disclosure[open] .rest-chev { transform: rotate(90deg); }
  @media (prefers-reduced-motion: reduce) {
    .rest-chev { transition: none; }
  }
  .rest-drawer {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    margin-top: 0.4rem;
  }
  @media (pointer: coarse) {
    .rest-summary { min-height: var(--tap-min); }
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
     .disclosure (chevron, tap-floor summary) for cross-surface consistency. */
  .stop-card.compact .prep.disclosure {
    padding-top: 0.1rem;
  }
  /* Disclosure summary styled as a pill: raised surface + subtle border +
     rounded corners. Still a native <details> so keyboard/no-JS stays intact.
     Scoped to compact mode so CandidatesSection (compact=false) is unaffected. */
  .stop-card.compact .disclosure-summary {
    list-style: none;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    min-height: var(--tap-min);
    font-size: 0.76rem;
    font-weight: 500;
    color: var(--text-secondary);
    user-select: none;
    /* Pill treatment */
    background: var(--surface-raised);
    border: 0.5px solid var(--border-subtle);
    border-radius: 999px;
    padding: 0.25rem 0.65rem 0.25rem 0.5rem;
  }
  .stop-card.compact .disclosure-summary:hover {
    border-color: var(--border-default);
    color: var(--text-primary);
  }
  .stop-card.compact .disclosure-summary::-webkit-details-marker { display: none; }
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

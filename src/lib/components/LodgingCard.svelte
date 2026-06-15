<script>
  // Lodging candidate card. Diverges from StopCard by FORM, not color:
  // horizontal layout with a media-left bed glyph slot, a 3-dot
  // price-tier ramp, a prominent nights badge, and "Book" as a styled
  // CTA. The brief's "stops look like a place to do; lodging looks
  // like a place to sleep" guidance is implemented as shape, not hue.

  import { formatDayShort } from '$lib/format-date.js';

  let {
    lodging,
    promoted = false,
    // Array of { number, date } objects for the days this lodging is
    // assigned to. The tag renders as "Wed · Thu" when dates are set,
    // falls back to "Day 1, 2" otherwise. Accepts legacy bare-number
    // arrays too (renders the Day-N form in that case).
    daysUsed = [],
    hovered = false,
    readonly = false,
    working = false,
    showDragHandle = true,
    // `compact` is the "I'm assigned to a day card" rendering. Drops the
    // description paragraph and the Set-lodging-for-day button (the parent
    // owns its own affordances), keeps bed glyph + name + price ramp +
    // nights + Book CTA + Hide (which maps to "clear lodging from day").
    compact = false,
    onHover = () => {},
    onClick = () => {},
    onPromote = () => {},
    onHide = () => {},
    ondragstart = () => {},
    ondragend = () => {},
  } = $props();

  // Price tier rendered as a 3-step ramp; sunset family lifts the
  // brand identity into the affordance without inventing a fourth color.
  const PRICE_INDEX = { budget: 1, mid: 2, splurge: 3 };
  const priceLevel = $derived(PRICE_INDEX[lodging.price_tier] ?? 2);

  const priceLabel = $derived(
    lodging.price_tier === 'budget' ? 'Budget'
    : lodging.price_tier === 'splurge' ? 'Splurge'
    : 'Mid'
  );

  function handleDragStart(e) {
    if (!e.dataTransfer) return;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', lodging.id);
    e.dataTransfer.setData('application/x-traverse-candidate', JSON.stringify({ id: lodging.id, type: 'lodging' }));
    ondragstart(lodging.id);
  }
</script>

<article
  class="lodging-card"
  class:promoted
  class:hovered
  class:compact
  draggable={showDragHandle && !readonly && !working ? 'true' : 'false'}
  onmouseenter={() => onHover(lodging.id)}
  onmouseleave={() => onHover(null)}
  onfocusin={() => onHover(lodging.id)}
  onfocusout={() => onHover(null)}
  ondragstart={handleDragStart}
  {ondragend}
  aria-label="Candidate lodging: {lodging.name}"
>
  <div class="bed-slot" aria-hidden="true">
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 17v-7a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v7" />
      <path d="M3 14h18" />
      <path d="M3 17v3" />
      <path d="M21 17v3" />
      <circle cx="8" cy="11" r="1.5" />
    </svg>
  </div>

  <div class="body">
    <div class="head">
      <h3 class="name">{lodging.name}</h3>
      {#if promoted && daysUsed.length && !compact}
        {@const sortedDays = [...daysUsed].sort((a, b) =>
          (typeof a === 'object' ? a.number : a) - (typeof b === 'object' ? b.number : b)
        )}
        {@const hasDates = sortedDays.every((d) => typeof d === 'object' && d?.date)}
        <span class="in-plan-tag" title="In your plan">
          {#if hasDates}
            {sortedDays.map((d) => formatDayShort(d)).join(' · ')}
          {:else}
            Day{sortedDays.length > 1 ? 's' : ''} {sortedDays.map((d) => typeof d === 'object' ? d.number : d).join(', ')}
          {/if}
        </span>
      {/if}
    </div>

    <div class="meta">
      <span class="price-ramp" aria-label="Price tier: {priceLabel}" title="{priceLabel}">
        <span class="dot" class:on={priceLevel >= 1}></span>
        <span class="dot" class:on={priceLevel >= 2}></span>
        <span class="dot" class:on={priceLevel >= 3}></span>
      </span>
      <span class="price-label">{priceLabel}</span>
      {#if lodging.nights}
        <span class="nights-badge">{lodging.nights} night{lodging.nights === 1 ? '' : 's'}</span>
      {/if}
    </div>

    {#if lodging.description && !compact}
      <p class="summary">{lodging.description}</p>
    {/if}

    <footer>
      {#if showDragHandle && !readonly}
        <span class="drag-handle" aria-hidden="true" title={compact ? 'Drag to a different day' : 'Drag onto a day card to assign'}>
          <span class="drag-dots">⋮⋮</span>
          <span class="drag-label">drag</span>
        </span>
      {/if}
      {#if !compact}
        <button
          type="button"
          class="action"
          onclick={(e) => { e.stopPropagation(); onPromote(); }}
          disabled={readonly || working}
        >Assign to day…</button>
      {/if}
      {#if lodging.booking_url}
        <a
          class="book"
          href={lodging.booking_url}
          target="_blank"
          rel="noreferrer noopener"
          onclick={(e) => e.stopPropagation()}
        >Book ↗</a>
      {/if}
      {#if !readonly}
        <button
          type="button"
          class="hide"
          onclick={(e) => { e.stopPropagation(); onHide(); }}
          title={compact ? 'Clear lodging for this day' : 'Hide this candidate'}
          aria-label={compact ? `Clear ${lodging.name} from this day` : `Hide ${lodging.name}`}
          disabled={working}
        >×</button>
      {/if}
    </footer>
  </div>
</article>

<style>
  /* Horizontal layout — the bed-icon slot anchors the card visually as
     "a place to sleep" without using a literal photograph. */
  .lodging-card {
    position: relative;
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.7rem;
    align-items: stretch;
    padding: 0.65rem 0.85rem 0.65rem 0.7rem;
    background: var(--surface-raised);
    border: 1px solid var(--border-subtle);
    border-radius: 5px;
    font-family: var(--font-sans);
    cursor: pointer;
    transition: background-color 0.12s ease, border-color 0.12s ease;
    outline: none;
  }
  .lodging-card:hover,
  .lodging-card:focus-visible {
    border-color: var(--border-default);
  }
  .lodging-card:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }
  .lodging-card.hovered {
    background: color-mix(in oklab, var(--accent) 3%, var(--surface-raised));
  }
  .lodging-card.promoted {
    background: color-mix(in oklab, var(--accent) 4%, var(--surface-raised));
    border-color: color-mix(in oklab, var(--accent) 40%, var(--border-default));
  }
  .lodging-card[draggable="true"]:active { cursor: grabbing; }

  /* Compact mode — the "I'm assigned to a day card" rendering used by
     PlanSection. Drops the description, collapses meta + footer into a
     single row beneath the name, hides the Set-lodging-for-day button
     (the parent owns the assignment gesture), and tightens padding.
     Tinted sub-card: --surface-sunken fill + --radius-md so it reads as
     a nested "place to stay" block, distinct from the stop rows above. */
  .lodging-card.compact {
    padding: 0.5rem 0.65rem 0.5rem 0.55rem;
    gap: 0.55rem;
    background: var(--surface-sunken);
    border-color: var(--border-subtle);
    border-radius: var(--radius-md);
  }
  .lodging-card.compact:hover,
  .lodging-card.compact:focus-visible {
    background: color-mix(in oklab, var(--accent) 4%, var(--surface-sunken));
    border-color: color-mix(in oklab, var(--accent) 30%, var(--border-subtle));
  }
  .lodging-card.compact .bed-slot {
    width: 26px;
    padding-top: 0.05rem;
  }
  .lodging-card.compact .bed-slot svg {
    width: 18px;
    height: 18px;
  }
  .lodging-card.compact .body {
    flex-direction: row;
    align-items: center;
    gap: 0.6rem;
    flex-wrap: wrap;
  }
  .lodging-card.compact .head {
    flex: 1 1 auto;
    min-width: 0;
    margin: 0;
  }
  .lodging-card.compact .name {
    font-size: 0.92rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .lodging-card.compact .meta {
    flex-shrink: 0;
  }
  .lodging-card.compact footer {
    flex-shrink: 0;
    gap: 0.3rem;
    margin-top: 0;
  }
  /* Compact-mode drag handle sizing. PlanSection passes
     showDragHandle={false} on compact lodging cards (lodging isn't
     reorderable across days the way stops are), so these rules only
     kick in if a future caller flips the prop. Matches StopCard's
     compact treatment so the gesture vocabulary stays consistent if
     it ever surfaces. */
  .lodging-card.compact .drag-handle {
    padding: 2px 5px;
    font-size: 9.5px;
  }
  .lodging-card.compact .drag-dots {
    font-size: 0.75rem;
  }
  /* In compact mode the Book button is the primary CTA — accent fill so
     it reads as an actionable "go book this" signal, not a footnote.
     border-radius inherits the 4px from the base .book rule (same as .btn).
     Light mode: uses --sunset-800 fill so cream --text-inverse clears AA
     (5.9:1). Dark mode override below restores --accent fill, where the
     dark --text-inverse (#15211B) gives ≥5.3:1 against the orange fill. */
  .lodging-card.compact .book {
    margin-left: 0;
    padding: 3px 10px;
    font-size: 11px;
    font-weight: 600;
    background: var(--sunset-800);
    color: var(--text-inverse);
    border-color: var(--sunset-800);
  }
  .lodging-card.compact .book:hover {
    background: color-mix(in oklab, var(--sunset-800) 80%, var(--forest-900));
    border-color: color-mix(in oklab, var(--sunset-800) 80%, var(--forest-900));
    color: var(--text-inverse);
  }
  /* Dark mode: restore --accent fill (the dark --text-inverse = #15211B
     gives 5.3:1 on --accent #D87B3F, which passes AA). */
  :global([data-theme="dark"]) .lodging-card.compact .book {
    background: var(--accent);
    border-color: var(--accent);
  }
  :global([data-theme="dark"]) .lodging-card.compact .book:hover {
    background: color-mix(in oklab, var(--accent) 80%, var(--text-primary));
    border-color: color-mix(in oklab, var(--accent) 80%, var(--text-primary));
  }

  /* Bed glyph slot — a small "media" column on the left. The SVG is
     inline so the icon adopts text color via currentColor and respects
     dark mode without a separate asset. */
  .bed-slot {
    width: 38px;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 0.15rem;
    color: var(--bone-600);
  }
  :global([data-theme="dark"]) .bed-slot { color: var(--bone-200); }

  .body {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    min-width: 0;
  }

  .head {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    flex-wrap: wrap;
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
  /* In-plan tag — pill showing which days this lodging covers. Uses
     --sunset-800 fill so cream --text-inverse clears AA in light mode
     (5.9:1). In dark mode (override below) --accent fill passes with
     the dark --text-inverse (5.3:1). */
  .in-plan-tag {
    font-size: 0.7rem;
    font-weight: 600;
    letter-spacing: 0.02em;
    color: var(--text-inverse);
    background: var(--sunset-800);
    padding: 0.12rem 0.45rem;
    border-radius: 999px;
    flex-shrink: 0;
  }
  :global([data-theme="dark"]) .in-plan-tag {
    background: var(--accent);
  }

  /* Price ramp — 3 dots in the sunset family, brand-coherent and unique
     to lodging cards so they read as "lodging affordance" at a glance. */
  .meta {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.74rem;
    color: var(--text-tertiary);
  }
  .price-ramp {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    line-height: 1;
  }
  .price-ramp .dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--bone-400);
    transition: background-color 0.15s;
  }
  .price-ramp .dot.on { background: var(--sunset-600); }
  :global([data-theme="dark"]) .price-ramp .dot { background: var(--bone-800); }
  :global([data-theme="dark"]) .price-ramp .dot.on { background: var(--sunset-400); }
  .price-label {
    color: var(--text-tertiary);
    text-transform: lowercase;
    font-variant: small-caps;
    letter-spacing: 0.04em;
  }
  .nights-badge {
    margin-left: 0.25rem;
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    color: var(--bark-800);
    background: var(--bark-50);
    padding: 0.14rem 0.45rem;
    border-radius: 3px;
  }
  :global([data-theme="dark"]) .nights-badge {
    color: var(--bark-100);
    background: var(--bark-800);
  }

  .summary {
    margin: 0;
    font-size: 0.84rem;
    line-height: 1.45;
    color: var(--text-secondary);
  }

  footer {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex-wrap: wrap;
    margin-top: 0.1rem;
  }
  /* Labeled drag affordance ("⋮⋮ drag") + hidden on touch. Same pattern
     as StopCard — see comment there for rationale. */
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
    border-color: var(--border-strong);
  }
  .action:disabled { opacity: 0.5; cursor: not-allowed; }

  /* Book CTA — styled as a real outgoing action, not a footnote arrow.
     Inverse of `.action` so it reads as the affirmative "go to booking" gesture. */
  .book {
    margin-left: auto;
    font-size: 11.5px;
    font-weight: 600;
    color: var(--accent-text);
    background: color-mix(in oklab, var(--accent) 10%, transparent);
    border: 0.5px solid color-mix(in oklab, var(--accent) 40%, transparent);
    padding: 3px 9px;
    border-radius: 4px;
    text-decoration: none;
    transition: background-color 0.12s, border-color 0.12s, color 0.12s;
  }
  .book:hover {
    background: color-mix(in oklab, var(--accent) 18%, transparent);
    border-color: var(--accent);
    color: var(--text-primary);
  }

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
  .lodging-card:hover .hide,
  .lodging-card:focus-within .hide {
    opacity: 1;
  }
  .hide:hover:not(:disabled) { color: var(--state-danger); }
  .hide:disabled { opacity: 0.3; cursor: not-allowed; }
  @media (pointer: coarse) {
    /* LodgingCard had no touch floors — Assign / Book / clear-× all sat
       ~20px tall. Bring it to parity with StopCard. */
    .action {
      min-height: var(--tap-min);
      padding: 0.5rem 0.85rem;
    }
    .book {
      min-height: var(--tap-min);
      display: inline-flex;
      align-items: center;
    }
    .hide {
      opacity: 1;
      min-width: var(--tap-min);
      min-height: var(--tap-min);
      padding: 0 0.5rem;
    }
  }
</style>

<script>
  // Read-only stop card for the Today in-trip view. Focused on phone-first
  // legibility: large tap targets, category chip, meta rows, action row,
  // and a collapsible tips/to-dos disclosure.
  //
  // No edit affordances, no event dispatching for mutations.

  import { navUrl, telHref } from '$lib/today.js';

  let {
    stop,
    destination,
    number,
    isFirst = false,
  } = $props();

  // Build CSS variable references for the category chip from the stop's
  // category, mirroring the pattern in StopCard.svelte. Unknown categories
  // gracefully fall through to the --cat-misc tokens.
  const KNOWN_CATEGORIES = new Set([
    'historic', 'cultural', 'food', 'entertainment',
    'outdoors', 'view', 'quirky', 'shopping', 'misc',
  ]);

  const cat = $derived(
    KNOWN_CATEGORIES.has(stop.category) ? stop.category : 'misc'
  );

  // Each category maps to a single glyph to reinforce identity alongside color.
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

  const glyph = $derived(CATEGORY_GLYPH[cat] ?? CATEGORY_GLYPH.misc);

  // Derived action hrefs — compute only once per render.
  const navigateHref = $derived(navUrl(stop, destination));
  const callHref     = $derived(stop.phone ? telHref(stop.phone) : null);

  // Tips & to-dos disclosure: only render when there is something to show.
  const hasTips  = $derived(!!(stop.tips?.length));
  const hasTodos = $derived(!!(stop.todos?.length));
  const hasDisclosure = $derived(hasTips || hasTodos);

  // Summary label for the disclosure: omit zero counts, use singular where count is 1.
  const disclosureLabel = $derived.by(() => {
    const parts = [];
    if (hasTips) {
      const n = stop.tips.length;
      parts.push(`${n} ${n === 1 ? 'tip' : 'tips'}`);
    }
    if (hasTodos) {
      const n = stop.todos.length;
      parts.push(`${n} ${n === 1 ? 'to-do' : 'to-dos'}`);
    }
    return `Tips & to-dos (${parts.join(' · ')})`;
  });
</script>

<article
  class="stop-card"
  class:first={isFirst}
  data-category={cat}
  aria-label="Stop {number}: {stop.name}"
>
  <!-- ── Header: number marker + name + category chip ── -->
  <div class="stop-head">
    <div class="num-marker" class:num-marker--first={isFirst} aria-hidden="true">
      {number}
    </div>
    <div class="stop-title">
      <h3 class="stop-name">{stop.name}</h3>
      <span class="cat-chip" aria-label="Category: {stop.category}">{stop.category}</span>
    </div>
  </div>

  {#if isFirst}
    <div class="start-here" aria-label="First stop of the day">Start here</div>
  {/if}

  <!-- ── Description ── -->
  {#if stop.description}
    <p class="description">{stop.description}</p>
  {/if}

  <!-- ── Meta rows: hours + address — each only when present ── -->
  {#if stop.hours || stop.address}
    <div class="meta" aria-label="Stop details">
      {#if stop.hours}
        <div class="meta-row">
          <span class="meta-icon" aria-hidden="true">◷</span>
          <span class="meta-value meta-value--muted">{stop.hours}</span>
        </div>
      {/if}
      {#if stop.address}
        <div class="meta-row">
          <span class="meta-icon" aria-hidden="true">◎</span>
          <span class="meta-value">{stop.address}</span>
        </div>
      {/if}
    </div>
  {/if}

  <!-- ── Action row: Navigate always present; Call + Site conditional ── -->
  <div class="actions">
    <a
      class="action-btn action-btn--primary"
      href={navigateHref}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Navigate to {stop.name}"
    >↗ Navigate</a>
    {#if callHref}
      <a
        class="action-btn"
        href={callHref}
        aria-label="Call {stop.name}: {stop.phone}"
      >☎ Call</a>
    {/if}
    {#if stop.website}
      <a
        class="action-btn"
        href={stop.website}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Website for {stop.name}"
      >⤴ Site</a>
    {/if}
  </div>

  <!-- ── Collapsible tips & to-dos — omitted when both arrays are empty ── -->
  {#if hasDisclosure}
    <details class="disclosure">
      <summary class="disclosure-summary">
        <span class="disclosure-chev" aria-hidden="true">›</span>
        {disclosureLabel}
      </summary>

      {#if hasTips}
        <ul class="tip-list" aria-label="Tips">
          {#each stop.tips as tip}
            <li>{tip}</li>
          {/each}
        </ul>
      {/if}

      {#if hasTodos}
        <ul class="todo-list" aria-label="To-dos">
          {#each stop.todos as todo (todo.id)}
            <li class:done={todo.done}>
              <!-- Read-only done indicator — not interactive -->
              <span class="todo-box" aria-label={todo.done ? 'Done' : 'Not done'}>
                {#if todo.done}<span class="todo-check" aria-hidden="true">✓</span>{/if}
              </span>
              <span class="todo-text">{todo.text}</span>
            </li>
          {/each}
        </ul>
      {/if}
    </details>
  {/if}
</article>

<style>
  /* ── Card chassis ── */
  .stop-card {
    background: var(--surface-raised);
    border: 1px solid var(--border-subtle);
    border-radius: 16px;
    padding: 14px;
    margin-bottom: 12px;
    position: relative;
    font-family: var(--font-sans);

    /* Category color forwarding via data-attribute — mirrors StopCard.svelte.
       Local --c / --c-tint / --c-on resolve per category. */
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

  /* "Start here" emphasis: prominent border in the category accent color */
  .stop-card.first {
    border-color: var(--c, var(--accent));
    /* Double-ring effect: use box-shadow so the layout is not disturbed. */
    box-shadow: 0 0 0 1px var(--c, var(--accent));
  }

  /* ── Header row ── */
  .stop-head {
    display: flex;
    gap: 12px;
    align-items: flex-start;
    margin-bottom: 8px;
  }

  /* Number marker — circle badge in the category tint. */
  .num-marker {
    flex: 0 0 auto;
    width: 30px;
    height: 30px;
    border-radius: 50%;
    background: var(--c-tint, var(--surface-sunken));
    color: var(--c-on, var(--text-tertiary));
    font-family: var(--font-mono);
    font-size: 14px;
    font-weight: 600;
    line-height: 30px;
    text-align: center;
    /* Thin ring using the category saturated color */
    box-shadow: inset 0 0 0 1.5px color-mix(in oklab, var(--c, var(--border-default)) 40%, transparent);
  }

  /* "Start here" variant: filled marker */
  .num-marker--first {
    background: var(--c, var(--accent));
    color: var(--text-inverse);
    box-shadow: none;
  }

  .stop-title {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .stop-name {
    margin: 0;
    font-family: var(--font-serif);
    font-size: 19px;
    font-weight: 600;
    line-height: 1.2;
    color: var(--text-primary);
    letter-spacing: -0.01em;
  }

  /* Category chip — tinted pill with the category's on-color text */
  .cat-chip {
    display: inline-block;
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--c-on, var(--text-tertiary));
    background: var(--c-tint, var(--surface-sunken));
    padding: 4px 8px;
    border-radius: 6px;
    align-self: flex-start;
    /* Subtle category-color ring */
    box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--c, var(--border-default)) 25%, transparent);
  }

  /* "Start here" badge — a small inline affordance below the header */
  .start-here {
    display: inline-block;
    margin-bottom: 8px;
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--c-on, var(--text-inverse));
    background: var(--c, var(--accent));
    padding: 4px 8px;
    border-radius: 999px;
  }

  /* ── Description ── */
  .description {
    margin: 0 0 10px;
    font-size: 14px;
    line-height: 1.45;
    color: var(--text-secondary);
  }

  /* ── Meta rows ── */
  .meta {
    display: grid;
    gap: 6px;
    margin-bottom: 12px;
  }

  .meta-row {
    display: flex;
    gap: 9px;
    font-size: 14px;
    align-items: flex-start;
  }

  .meta-icon {
    flex: 0 0 auto;
    width: 18px;
    text-align: center;
    color: var(--text-tertiary);
    font-size: 13px;
    line-height: 1.5;
  }

  .meta-value {
    color: var(--text-primary);
    line-height: 1.4;
  }

  .meta-value--muted {
    color: var(--text-tertiary);
    font-style: italic;
  }

  /* ── Action row ── */
  .actions {
    display: flex;
    gap: 8px;
    margin-bottom: 0;
  }

  .action-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    min-height: 46px;
    border-radius: 11px;
    border: 1px solid var(--border-default);
    background: var(--surface-raised);
    color: var(--text-primary);
    font-family: var(--font-sans);
    font-size: 14px;
    font-weight: 600;
    text-decoration: none;
    transition: background-color 0.12s, border-color 0.12s, color 0.12s;
  }

  .action-btn:hover,
  .action-btn:focus-visible {
    background: var(--surface-sunken);
    border-color: var(--border-strong);
  }

  .action-btn:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  /* Primary (Navigate) — category tinted */
  .action-btn--primary {
    background: var(--c, var(--accent));
    border-color: var(--c, var(--accent));
    color: var(--text-inverse);
  }

  .action-btn--primary:hover,
  .action-btn--primary:focus-visible {
    background: color-mix(in oklab, var(--c, var(--accent)) 85%, var(--text-primary));
    border-color: color-mix(in oklab, var(--c, var(--accent)) 85%, var(--text-primary));
    color: var(--text-inverse);
  }

  /* ── Disclosure: Tips & to-dos ── */
  .disclosure {
    margin-top: 12px;
    border-top: 1px dashed var(--border-subtle);
    padding-top: 10px;
  }

  .disclosure-summary {
    list-style: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13.5px;
    font-weight: 600;
    color: var(--c, var(--accent-text));
    user-select: none;
    /* Ensure the summary row meets the tap-target minimum on coarse
       pointers — wrapping in a min-height on the summary itself. */
    min-height: 44px;
  }

  /* Remove the default disclosure triangle in WebKit */
  .disclosure-summary::-webkit-details-marker { display: none; }

  .disclosure-chev {
    font-size: 13px;
    transition: transform 0.15s;
    line-height: 1;
  }

  .disclosure[open] .disclosure-chev {
    transform: rotate(90deg);
  }

  /* Tip list — bullet-styled, category accent bullets */
  .tip-list {
    margin: 10px 0 4px;
    padding: 0;
    list-style: none;
    display: grid;
    gap: 8px;
  }

  .tip-list li {
    font-size: 13.5px;
    color: var(--text-secondary);
    display: flex;
    gap: 8px;
    line-height: 1.45;
  }

  .tip-list li::before {
    content: "·";
    color: var(--c, var(--accent-text));
    font-weight: 700;
    flex-shrink: 0;
  }

  /* To-do list — custom checkbox indicator, read-only */
  .todo-list {
    margin: 8px 0 2px;
    padding: 0;
    list-style: none;
    display: grid;
    gap: 8px;
  }

  .todo-list li {
    font-size: 13.5px;
    display: flex;
    gap: 9px;
    align-items: flex-start;
    color: var(--text-primary);
    line-height: 1.4;
  }

  .todo-list li.done .todo-text {
    color: var(--text-tertiary);
    text-decoration: line-through;
  }

  /* The done-indicator box: styled border box, filled when done.
     Not interactive — pointer-events disabled so it reads truly as a display. */
  .todo-box {
    flex: 0 0 auto;
    width: 17px;
    height: 17px;
    border: 1.5px solid var(--border-strong);
    border-radius: 5px;
    margin-top: 2px;
    position: relative;
    pointer-events: none;
    background: transparent;
  }

  .todo-list li.done .todo-box {
    background: var(--state-success);
    border-color: var(--state-success);
  }

  .todo-check {
    position: absolute;
    top: -2px;
    left: 2px;
    color: var(--text-inverse);
    font-size: 12px;
    line-height: 1;
    font-weight: 700;
  }

  .todo-text {
    flex: 1;
    min-width: 0;
  }

  /* ── Coarse-pointer overrides (phone) ── */
  @media (pointer: coarse) {
    .action-btn {
      min-height: var(--tap-min);
      font-size: 15px;
    }
    .disclosure-summary {
      min-height: var(--tap-min);
    }
  }
</style>

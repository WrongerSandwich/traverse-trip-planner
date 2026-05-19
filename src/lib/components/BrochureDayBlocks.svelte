<script>
  // Day-by-day render of a structured brochure's `days` array. Used in
  // both the trip detail page (above the canonical planning sections)
  // and the standalone brochure page (within the itinerary section).
  // One visual language across both surfaces — Fraunces day numerals,
  // italic theme, mono period eyebrows, mono times in a dotted-rule
  // tabular layout.

  /** @type {{ days: Array }} */
  let { days } = $props();
</script>

<div class="day-blocks">
  {#each days ?? [] as day}
    <article class="day-block">
      <h2 class="day-heading">
        <span class="day-n">Day {day.n}</span>
        {#if day.date}<span class="day-date">{day.date}</span>{/if}
      </h2>
      {#if day.theme}<p class="day-theme">{day.theme}</p>{/if}
      {#each day.blocks ?? [] as block}
        {#if block.items?.length}
          <div class="block">
            <h3 class="block-period">{block.period}</h3>
            <ul class="block-items">
              {#each block.items as item}
                <li>
                  {#if item.time}<span class="item-time">{item.time}</span>{/if}
                  <span class="item-activity">{item.activity}</span>
                </li>
              {/each}
            </ul>
          </div>
        {/if}
      {/each}
    </article>
  {/each}
</div>

<style>
  .day-blocks { margin: 0; }

  .day-block {
    margin-top: 1.5rem;
    padding-top: 1.25rem;
    border-top: 0.5px solid var(--border-subtle);
  }
  .day-block:first-of-type {
    margin-top: 0.5rem;
    padding-top: 0;
    border-top: none;
  }
  .day-heading {
    display: flex;
    align-items: baseline;
    gap: 14px;
    margin: 0 0 0.25rem;
  }
  .day-n {
    font-family: var(--font-serif);
    font-size: 26px;
    line-height: 32px;
    font-weight: 500;
    color: var(--text-secondary);
    letter-spacing: 0.003em;
  }
  .day-date {
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 500;
    color: var(--accent);
    letter-spacing: 0.08em;
  }
  .day-theme {
    font-family: var(--font-serif);
    font-style: italic;
    font-size: 16px;
    font-weight: 500;
    color: var(--text-tertiary);
    margin: 0 0 1rem;
  }
  .block { margin-top: 1rem; }
  .block-period {
    font-family: var(--font-sans);
    font-size: 11px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.22em;
    color: var(--text-tertiary);
    margin: 0 0 0.5rem;
  }
  .block-items { list-style: none; margin: 0; padding: 0; }
  .block-items li {
    display: grid;
    grid-template-columns: 88px 1fr;
    column-gap: 14px;
    padding: 4px 0;
    font-family: var(--font-sans);
    font-size: 14px;
    line-height: 1.5;
    color: var(--text-primary);
    border-bottom: 0.5px dotted var(--border-subtle);
  }
  .block-items li:last-child { border-bottom: none; }
  .item-time {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-secondary);
    letter-spacing: 0.04em;
    align-self: baseline;
    font-variant-numeric: tabular-nums;
  }
  .item-activity { color: var(--text-primary); }

  @media (max-width: 640px) {
    .block-items li { grid-template-columns: 64px 1fr; column-gap: 10px; }
  }
</style>

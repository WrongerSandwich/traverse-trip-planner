<script>
  import { flattenBrochureDays } from '$lib/utils/brochureDays.js';

  /** @type {{ days: Array }} */
  let { days } = $props();

  const flatDays = $derived(flattenBrochureDays(days));
</script>

<div class="brochure-day-view">
  {#each flatDays as day}
    <div class="brochure-day">
      <h2 class="day-heading">
        Day {day.n}{day.theme ? ` — ${day.theme}` : ''}
      </h2>
      {#each day.periods as period}
        <div class="day-period">
          <h3 class="period-heading">{period.label}</h3>
          <ul class="period-items">
            {#each period.items as item}
              <li class="period-item">
                {#if item.time}
                  <span class="item-time">{item.time}</span>
                  <span class="item-sep"> — </span>
                {/if}
                <span class="item-activity">{item.activity}</span>
              </li>
            {/each}
          </ul>
        </div>
      {/each}
    </div>
  {/each}
</div>

<style>
  .brochure-day-view {
    margin: 0;
  }

  .brochure-day {
    margin-bottom: 2rem;
  }

  .brochure-day:last-child {
    margin-bottom: 0;
  }

  .day-heading {
    font-size: 1.15rem;
    font-weight: 600;
    margin: 0 0 0.75rem;
    padding-bottom: 0.35rem;
    border-bottom: 1px solid var(--color-border, #e2e8f0);
  }

  .day-period {
    margin-bottom: 1rem;
  }

  .day-period:last-child {
    margin-bottom: 0;
  }

  .period-heading {
    font-size: 0.9rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--color-muted, #64748b);
    margin: 0 0 0.4rem;
  }

  .period-items {
    list-style: disc;
    padding-left: 1.25rem;
    margin: 0;
  }

  .period-item {
    margin-bottom: 0.25rem;
    line-height: 1.5;
  }

  .item-time {
    font-variant-numeric: tabular-nums;
    color: var(--color-muted, #64748b);
    font-size: 0.875rem;
  }

  .item-sep {
    color: var(--color-muted, #64748b);
  }
</style>

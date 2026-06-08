<script>
  // Today view — phone-first, single-column render of one day of a trip.
  // Read-only; derived live from plan + candidates via deriveBrochure().
  // Day switching via ?day=N links — works without JS (plain GET navigation).

  import TodayStopCard from '$lib/components/TodayStopCard.svelte';
  import { navUrl } from '$lib/today.js';

  let { data } = $props();

  // Format a YYYY-MM-DD date string as "Weekday, Month D" (e.g. "Friday, June 20").
  // Returns an empty string for missing/unparseable dates (avoids rendering "Invalid Date").
  function formatDayHeading(dateStr) {
    if (!dateStr) return '';
    // Parse as local midnight by appending T00:00:00 without a timezone offset.
    // Date-only strings (YYYY-MM-DD) are parsed as UTC midnight by the spec, which
    // means toLocaleDateString can show the wrong day near midnight in western timezones.
    // Appending T00:00:00 forces the local-timezone constructor path.
    const d = new Date(`${dateStr}T00:00:00`);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
  }

  // Format a YYYY-MM-DD date as a short "Mon D" label (e.g. "Jun 20") for day pills.
  // Returns an empty string for missing/unparseable dates.
  function formatShortDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(`${dateStr}T00:00:00`);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  // Build a navigate URL for lodging (name + coords only — no address field).
  function lodgingNavUrl(lodging) {
    return navUrl(
      { name: lodging.name, coords: lodging.coords ?? null },
      data.destination,
    );
  }

  const hasFieldGuide = $derived(
    !!(data.fieldGuideNotes?.length || data.gotchas?.length),
  );
</script>

<svelte:head>
  <title>Today — {data.title || data.trip?._slug} · Traverse</title>
</svelte:head>

{#if !data.hasPlan}
  <!-- ── Empty state: trip has no plan yet ── -->
  <div class="empty-wrap">
    <div class="empty-card">
      <p class="empty-headline">No day-by-day plan yet</p>
      <p class="empty-body">
        Research this trip first to generate a day-by-day plan, then come back
        here when you're on the road.
      </p>
      <a class="empty-link" href="/trips/{data.trip._slug}">← Back to trip</a>
    </div>
  </div>
{:else}
  <!-- ── Main layout ── -->
  <div class="page">

    <!-- ── Sticky header ── -->
    <header class="sticky-header">
      <div class="header-top">
        <a
          class="back-link"
          href="/trips/{data.trip._slug}"
          aria-label="Back to {data.title || data.trip._slug}"
        >‹</a>
        <div class="header-title-block">
          <span class="eyebrow">Today</span>
          <span class="trip-title">{data.title || data.trip._slug}</span>
        </div>
      </div>

      <!-- Day picker — horizontally scrollable pills, plain links for no-JS switching -->
      <nav class="day-picker" aria-label="Day picker">
        {#each data.dayPills as pill (pill.n)}
          {@const isActive = pill.n === data.selectedDay}
          {@const shortDate = formatShortDate(pill.date)}
          <a
            class="day-pill"
            class:day-pill--active={isActive}
            href="?day={pill.n}"
            aria-current={isActive ? 'page' : undefined}
            aria-label={shortDate ? `Day ${pill.n}, ${shortDate}` : `Day ${pill.n}`}
          >
            <span class="pill-day">Day {pill.n}</span>
            {#if shortDate}<span class="pill-date">{shortDate}</span>{/if}
          </a>
        {/each}
      </nav>
    </header>

    <div class="content">

      <!-- ── Smart-default hint ── -->
      {#if data.startsInDays != null && data.selectedDay === 1}
        <p class="starts-hint">
          Trip starts in {data.startsInDays} {data.startsInDays === 1 ? 'day' : 'days'} — showing Day 1
        </p>
      {/if}

      <!-- ── Day heading ── -->
      <div class="day-heading">
        {#if data.day.date}
          <h1 class="day-date">{formatDayHeading(data.day.date)}</h1>
        {:else}
          <h1 class="day-date">Day {data.selectedDay}</h1>
        {/if}
        <p class="day-sub">Day {data.selectedDay} of {data.dayCount} · {data.destination}</p>
      </div>

      <!-- ── Stops ── -->
      {#if data.day.stops?.length}
        <div class="section-label" aria-hidden="true">Stops</div>
        <section aria-label="Stops for day {data.selectedDay}">
          {#each data.day.stops as stop, i}
            <TodayStopCard
              {stop}
              destination={data.destination}
              number={i + 1}
              isFirst={i === 0}
            />
          {/each}
        </section>
      {:else}
        <p class="empty-day">No stops planned for this day.</p>
      {/if}

      <!-- ── Tonight (lodging) ── -->
      {#if data.day.lodging}
        <div class="section-label" aria-hidden="true">Tonight</div>
        <section class="lodging-card" aria-label="Tonight's lodging">
          <span class="lodging-moon" aria-hidden="true">☾</span>
          <div class="lodging-body">
            <p class="lodging-name">{data.day.lodging.name}</p>
            <div class="lodging-actions">
              <a
                class="action-btn action-btn--primary"
                href={lodgingNavUrl(data.day.lodging)}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Navigate to {data.day.lodging.name}"
              ><span aria-hidden="true">↗</span> Navigate</a>
              {#if data.day.lodging.booking_url}
                <a
                  class="action-btn"
                  href={data.day.lodging.booking_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Booking for {data.day.lodging.name}"
                ><span aria-hidden="true">⤴</span> Booking</a>
              {/if}
            </div>
          </div>
        </section>
      {/if}

      <!-- ── Field guide & gotchas (trip-wide, collapsed) ── -->
      {#if hasFieldGuide}
        <details class="field-guide">
          <summary class="field-guide-summary">
            <span class="field-guide-title">Field guide &amp; gotchas</span>
            <span class="field-guide-chev" aria-hidden="true">›</span>
          </summary>

          {#if data.fieldGuideNotes?.length}
            <p class="fg-section-label">Notes</p>
            <ul class="fg-list">
              {#each data.fieldGuideNotes as note}
                <li>{note}</li>
              {/each}
            </ul>
          {/if}

          {#if data.gotchas?.length}
            <p class="fg-section-label fg-section-label--gotcha">Gotchas</p>
            <ul class="fg-list fg-list--gotcha">
              {#each data.gotchas as gotcha}
                <li>{gotcha}</li>
              {/each}
            </ul>
          {/if}
        </details>
      {/if}

      <!-- ── Footer ── -->
      <footer class="today-footer">Read-only · derived live from this trip's plan</footer>

    </div><!-- /.content -->
  </div><!-- /.page -->
{/if}

<style>
  /* ── Page wrapper ── */
  .page {
    background: var(--surface-page);
    min-height: 100dvh;
    font-family: var(--font-sans);
    color: var(--text-primary);
  }

  /* ── Sticky header ── */
  .sticky-header {
    position: sticky;
    top: 0;
    z-index: 10;
    background: color-mix(in srgb, var(--surface-page) 88%, transparent);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    border-bottom: 1px solid var(--border-subtle);
  }

  .header-top {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px 6px;
    max-width: 540px;
    margin: 0 auto;
  }

  .back-link {
    flex: 0 0 auto;
    font-size: 24px;
    color: var(--text-tertiary);
    text-decoration: none;
    line-height: 1;
    /* Ensure ≥44px tap target */
    min-width: 44px;
    min-height: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 8px;
  }

  .back-link:hover,
  .back-link:focus-visible {
    color: var(--text-primary);
    background: var(--surface-sunken);
  }

  .back-link:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  .header-title-block {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .eyebrow {
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--accent-text);
  }

  .trip-title {
    font-family: var(--font-serif);
    font-size: 14px;
    font-weight: 600;
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* ── Day picker ── */
  .day-picker {
    display: flex;
    gap: 8px;
    padding: 8px 16px 12px;
    max-width: 540px;
    margin: 0 auto;
    overflow-x: auto;
    /* Hide scrollbar but keep scrollability for long trips */
    scrollbar-width: none;
  }

  .day-picker::-webkit-scrollbar {
    display: none;
  }

  .day-pill {
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    min-height: 44px;
    padding: 8px 14px;
    border: 1px solid var(--border-default);
    border-radius: 999px;
    background: var(--surface-raised);
    text-decoration: none;
    color: var(--text-secondary);
    transition: background-color 0.12s, border-color 0.12s, color 0.12s;
  }

  .day-pill:hover,
  .day-pill:focus-visible {
    background: var(--surface-sunken);
    border-color: var(--border-strong);
  }

  .day-pill:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  .day-pill--active {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--text-inverse);
  }

  .day-pill--active:hover,
  .day-pill--active:focus-visible {
    background: color-mix(in oklab, var(--accent) 85%, var(--text-primary));
    border-color: color-mix(in oklab, var(--accent) 85%, var(--text-primary));
    color: var(--text-inverse);
  }

  .pill-day {
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.10em;
    text-transform: uppercase;
  }

  .pill-date {
    font-size: 13px;
    font-weight: 500;
    white-space: nowrap;
  }

  /* ── Content area ── */
  .content {
    max-width: 540px;
    margin: 0 auto;
    padding: 0 16px 40px;
  }

  /* ── Smart-default hint ── */
  .starts-hint {
    font-size: 12.5px;
    font-weight: 500;
    color: var(--text-tertiary);
    padding: 8px 0 4px;
  }

  /* ── Day heading ── */
  .day-heading {
    margin: 16px 0 4px;
  }

  .day-date {
    font-family: var(--font-serif);
    font-weight: 600;
    font-size: 26px;
    letter-spacing: -0.01em;
    color: var(--text-primary);
    margin: 0 0 4px;
    line-height: 1.2;
  }

  .day-sub {
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-tertiary);
    margin: 0;
  }

  /* ── Section label ── */
  .section-label {
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-tertiary);
    margin: 22px 0 10px 2px;
  }

  /* ── Empty day placeholder ── */
  .empty-day {
    font-size: 14px;
    color: var(--text-tertiary);
    font-style: italic;
    margin: 22px 0 12px;
  }

  /* ── Lodging card ── */
  .lodging-card {
    background: var(--surface-raised);
    border: 1px solid var(--border-subtle);
    border-radius: 16px;
    padding: 14px;
    display: flex;
    gap: 12px;
    align-items: flex-start;
    margin-bottom: 12px;
  }

  .lodging-moon {
    flex: 0 0 auto;
    font-size: 20px;
    line-height: 1;
    margin-top: 2px;
  }

  .lodging-body {
    flex: 1;
    min-width: 0;
  }

  .lodging-name {
    font-family: var(--font-serif);
    font-size: 17px;
    font-weight: 600;
    line-height: 1.2;
    color: var(--text-primary);
    margin: 0 0 10px;
  }

  .lodging-actions {
    display: flex;
    gap: 8px;
  }

  /* Action buttons — shared between lodging and used by TodayStopCard.
     These are only needed here for the lodging card; stop cards use
     TodayStopCard's own scoped styles. */
  .action-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    min-height: 44px;
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

  .action-btn--primary {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--text-inverse);
  }

  .action-btn--primary:hover,
  .action-btn--primary:focus-visible {
    background: color-mix(in oklab, var(--accent) 85%, var(--text-primary));
    border-color: color-mix(in oklab, var(--accent) 85%, var(--text-primary));
    color: var(--text-inverse);
  }

  /* ── Field guide & gotchas ── */
  .field-guide {
    background: var(--surface-raised);
    border: 1px solid var(--border-subtle);
    border-radius: 16px;
    padding: 14px;
    margin-top: 12px;
  }

  .field-guide-summary {
    list-style: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 44px;
    user-select: none;
  }

  .field-guide-summary::-webkit-details-marker {
    display: none;
  }

  .field-guide-title {
    font-family: var(--font-serif);
    font-size: 17px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .field-guide-chev {
    font-size: 14px;
    color: var(--text-tertiary);
    transition: transform 0.15s;
    line-height: 1;
    flex-shrink: 0;
  }

  .field-guide[open] .field-guide-chev {
    transform: rotate(90deg);
  }

  .fg-section-label {
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-tertiary);
    margin: 16px 0 8px;
  }

  .fg-section-label--gotcha {
    color: var(--state-warning);
  }

  .fg-list {
    margin: 0;
    padding-left: 18px;
    display: grid;
    gap: 7px;
  }

  .fg-list li {
    font-size: 13.5px;
    color: var(--text-secondary);
    line-height: 1.45;
  }

  .fg-list--gotcha li {
    color: var(--state-warning);
  }

  /* ── Footer ── */
  .today-footer {
    text-align: center;
    font-size: 12px;
    color: var(--text-tertiary);
    margin: 24px 0 0;
    opacity: 0.8;
  }

  /* ── Empty state ── */
  .empty-wrap {
    min-height: 100dvh;
    background: var(--surface-page);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px 16px;
  }

  .empty-card {
    background: var(--surface-raised);
    border: 1px solid var(--border-subtle);
    border-radius: 20px;
    padding: 28px 24px;
    max-width: 400px;
    text-align: center;
  }

  .empty-headline {
    font-family: var(--font-serif);
    font-size: 20px;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0 0 10px;
  }

  .empty-body {
    font-size: 14px;
    color: var(--text-secondary);
    line-height: 1.5;
    margin: 0 0 20px;
  }

  .empty-link {
    display: inline-block;
    font-size: 14px;
    font-weight: 600;
    color: var(--accent-text);
    text-decoration: none;
    border: 1px solid var(--border-default);
    border-radius: 8px;
    padding: 10px 18px;
    min-height: 44px;
    line-height: 22px;
  }

  .empty-link:hover,
  .empty-link:focus-visible {
    background: var(--surface-sunken);
    border-color: var(--border-strong);
  }

  .empty-link:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  /* ── Coarse-pointer overrides (phone) ── */
  @media (pointer: coarse) {
    .action-btn {
      min-height: var(--tap-min);
      font-size: 15px;
    }
  }
</style>

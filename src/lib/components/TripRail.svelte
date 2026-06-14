<script>
  // Desktop sticky trip rail — mini overview map, quick stats, and section
  // jump-nav with scroll-spy highlight. Visible only at ≥960px (parent
  // controls display:none on mobile). Purely presentational — no writes,
  // no mutations.

  import TripMap from '$lib/components/TripMap.svelte';
  import { tripQuickStats } from '$lib/utils/trip-rail.js';

  let {
    trip = null,
    home = null,
    // Ordered { id, label } list of sections to show in the jump-nav.
    sections = [],
    // The section id currently in view (from the parent's scroll-spy).
    activeId = null,
    // Number of planned days — comes from data.plan?.days?.length (not on trip).
    planDaysCount = null,
    // Pass-throughs for TripMap
    color = null,
    driveLabel: driveLabelProp = null,
    showWaypointHint = false,
    // Action callbacks forwarded to the rail map so desktop users see the
    // same Research → / Edit overview affordances as the inline mobile map.
    onResearch = null,
    onEditOverview = null,
  } = $props();

  const stats = $derived(tripQuickStats(trip ?? {}, planDaysCount));
  const hasMap = $derived(Array.isArray(trip?._coords));
</script>

<div class="trip-rail">
  {#if hasMap}
    <div class="rail-map">
      <TripMap
        mode="overview"
        {trip}
        home={home?.coords ?? home}
        {color}
        driveLabel={driveLabelProp}
        homeDistanceMi={trip?.home_distance_mi ?? null}
        {showWaypointHint}
        onResearch={onResearch}
        onEditOverview={onEditOverview}
      />
    </div>
  {/if}

  {#if stats.length > 0}
    <div class="rail-stats" aria-label="Trip stats">
      {#each stats as stat, i}
        <div class="stat-row" class:stat-row-first={i === 0}>
          <span class="stat-label">{stat.label}</span>
          <span class="stat-value">{stat.value}</span>
        </div>
      {/each}
    </div>
  {/if}

  {#if sections.length > 0}
    <nav class="rail-nav" aria-label="Jump to section">
      <ul role="list">
        {#each sections as section}
          <li>
            <a
              href="#section-{section.id}"
              class="nav-link"
              class:nav-link-active={activeId === section.id}
              aria-current={activeId === section.id ? 'location' : undefined}
            >
              {section.label}
            </a>
          </li>
        {/each}
      </ul>
    </nav>
  {/if}
</div>

<style>
  .trip-rail {
    background: var(--surface-raised);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-card);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  /* Mini overview map — compact but tall enough to show the route. */
  .rail-map {
    height: 180px;
    flex-shrink: 0;
    /* Contain Leaflet's internal z-index controls. */
    isolation: isolate;
    /* Map overflows the card's rounded corners at the top without this. */
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    overflow: hidden;
  }

  /* Quick stats — label/value rows with hairline separators. */
  .rail-stats {
    padding: 0.2rem 0 0.1rem;
    border-bottom: 1px solid var(--border-subtle);
  }

  .stat-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    padding: 0.42rem 1rem;
    border-top: 1px solid var(--border-subtle);
    gap: 0.5rem;
  }
  /* Don't double-border when there's a map above (the map bottom edge already
     acts as a separator). When there's no map, the first row gets the top
     padding treatment via the .stat-row-first rule below. */
  .stat-row:first-child {
    border-top: 0;
  }
  .stat-row-first:first-child {
    padding-top: 0.65rem;
  }

  .stat-label {
    font-size: 0.76rem;
    font-weight: 500;
    color: var(--text-tertiary);
    letter-spacing: 0.02em;
    white-space: nowrap;
  }

  .stat-value {
    font-size: 0.84rem;
    font-weight: 600;
    color: var(--text-primary);
    text-align: right;
    min-width: 0;
  }

  /* Section jump-nav */
  .rail-nav {
    padding: 0.5rem 0 0.6rem;
  }

  .rail-nav ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .rail-nav li {
    margin: 0;
  }

  .nav-link {
    display: block;
    padding: 0.38rem 1rem;
    font-size: 0.82rem;
    font-weight: 500;
    color: var(--text-secondary);
    text-decoration: none;
    border-left: 2px solid transparent;
    transition: color 0.12s, border-color 0.12s, background 0.12s;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .nav-link:hover {
    color: var(--text-primary);
    background: color-mix(in oklab, var(--accent) 5%, transparent);
  }

  .nav-link-active {
    color: var(--accent-text);
    border-left-color: var(--accent);
    font-weight: 600;
    background: color-mix(in oklab, var(--accent) 7%, transparent);
  }

  /* No map present: add top padding so the stats don't start flush. */
  .trip-rail:not(:has(.rail-map)) .rail-stats {
    padding-top: 0.3rem;
  }
</style>

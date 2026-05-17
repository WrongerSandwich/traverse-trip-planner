<script>
  // EmptyItineraryCTA — shown in the itinerary slot when a planning trip has
  // neither a brochure nor a legacy itinerary.md. This is the primary CTA in
  // Read mode for trips with no itinerary content yet.
  //
  // Props:
  //   onprepare — callback to trigger the Ambient Background prepare flow
  //   busy      — true while a brochure job is in flight (disables the button)
  //   promise   — promise object { verb, produces, time_seconds, tokens_range }

  import PromiseTooltip from '$lib/components/PromiseTooltip.svelte';

  let { onprepare, busy = false, promise } = $props();

  function formatTime(seconds) {
    if (seconds < 60) return `~${seconds}s`;
    const m = Math.round(seconds / 60);
    return `~${m}m`;
  }

  function formatTokenRange([min, max]) {
    if (min === 0 && max === 0) return null;
    const fmt = (n) => {
      if (n === 0) return '0';
      if (n < 1000) return String(n);
      const k = n / 1000;
      return Number.isInteger(k) ? `${k}k` : `${Math.round(k * 10) / 10}k`;
    };
    if (min === max) return `~${fmt(min)} tokens`;
    return `~${fmt(min)}–${fmt(max)} tokens`;
  }

  const promiseSentence = $derived.by(() => {
    const parts = [formatTime(promise.time_seconds)];
    const tokens = formatTokenRange(promise.tokens_range);
    if (tokens) parts.push(tokens);
    return `${parts.join(', ')} · runs in the background`;
  });
</script>

<div class="empty-itinerary-cta">
  <p class="cta-title">No itinerary yet.</p>
  <p class="cta-subtitle">Generate a day-by-day view from your planning sections.</p>
  <PromiseTooltip {promise}>
    <button
      type="button"
      class="btn btn-primary btn-compact"
      onclick={onprepare}
      disabled={busy}
    >
      {busy ? 'Preparing…' : 'Prepare brochure to generate a day-by-day view'}
    </button>
  </PromiseTooltip>
  <p class="cta-promise">{promiseSentence}</p>
</div>

<style>
  .empty-itinerary-cta {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 0.65rem;
    padding: 2rem 1.5rem;
    background: var(--surface-raised);
    border: 1px solid var(--border-subtle);
    border-radius: 6px;
  }

  .cta-title {
    margin: 0;
    font-size: 1.05rem;
    font-weight: 700;
    color: var(--text-primary);
    letter-spacing: -0.01em;
  }

  .cta-subtitle {
    margin: 0;
    font-size: 0.87rem;
    color: var(--text-secondary);
    line-height: 1.5;
  }

  .cta-promise {
    margin: 0;
    font-size: 0.78rem;
    color: var(--text-tertiary);
    font-style: italic;
  }
</style>

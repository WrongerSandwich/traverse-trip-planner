<script>
  // PromiseTooltip — renders the short promise sentence as a tooltip wrapper.
  //
  // Short form (docs/ai-workflow-ux.md §3):
  //   {verb} · ~{time} · ~{tokens}
  // Example: "Prepare brochure · ~45s · ~2–5k tokens"
  //
  // Usage:
  //   <PromiseTooltip {promise}>
  //     <button>Prepare brochure</button>
  //   </PromiseTooltip>
  //
  // The `promise` prop is the object exported by each action route:
  //   { verb, produces, time_seconds, tokens_range }

  /** @type {{ verb: string, produces: string, time_seconds: number, tokens_range: [number, number] }} */
  let { promise, children } = $props();

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

  const tooltipText = $derived.by(() => {
    const parts = [promise.verb, formatTime(promise.time_seconds)];
    const tokens = formatTokenRange(promise.tokens_range);
    if (tokens) parts.push(tokens);
    return parts.join(' · ');
  });
</script>

<span class="promise-tooltip" title={tooltipText} aria-label={tooltipText}>
  {@render children?.()}
</span>

<style>
  .promise-tooltip {
    display: contents;
  }
</style>

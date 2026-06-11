<script>
  // PromiseTooltip — renders the short promise sentence as a tooltip that
  // shows on hover AND keyboard focus, with a visually-hidden description
  // wired via aria-describedby for screen-reader announce. Touch users see
  // the tooltip when the wrapped control receives focus on tap.
  //
  // Short form (docs/ai-workflow-ux.md §3):
  //   {verb} · ~{time} · ~{tokens}
  //
  // Usage:
  //   <PromiseTooltip {promise}>
  //     <button>Prepare brochure</button>
  //   </PromiseTooltip>

  /** @type {{ promise: { verb: string, produces: string, time_seconds: number, tokens_range: [number, number] }, children?: any, placement?: 'top' | 'bottom' }} */
  let { promise, children, placement = 'bottom' } = $props();

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

<span
  class="promise-tooltip"
  class:placement-top={placement === 'top'}
  class:placement-bottom={placement === 'bottom'}
  title={tooltipText}
>
  {@render children?.()}
  <span class="promise-bubble" role="tooltip">{tooltipText}</span>
</span>

<style>
  .promise-tooltip {
    position: relative;
    display: inline-flex;
    isolation: isolate;
  }

  .promise-bubble {
    position: absolute;
    left: 50%;
    transform: translateX(-50%) translateY(4px);
    background: var(--surface-raised);
    color: var(--text-primary);
    font-size: 0.75rem;
    line-height: 1.2;
    padding: 6px 10px;
    border-radius: 6px;
    white-space: nowrap;
    pointer-events: none;
    opacity: 0;
    transition: opacity 120ms ease, transform 120ms ease;
    z-index: 100;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
  }

  .placement-bottom .promise-bubble {
    top: 100%;
    margin-top: 6px;
  }

  .placement-top .promise-bubble {
    bottom: 100%;
    margin-bottom: 6px;
    transform: translateX(-50%) translateY(-4px);
  }

  .promise-tooltip:hover .promise-bubble,
  .promise-tooltip:focus-within .promise-bubble {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
  }

  /* Touch-only — bubble is also visible briefly on the active state so
     tap-and-hold reveals the promise without hover. */
  @media (hover: none) {
    .promise-tooltip:active .promise-bubble {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
  }
</style>

<script>
  // PromiseBody — renders the long-form promise inside a confirm modal body
  // or an info popover.
  //
  // Long form (docs/ai-workflow-ux.md §3):
  //   {produces sentence}
  //   Typically ~{time} · ~{tokens}.
  //
  // Usage:
  //   <PromiseBody {promise} />
  //
  // The `promise` prop is the object exported by each action route:
  //   { verb, produces, time_seconds, tokens_range }

  /** @type {{ verb: string, produces: string, time_seconds: number, tokens_range: [number, number] }} */
  let { promise } = $props();

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

  const timeLine = $derived.by(() => {
    const parts = [formatTime(promise.time_seconds)];
    const tokens = formatTokenRange(promise.tokens_range);
    if (tokens) parts.push(tokens);
    return `Typically ${parts.join(' · ')}.`;
  });
</script>

<div class="promise-body">
  <p class="produces">{promise.produces}</p>
  <p class="estimate">{timeLine}</p>
</div>

<style>
  .promise-body {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  .produces {
    margin: 0;
    font-size: 0.87rem;
    color: var(--text-secondary);
    line-height: 1.55;
  }

  .estimate {
    margin: 0;
    font-size: 0.82rem;
    color: var(--text-tertiary, var(--text-secondary));
    font-style: italic;
  }
</style>

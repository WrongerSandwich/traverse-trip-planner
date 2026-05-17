<script>
  // Traverse mark: circular badge with double ring, open road vanishing to a
  // horizon line, sunrise disc above the horizon, and centerline dashes masked
  // as transparent holes through the road fill.
  // See traverse-design-spec.md §2 for usage rules. Minimum legible size 24px;
  // below that, the simplified variant drops the inner hairline ring and bumps
  // stroke weights. For truly tiny sizes use static/favicon.svg instead.

  let _uid = 0;
  function nextId() { return `tr-${++_uid}`; }

  const VARIANTS = {
    primary:      { mark: '#1F4332', sun: '#D87B3F' },
    inverse:      { mark: '#EBE0C9', sun: '#D87B3F' },
    'mono-dark':  { mark: '#1F4332', sun: '#1F4332' },
    'mono-light': { mark: '#EBE0C9', sun: '#EBE0C9' },
  };

  let {
    variant = 'primary',
    size = 40,
    'aria-label': ariaLabel = 'Traverse',
    class: className = '',
  } = $props();

  const c = $derived(VARIANTS[variant] ?? VARIANTS.primary);

  const clipId = nextId();
  const maskId = nextId();

  const simplified = $derived(size < 24);
</script>

<svg
  viewBox="0 0 80 80"
  width={size}
  height={size}
  xmlns="http://www.w3.org/2000/svg"
  role="img"
  aria-label={ariaLabel}
  class={className}
>
  <defs>
    <clipPath id={clipId}><circle cx="40" cy="40" r="33" /></clipPath>
    <mask id={maskId}>
      <rect x="0" y="0" width="80" height="80" fill="#fff" />
      <path d="M 33.75 69 L 46.25 69 L 44.4 61 L 35.6 61 Z" fill="#000" />
      <path d="M 36.55 57 L 43.45 57 L 42.35 52.5 L 37.65 52.5 Z" fill="#000" />
      <path d="M 38.5 49 L 41.5 49 L 41 46.8 L 39 46.8 Z" fill="#000" />
    </mask>
  </defs>

  <!-- outer ring -->
  <circle
    cx="40" cy="40" r="36"
    fill="none"
    stroke={c.mark}
    stroke-width={simplified ? 2 : 1.5}
    vector-effect="non-scaling-stroke"
  />

  <!-- inner hairline ring — full variant only -->
  {#if !simplified}
    <circle
      cx="40" cy="40" r="33"
      fill="none"
      stroke={c.mark}
      stroke-width="0.5"
      vector-effect="non-scaling-stroke"
    />
  {/if}

  <!-- sun -->
  <circle cx="40" cy="35.5" r="7" fill={c.sun} />

  <!-- horizon -->
  <line
    x1="16" y1="44" x2="64" y2="44"
    stroke={c.mark}
    stroke-width={simplified ? 1.3 : 1}
    vector-effect="non-scaling-stroke"
  />

  <!-- road — clipped to inner circle, centerline dashes masked as transparent holes -->
  <path
    d="M 38.75 44 L 41.25 44 L 72 82 L 8 82 Z"
    fill={c.mark}
    clip-path="url(#{clipId})"
    mask="url(#{maskId})"
  />
</svg>

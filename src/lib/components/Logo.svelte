<script>
  // Traverse mark: circular badge with double ring, two-peak mountain
  // silhouette, sunset disc behind the right shoulder, and a horizon line.
  // See traverse-design-spec.md §2 for usage rules. Minimum legible size 24px;
  // below that, use the simplified favicon (static/favicon.svg) instead.

  const VARIANTS = {
    primary:      { mark: '#1F4332', sun: '#D87B3F' }, // dark mark on light surface
    inverse:      { mark: '#EBE0C9', sun: '#D87B3F' }, // light mark on dark surface
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
  <circle cx="40" cy="40" r="36" fill="none" stroke={c.mark} stroke-width="1.5" vector-effect="non-scaling-stroke" />
  <circle cx="40" cy="40" r="33" fill="none" stroke={c.mark} stroke-width="0.5" vector-effect="non-scaling-stroke" />
  <circle cx="52" cy="36" r="7" fill={c.sun} />
  <path d="M 14,52 L 24,38 L 32,44 L 42,22 L 56,40 L 66,52 Z" fill={c.mark} />
  <line x1="10" y1="52" x2="70" y2="52" stroke={c.mark} stroke-width="0.5" vector-effect="non-scaling-stroke" />
</svg>

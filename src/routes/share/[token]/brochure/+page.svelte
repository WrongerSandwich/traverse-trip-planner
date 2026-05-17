<script>
  import Brochure from '$lib/components/Brochure.svelte';
  let { data } = $props();
</script>

<div data-theme="light">
  <Brochure {data} />
</div>

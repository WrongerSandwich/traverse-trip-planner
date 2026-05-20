<script>
  import Brochure from '$lib/components/Brochure.svelte';
  let { data } = $props();
</script>

<svelte:head>
  <title>{data.trip?.title || 'Traverse trip'} — Brochure — shared</title>
</svelte:head>

<div data-theme="light">
  <Brochure {data} />
</div>

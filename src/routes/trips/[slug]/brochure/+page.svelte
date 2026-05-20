<script>
  import Brochure from '$lib/components/Brochure.svelte';
  let { data } = $props();
</script>

<svelte:head>
  <title>Brochure — {data.trip?.title || data.trip?._slug} · Traverse</title>
</svelte:head>

<div data-theme="light">
  <Brochure {data} />
</div>

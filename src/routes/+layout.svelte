<script>
  import 'leaflet/dist/leaflet.css';
  import '../app.css';
  import BackgroundJobsIndicator from '$lib/components/BackgroundJobsIndicator.svelte';
  let { children } = $props();
</script>

<svelte:head>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="">
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500&family=Inter:wght@400;500&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
</svelte:head>

{@render children()}

<!--
  Global Ambient Background indicator. Fixed top-right, floats above every
  page's own header. See docs/ai-workflow-ux.md §6 and issue #74.
-->
<BackgroundJobsIndicator />

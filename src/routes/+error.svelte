<script>
  import { page } from '$app/state';
  import Logo from '$lib/components/Logo.svelte';
</script>

<svelte:head>
  <title>{page.status} · Traverse</title>
</svelte:head>

<header class="error-header">
  <a href="/" class="brand">
    <Logo variant="inverse" size={28} />
    <h1>Traverse</h1>
  </a>
</header>

<main class="error-page">
  <p class="status">{page.status}</p>
  <h2>
    {#if page.status === 404}
      Not found
    {:else}
      Something went wrong
    {/if}
  </h2>
  {#if page.error?.message}
    <p class="detail">{page.error.message}</p>
  {/if}
  <a href="/" class="back">← Back to all trips</a>
</main>

<style>
  .error-header {
    display: flex;
    align-items: center;
    padding: 1rem 1.5rem;
    background: var(--forest-800);
    color: var(--bone-100);
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    color: inherit;
    text-decoration: none;
  }
  .brand h1 {
    font-family: var(--font-serif);
    font-size: 1.4rem;
    font-weight: 500;
    margin: 0;
    letter-spacing: 0.005em;
  }
  .error-page {
    min-height: calc(100vh - 4rem);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 2rem 1.5rem 6rem;
    gap: 0.75rem;
    color: var(--text-primary);
  }
  .status {
    font-family: var(--font-mono);
    font-size: 0.85rem;
    letter-spacing: 0.1em;
    color: var(--text-tertiary);
    margin: 0;
    text-transform: uppercase;
  }
  .error-page h2 {
    font-family: var(--font-serif);
    font-size: 2.4rem;
    font-weight: 500;
    margin: 0;
  }
  .detail {
    color: var(--text-secondary);
    max-width: 36ch;
    margin: 0;
    line-height: 1.5;
  }
  .back {
    margin-top: 1.25rem;
    color: var(--accent-text);
    text-decoration: none;
    font-size: 0.95rem;
    padding: 0.5rem 0.9rem;
    border: 1px solid var(--border-default);
    border-radius: 6px;
    transition: background 0.12s ease;
  }
  .back:hover {
    background: var(--surface-raised);
  }
</style>

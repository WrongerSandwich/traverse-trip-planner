<script>
  /** @type {{ current: 'home-base' | 'configuration' }} */
  let { current } = $props();
</script>

<nav class="settings-subnav" aria-label="Settings sections">
  <a
    href="/home-base"
    class:active={current === 'home-base'}
    aria-current={current === 'home-base' ? 'page' : undefined}
  >Home base</a>
  <a
    href="/configuration"
    class:active={current === 'configuration'}
    aria-current={current === 'configuration' ? 'page' : undefined}
  >Configuration</a>
</nav>

<style>
  .settings-subnav {
    display: flex;
    gap: 18px;
    margin-left: 16px;
  }
  .settings-subnav a {
    color: var(--bone-400);
    text-decoration: none;
    font-family: var(--font-sans);
    font-size: 14px;
    font-weight: 500;
    padding: 4px 0;
    border-bottom: 2px solid transparent;
    transition: color 0.15s, border-color 0.15s;
  }
  .settings-subnav a:hover {
    color: var(--bone-200);
  }
  .settings-subnav a.active {
    color: var(--bone-100);
    border-bottom-color: var(--accent);
  }
  .settings-subnav a:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
    border-radius: 2px;
  }
</style>

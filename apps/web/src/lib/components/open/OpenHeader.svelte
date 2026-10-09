<script lang="ts">
  import { page } from '$app/stores';
  import { user } from '$lib/stores/auth.js';
  import Tile from '$lib/components/ui/Tile.svelte';
  import Button from '$lib/components/ui/Button.svelte';
</script>

<!-- Header of the public pages of open tracks -->
<header class="bar">
  <a class="sender" href="/"><Tile size={26} /> Music Hub</a>
  <nav>
    <a class="link" href="/offen" class:active={$page.url.pathname === '/offen'}>Offene Musik</a>
    {#if $user}
      <Button size="sm" variant="secondary" href="/dashboard">Zur App</Button>
    {:else}
      <Button size="sm" variant="secondary" href="/login?next={encodeURIComponent($page.url.pathname)}">Einloggen</Button>
    {/if}
  </nav>
</header>

<style>
  .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
  }
  .sender {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    color: var(--color-text-primary);
    font-family: var(--font-display);
    font-size: 18px;
    font-weight: 800;
    font-stretch: 76%;
    letter-spacing: -0.02em;
    line-height: 1;
  }
  nav {
    display: flex;
    align-items: center;
    gap: var(--space-4);
  }
  .link {
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
  }
  .link:hover,
  .link.active {
    color: var(--color-text-primary);
  }
</style>

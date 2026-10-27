<script lang="ts">
  import { page } from '$app/stores';
  import { t } from '$lib/i18n/index.js';
  import { user } from '$lib/stores/auth.js';
  import Tile from '$lib/components/ui/Tile.svelte';
  import Button from '$lib/components/ui/Button.svelte';
</script>

<!-- Header of the public pages of open tracks, like the one of the landing page -->
<nav class="nav">
  <a class="wordmark" href="/"><Tile size={32} /> Music Hub</a>
  <div class="nav-right">
    {#if $page.url.pathname === '/offen'}
      <a class="nav-link" href="/">{t().guest.openHeader.whatIs}</a>
    {:else}
      <a class="nav-link" href="/offen">{t().guest.openHeader.openMusic}</a>
    {/if}
    {#if $user}
      <Button size="sm" href="/dashboard">{t().guest.openList.toDashboard}</Button>
    {:else}
      <div class="nav-auth">
        <Button size="sm" variant="secondary" href="/login?next={encodeURIComponent($page.url.pathname)}">{t().common.logIn}</Button>
        <Button size="sm" href="/register">{t().common.signUp}</Button>
      </div>
    {/if}
  </div>
</nav>

<style>
  .nav {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    padding: 22px 0;
  }
  .wordmark {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    color: var(--color-text-primary);
    font-family: var(--font-display);
    font-size: 24px;
    font-weight: 800;
    font-stretch: 76%;
    letter-spacing: -0.02em;
    line-height: 1;
  }
  .wordmark:hover {
    color: var(--color-text-primary);
  }
  .nav-right {
    display: flex;
    align-items: center;
    gap: var(--space-5);
  }
  .nav-auth {
    display: flex;
    gap: var(--space-2);
  }
  .nav-link {
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
  }
  .nav-link:hover {
    color: var(--color-text-primary);
  }
  @media (max-width: 759px) {
    .nav {
      padding: 16px 0;
    }
    .nav-link {
      display: none;
    }
  }
</style>

<script lang="ts">
  import { user } from '$lib/stores/auth.js';
  import Button from '$lib/components/ui/Button.svelte';
  import SiteFooter from '$lib/components/landing/SiteFooter.svelte';

  let { children } = $props();
</script>

<div class="page">
  <nav class="nav">
    <a href="/" class="wordmark">Music Hub</a>
    {#if $user}
      <Button href="/dashboard" size="sm">Zum Dashboard</Button>
    {:else}
      <Button href="/login" size="sm">Einloggen</Button>
    {/if}
  </nav>

  <main class="legal">
    {@render children()}
  </main>

  <SiteFooter />
</div>

<style>
  .page {
    max-width: 1280px;
    margin: 0 auto;
    padding: 0 var(--space-10);
  }
  .nav {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 22px 0;
  }
  .wordmark {
    font-size: 19px;
    font-weight: 750;
    letter-spacing: -0.025em;
    background: var(--gradient-accent);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }

  .legal {
    max-width: 68ch;
    padding: 56px 0 120px;
    font-size: 16px;
    line-height: 1.65;
  }
  .legal :global(h1) {
    margin: 0 0 var(--space-3);
    font-size: clamp(34px, 5vw, 48px);
    font-weight: 730;
    letter-spacing: -0.035em;
    line-height: 1.05;
    hyphens: manual;
  }
  .legal :global(.meta) {
    margin: 0 0 var(--space-10);
    font-size: var(--text-sm);
    color: var(--color-text-tertiary);
  }
  .legal :global(h2) {
    margin: var(--space-10) 0 var(--space-3);
    font-size: 20px;
    letter-spacing: -0.02em;
  }
  .legal :global(p),
  .legal :global(address) {
    margin: 0 0 var(--space-4);
    font-style: normal;
  }
  .legal :global(a) {
    color: var(--color-text-primary);
    text-decoration: underline;
    text-underline-offset: 3px;
    text-decoration-color: rgba(244, 240, 236, 0.3);
  }
  .legal :global(a:hover) {
    color: var(--color-accent);
  }

  @media (max-width: 759px) {
    .page {
      padding: 0 var(--space-5);
    }
    .nav {
      padding: 16px 0;
    }
    .legal {
      padding: 32px 0 88px;
    }
  }
</style>

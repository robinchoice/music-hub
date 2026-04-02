<script lang="ts">
  import { onMount } from 'svelte';
  import { checkAuth, user, authLoading } from '$lib/stores/auth.js';
  import ToastContainer from '$lib/components/ui/ToastContainer.svelte';

  let { children } = $props();

  onMount(() => {
    checkAuth();
  });
</script>

<svelte:head>
  <title>Music Hub</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
</svelte:head>

{#if $authLoading}
  <div class="loading">
    <div class="loading-spinner"></div>
  </div>
{:else}
  {@render children()}
{/if}

<ToastContainer />

<style>
  :global(:root) {
    /* Background */
    --color-bg-base: #0a0a0a;
    --color-bg-raised: #111111;
    --color-bg-overlay: #1a1a1a;
    --color-bg-subtle: #222222;

    /* Borders */
    --color-border: #2a2a2a;
    --color-border-hover: #333333;
    --color-border-focus: #6366f1;

    /* Text */
    --color-text-primary: #f0f0f0;
    --color-text-secondary: #a0a0a0;
    --color-text-tertiary: #666666;

    /* Accent */
    --color-accent: #6366f1;
    --color-accent-hover: #5558e6;
    --color-accent-subtle: #1a1a2e;

    /* Semantic */
    --color-success: #22c55e;
    --color-warning: #fbbf24;
    --color-error: #ef4444;

    /* Spacing */
    --space-1: 0.25rem;
    --space-2: 0.5rem;
    --space-3: 0.75rem;
    --space-4: 1rem;
    --space-5: 1.25rem;
    --space-6: 1.5rem;
    --space-8: 2rem;
    --space-10: 2.5rem;
    --space-12: 3rem;

    /* Radii */
    --radius-sm: 4px;
    --radius-md: 8px;
    --radius-lg: 12px;
    --radius-full: 9999px;

    /* Shadows */
    --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.4);
    --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.5);
    --shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.6);

    /* Typography */
    --font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    --font-mono: 'SF Mono', 'Fira Code', monospace;
    --text-xs: 0.75rem;
    --text-sm: 0.85rem;
    --text-base: 0.9rem;
    --text-lg: 1.1rem;
    --text-xl: 1.5rem;
    --text-2xl: 2rem;

    /* Transitions */
    --transition-fast: 150ms ease;
    --transition-base: 200ms ease;

    /* Z-Index */
    --z-dropdown: 100;
    --z-modal: 200;
    --z-toast: 300;
  }

  :global(body) {
    margin: 0;
    font-family: var(--font-sans);
    background: var(--color-bg-base);
    color: var(--color-text-secondary);
    font-size: var(--text-base);
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }

  :global(*) {
    box-sizing: border-box;
  }

  :global(h1, h2, h3) {
    color: var(--color-text-primary);
  }

  :global(a) {
    color: var(--color-accent);
    text-decoration: none;
  }

  :global(a:hover) {
    color: var(--color-accent-hover);
  }

  .loading {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100vh;
  }

  .loading-spinner {
    width: 24px;
    height: 24px;
    border: 2px solid var(--color-border);
    border-top-color: var(--color-accent);
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>

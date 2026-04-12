<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { checkAuth, authLoading } from '$lib/stores/auth.js';
  import ToastContainer from '$lib/components/ui/ToastContainer.svelte';
  // @ts-ignore — no types shipped for fontsource
  import '@fontsource-variable/inter';

  let { children } = $props();

  // Public routes that should never block on auth check
  const isPublic = $derived(
    $page.url.pathname === '/' ||
      $page.url.pathname === '/login' ||
      $page.url.pathname === '/register' ||
      $page.url.pathname.startsWith('/listen/') ||
      $page.url.pathname.startsWith('/auth/'),
  );

  onMount(() => {
    checkAuth();
  });
</script>

<svelte:head>
  <title>Music Hub</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
</svelte:head>

{#if $authLoading && !isPublic}
  <div class="loading">
    <div class="loading-spinner"></div>
  </div>
{:else}
  {@render children()}
{/if}

<ToastContainer />

<style>
  :global(:root) {
    /* Background — warm neutrals */
    --color-bg-base: #0a0910;
    --color-bg-raised: #131119;
    --color-bg-overlay: #1a1822;
    --color-bg-subtle: #221f2c;

    /* Borders */
    --color-border: #24222e;
    --color-border-hover: #32303c;
    --color-border-focus: #f43f5e;

    /* Text */
    --color-text-primary: #f4f0ec;
    --color-text-secondary: #9b96a8;
    --color-text-tertiary: #5e596b;

    /* Accent — warm magenta → orange */
    --color-accent: #f43f5e;
    --color-accent-2: #fb923c;
    --color-accent-hover: #e11d48;
    --color-accent-subtle: #2a121c;
    --gradient-accent: linear-gradient(135deg, #f43f5e 0%, #fb923c 100%);

    /* Semantic */
    --color-success: #22c55e;
    --color-warning: #fbbf24;
    --color-error: #ef4444;

    /* Spacing — fluid scale */
    --space-1: 0.25rem;
    --space-2: 0.5rem;
    --space-3: 0.75rem;
    --space-4: 1rem;
    --space-5: 1.25rem;
    --space-6: 1.5rem;
    --space-8: 2rem;
    --space-10: 2.5rem;
    --space-12: 3rem;
    --space-16: 4rem;
    --space-20: 5rem;

    /* Radii */
    --radius-sm: 6px;
    --radius-md: 10px;
    --radius-lg: 14px;
    --radius-xl: 20px;
    --radius-full: 9999px;

    /* Shadows — soft + warm */
    --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.5);
    --shadow-md: 0 8px 24px rgba(0, 0, 0, 0.4);
    --shadow-lg: 0 24px 60px rgba(0, 0, 0, 0.55);
    --shadow-glow: 0 0 0 1px rgba(244, 63, 94, 0.4), 0 8px 32px rgba(244, 63, 94, 0.18);

    /* Typography — Inter first, system never */
    --font-sans: 'Inter Variable', 'Inter', system-ui, sans-serif;
    --font-mono: 'JetBrains Mono', 'SF Mono', 'Fira Code', monospace;
    --text-xs: 0.75rem;
    --text-sm: 0.875rem;
    --text-base: 0.9375rem;
    --text-lg: 1.125rem;
    --text-xl: 1.5rem;
    --text-2xl: 2rem;
    --text-3xl: 2.75rem;
    --text-4xl: 3.75rem;

    /* Transitions — opinionated easing */
    --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
    --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
    --transition-fast: 120ms var(--ease-out);
    --transition-base: 200ms var(--ease-out);

    /* Z-Index */
    --z-dropdown: 100;
    --z-modal: 200;
    --z-toast: 300;
  }

  :global(html) {
    background: var(--color-bg-base);
  }

  :global(body) {
    margin: 0;
    font-family: var(--font-sans);
    background:
      radial-gradient(ellipse 900px 500px at 12% -10%, rgba(244, 63, 94, 0.10), transparent 55%),
      radial-gradient(ellipse 700px 400px at 92% 110%, rgba(251, 146, 60, 0.06), transparent 60%),
      var(--color-bg-base);
    background-attachment: fixed;
    color: var(--color-text-secondary);
    font-size: var(--text-base);
    line-height: 1.55;
    font-feature-settings: 'cv11', 'ss01', 'ss03';
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    text-rendering: optimizeLegibility;
    min-height: 100vh;
    /* Avoid iOS rubber-band white flash */
    overscroll-behavior-y: none;
  }

  :global(*) {
    box-sizing: border-box;
  }

  :global(h1, h2, h3, h4) {
    color: var(--color-text-primary);
    letter-spacing: -0.02em;
    font-weight: 600;
  }

  :global(h1) {
    letter-spacing: -0.03em;
  }

  :global(a) {
    color: var(--color-text-primary);
    text-decoration: none;
    transition: color var(--transition-fast);
  }

  :global(a:hover) {
    color: var(--color-accent);
  }

  :global(*:focus) {
    outline: none;
  }

  :global(*:focus-visible) {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
    border-radius: var(--radius-sm);
  }

  :global(::selection) {
    background: var(--color-accent);
    color: #fff;
  }

  @media (prefers-reduced-motion: reduce) {
    :global(*),
    :global(*::before),
    :global(*::after) {
      animation-duration: 0.01ms !important;
      transition-duration: 0.01ms !important;
    }
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

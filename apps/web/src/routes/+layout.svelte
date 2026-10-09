<script lang="ts">
  import { onMount } from 'svelte';
  import { APP_BAND, GLOW, bandColor, bandGradient } from '@music-hub/shared';
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
      $page.url.pathname === '/impressum' ||
      $page.url.pathname === '/datenschutz' ||
      $page.url.pathname.startsWith('/listen/') ||
      $page.url.pathname.startsWith('/auth/'),
  );

  onMount(() => {
    checkAuth();
  });

  // Link previews. Public pages override them with meta in their server load,
  // pages without SSR don't get any (link crawlers run no JavaScript).
  const meta = $derived({
    title: 'Music Hub',
    description: 'Jeder Stand deines Songs, Feedback auf die Sekunde und klar, welcher Mix freigegeben ist.',
    image: '',
    ...$page.data.meta,
  });
</script>

<svelte:head>
  <title>Music Hub</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta property="og:site_name" content="Music Hub" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content={meta.title} />
  <meta property="og:description" content={meta.description} />
  {#if meta.image}
    <meta property="og:image" content={meta.image} />
  {:else}
    <meta property="og:image" content="{$page.url.origin}/og-image.png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="Music Hub: Versionen für Musik. Ohne Chaos." />
  {/if}
  <meta name="twitter:card" content="summary_large_image" />
</svelte:head>

<div
  class="app"
  style:--gradient-accent={bandGradient(APP_BAND, GLOW)}
  style:--color-accent={bandColor((APP_BAND.from + APP_BAND.to) / 2, GLOW)}
  style:--color-accent-2={bandColor(APP_BAND.to, GLOW)}
  style:--color-accent-hover={bandColor(APP_BAND.to, GLOW)}
>
  {#if $authLoading && !isPublic}
    <div class="loading">
      <div class="loading-spinner"></div>
    </div>
  {:else}
    {@render children()}
  {/if}

  <ToastContainer />
</div>

<style>
  @font-face {
    font-family: 'Bricolage Grotesque';
    font-weight: 200 800;
    font-stretch: 75% 100%;
    font-display: swap;
    src: url('/fonts/bricolage-grotesque-latin-ext.woff2') format('woff2');
    unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF,
      U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF;
  }
  @font-face {
    font-family: 'Bricolage Grotesque';
    font-weight: 200 800;
    font-stretch: 75% 100%;
    font-display: swap;
    src: url('/fonts/bricolage-grotesque-latin.woff2') format('woff2');
    unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329,
      U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
  }

  :global(:root) {
    /* Background — the dark neutrals of the Pleasance family, tinted towards Music Hub's colour */
    --color-bg-base: #120f13;
    --color-bg-raised: #19171c;
    --color-bg-overlay: #211e25;
    --color-bg-subtle: #2a272f;

    /* Borders */
    --color-border: #262329;
    --color-border-hover: #36333b;

    /* Text */
    --color-text-primary: #f2f0ea;
    --color-text-secondary: #9a98a3;
    --color-text-tertiary: #6f6c77;

    /* Unplayed part of waveforms */
    --color-wave-idle: #47444b;

    /* Text and icons on the gradient are always dark */
    --color-on-accent: #17171a;
    /* The whole family band, for the line in the sender */
    --spectrum: linear-gradient(90deg, #f2545b, #fb8c45, #f2c14e, #6ccf8e, #46bfe0, #8e92f8, #c39bf2);

    /* Signal colours of the family (starter DESIGN.md), never the product colour:
       success = new (glow), warning = your turn (glow), error = failed or rejected (glow).
       Running work has no colour of its own and stays muted. */
    --color-success: #6ccf8e;
    --color-warning: #f4b44c;
    --color-error: #f2545b;

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

    /* Typography — Bricolage Grotesque (self-hosted) for the product name, headings and big numbers, Inter for the rest */
    --font-display: 'Bricolage Grotesque', system-ui, sans-serif;
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
    background: var(--color-bg-base);
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

  :global(h1, h2) {
    font-family: var(--font-display);
    font-weight: 780;
    font-stretch: 78%;
    line-height: 1.05;
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
    color: var(--color-on-accent);
  }

  @media (prefers-reduced-motion: reduce) {
    :global(*),
    :global(*::before),
    :global(*::after) {
      animation-duration: 0.01ms !important;
      transition-duration: 0.01ms !important;
    }
  }

  .app {
    display: contents;
    --color-accent-subtle: color-mix(in srgb, var(--color-accent) 12%, transparent);
    --color-border-focus: var(--color-accent);
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

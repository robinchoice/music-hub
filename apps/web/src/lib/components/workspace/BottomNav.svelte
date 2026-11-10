<script lang="ts">
  import { page } from '$app/stores';
  import { getContext } from 'svelte';
  import { t } from '$lib/i18n/index.js';
  import Icon from '$lib/components/ui/Icon.svelte';
  import { tasks } from '$lib/stores/overview.js';
  import { requests } from '$lib/stores/requests.js';

  const openMobileMenu = getContext<() => void>('openMobileMenu');

  // "Neu", sharing, the trash and the account sit in the menu
  const ITEMS = $derived([
    { href: '/dashboard', icon: 'home', label: t().workspace.nav.overview, within: [] },
    { href: '/music', icon: 'folder', label: t().workspace.nav.music, within: ['/artists/', '/projects/', '/board', '/archive'] },
    { href: '/for-you', icon: 'inbox', label: t().workspace.nav.forYou, within: [] },
  ] as const);
  const path = $derived($page.url.pathname);
</script>

<nav class="bottom-nav" aria-label={t().workspace.nav.main}>
  {#each ITEMS as item (item.href)}
    <a href={item.href} class="nav-item" class:active={path === item.href || item.within.some((p) => path.startsWith(p))}>
      <Icon name={item.icon} size={22} />
      {#if item.href === '/for-you' && $tasks.length + $requests.length}
        <span class="badge">{$tasks.length + $requests.length}</span>
      {/if}
      <span>{item.label}</span>
    </a>
  {/each}

  <button class="nav-item" onclick={() => openMobileMenu?.()}>
    <Icon name="menu" size={22} />
    <span>{t().workspace.nav.more}</span>
  </button>
</nav>

<style>
  .bottom-nav {
    display: none;
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: 90;
    background: color-mix(in srgb, var(--color-bg-raised) 94%, transparent);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border-top: 1px solid var(--color-border);
    padding: 0 var(--space-2) env(safe-area-inset-bottom, 0);
    height: calc(56px + env(safe-area-inset-bottom, 0px));
    align-items: stretch;
    justify-content: space-around;
    gap: 0;
  }

  .nav-item {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
    flex: 1;
    min-width: 0;
    padding: var(--space-2) var(--space-1);
    color: var(--color-text-tertiary);
    text-decoration: none;
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0.02em;
    transition: color var(--transition-fast);
    background: none;
    border: none;
    cursor: pointer;
    font-family: inherit;
    /* Buttons don't inherit it, the menu button would sit lower than the links */
    line-height: inherit;
  }

  .nav-item:hover {
    color: var(--color-text-primary);
  }

  .nav-item.active {
    color: var(--color-text-primary);
  }

  /* The active tab carries the gradient as a 2px line */
  .nav-item.active::before {
    content: '';
    position: absolute;
    top: -1px;
    left: 24%;
    right: 24%;
    height: 2px;
    border-radius: 0 0 2px 2px;
    background: var(--gradient-accent);
  }

  .badge {
    position: absolute;
    top: 5px;
    left: calc(50% + 5px);
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    border-radius: 8px;
    /* Open tasks wait for you: signal colour, not the product colour */
    background: var(--color-warning);
    color: var(--color-on-accent);
    font-size: 10px;
    font-weight: 700;
    display: grid;
    place-items: center;
    box-shadow: 0 0 0 2px var(--color-bg-base);
  }

  @media (max-width: 640px) {
    .bottom-nav {
      display: flex;
    }
  }
</style>

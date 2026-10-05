<script lang="ts">
  import { page } from '$app/stores';
  import { getContext } from 'svelte';
  import Icon from '$lib/components/ui/Icon.svelte';
  import { tasks } from '$lib/stores/overview.js';

  const openMobileMenu = getContext<() => void>('openMobileMenu');

  // Teil 4 adds "Pult"; Timeline, projects and account sit in the menu
  const ITEMS = [
    { href: '/dashboard', icon: 'home', label: 'Übersicht' },
    { href: '/for-you', icon: 'inbox', label: 'Für dich' },
    { href: '/tracks', icon: 'music', label: 'Tracks' },
  ] as const;
</script>

<nav class="bottom-nav" aria-label="Hauptnavigation">
  {#each ITEMS as item (item.href)}
    <a href={item.href} class="nav-item" class:active={$page.url.pathname === item.href}>
      <Icon name={item.icon} size={22} />
      {#if item.href === '/for-you' && $tasks.length}
        <span class="badge">{$tasks.length}</span>
      {/if}
      <span>{item.label}</span>
    </a>
  {/each}

  <button class="nav-item" onclick={() => openMobileMenu?.()}>
    <Icon name="menu" size={22} />
    <span>Menü</span>
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
    background: rgba(10, 9, 16, 0.92);
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
  }

  .nav-item:hover {
    color: var(--color-text-primary);
  }

  .nav-item.active {
    color: var(--color-accent);
  }

  .badge {
    position: absolute;
    top: 5px;
    left: calc(50% + 5px);
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    border-radius: 8px;
    background: var(--color-accent);
    color: #fff;
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
